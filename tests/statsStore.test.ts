import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatsStore, StatsStorageAdapter } from "../src/core/statsStore";
import { dateKey } from "../src/core/format";

class MemAdapter implements StatsStorageAdapter {
  data = new Map<string, string>();
  async read(path: string): Promise<string | null> {
    return this.data.get(path) ?? null;
  }
  async write(path: string, content: string): Promise<void> {
    this.data.set(path, content);
  }
}

const PATHS = { fileStats: "f.json", project: "p.json", globalStats: "g.json" };

describe("StatsStore 三层存储", () => {
  let adapter: MemAdapter;
  let store: StatsStore;

  beforeEach(() => {
    adapter = new MemAdapter();
    store = new StatsStore(adapter, PATHS);
  });

  it("记录变更并持久化到三层", async () => {
    await store.load();
    store.recordChange("/v/a.md", 10, 2);
    await store.flush();

    const f = JSON.parse(adapter.data.get("f.json")!);
    expect(f.files["/v/a.md"].grossTyped).toBe(10);
    expect(f.files["/v/a.md"].deletedChars).toBe(2);

    const p = JSON.parse(adapter.data.get("p.json")!);
    expect(p.grossTyped).toBe(10);

    const g = JSON.parse(adapter.data.get("g.json")!);
    expect(g.grossTypedTotal).toBe(10);
    const key = dateKey(new Date());
    expect(g.dailyGrossByDate[key]).toBe(10);
  });

  it("重新加载后数据保持一致（跨会话持久化）", async () => {
    store.recordChange("/v/a.md", 100, 0);
    await store.flush();

    const store2 = new StatsStore(adapter, PATHS);
    await store2.load();
    expect(store2.getFileStats("/v/a.md")?.grossTyped).toBe(100);
    expect(store2.getGlobalStats().grossTypedTotal).toBe(100);
  });

  it("活跃时长写入文件层与热力图", async () => {
    await store.load();
    store.recordActiveTime("/v/a.md", 1000, 10);
    await store.flush();

    expect(store.getFileStats("/v/a.md")?.activeTimeMs).toBe(1000);
    const key = dateKey(new Date());
    expect(store.getGlobalStats().heatmap[key].activeMs[10]).toBe(1000);
    expect(store.getGlobalStats().dailyActiveByDate[key]).toBe(1000);
  });

  it("recordChange 累加热力图字数维度（grossByHour）", async () => {
    await store.load();
    store.recordChange("/v/a.md", 300, 0);
    const key = dateKey(new Date());
    const day = store.getGlobalStats().heatmap[key];
    expect(day).toBeDefined();
    expect(day.grossByHour.reduce((a, b) => a + b, 0)).toBe(300);
    expect(day.activeMs.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("每日峰值取最大值", async () => {
    await store.load();
    store.recordPeak(30);
    store.recordPeak(80);
    store.recordPeak(50);
    const key = dateKey(new Date());
    expect(store.getGlobalStats().dailyPeakByDate[key]).toBe(80);
  });

  it("hardReset 清空所有历史", async () => {
    store.recordChange("/v/a.md", 100, 0);
    store.hardReset();
    await store.flush();
    expect(store.getFileStats("/v/a.md")).toBeUndefined();
    expect(store.getGlobalStats().grossTypedTotal).toBe(0);
  });

  it("损坏的 JSON 自动重建", async () => {
    adapter.data.set("f.json", "{broken");
    await store.load();
    expect(store.getAllFileStats()).toEqual([]);
  });

  it("sanitizeHeatmap 快速路径：合法 24 槽新格式原样加载", async () => {
    const active = Array.from({ length: 24 }, (_, i) => i * 100);
    const gross = Array.from({ length: 24 }, (_, i) => i * 50);
    adapter.data.set("g.json", JSON.stringify({
      grossTypedTotal: 100, deletedCharsTotal: 5,
      dailyActiveByDate: {}, dailyGrossByDate: {}, dailyPeakByDate: {},
      heatmap: { "2026-08-01": { activeMs: active, grossByHour: gross } },
    }));
    await store.load();
    expect(store.getGlobalStats().heatmap["2026-08-01"].activeMs).toEqual(active);
    expect(store.getGlobalStats().heatmap["2026-08-01"].grossByHour).toEqual(gross);
  });

  it("sanitizeHeatmap 旧格式 number[] 自动迁移为新格式（grossByHour 补 0）", async () => {
    const old = Array.from({ length: 24 }, (_, i) => i * 100);
    adapter.data.set("g.json", JSON.stringify({
      grossTypedTotal: 0, deletedCharsTotal: 0,
      dailyActiveByDate: {}, dailyGrossByDate: {}, dailyPeakByDate: {},
      heatmap: { "2026-08-01": old },
    }));
    await store.load();
    const day = store.getGlobalStats().heatmap["2026-08-01"];
    expect(day.activeMs).toEqual(old);
    expect(day.grossByHour).toHaveLength(24);
    expect(day.grossByHour.every((v) => v === 0)).toBe(true);
  });

  it("sanitizeHeatmap 损坏数据补 0 为 24 槽", async () => {
    // 长度不足 + 含非有限值，均走慢速清洗路径
    adapter.data.set("g.json", JSON.stringify({
      grossTypedTotal: 0, deletedCharsTotal: 0,
      dailyActiveByDate: {}, dailyGrossByDate: {}, dailyPeakByDate: {},
      heatmap: { "2026-08-01": { activeMs: [1, 2, "bad", NaN], grossByHour: [] } },
    }));
    await store.load();
    const h = store.getGlobalStats().heatmap["2026-08-01"].activeMs;
    expect(h).toHaveLength(24);
    expect(h[0]).toBe(1);
    expect(h[1]).toBe(2);
    expect(h[2]).toBe(0); // "bad" → 0
    expect(h[3]).toBe(0); // NaN → 0
  });

  it("最小写盘间隔：间隔内顺延合并，超过间隔后落盘", async () => {
    vi.useFakeTimers();
    try {
      await store.load();
      store.recordChange("/v/a.md", 10, 0);
      // 防抖 200ms 后首次落盘（lastFlushAt=0 不受间隔限制）
      await vi.advanceTimersByTimeAsync(200);
      expect(JSON.parse(adapter.data.get("f.json")!).files["/v/a.md"].grossTyped).toBe(10);

      // 再次变更：距上次写盘不足 5s，应顺延而非立即写盘
      store.recordChange("/v/a.md", 20, 0);
      await vi.advanceTimersByTimeAsync(200);
      expect(JSON.parse(adapter.data.get("f.json")!).files["/v/a.md"].grossTyped).toBe(10);

      // 继续前进超过最小间隔 → 合并后的值落盘
      await vi.advanceTimersByTimeAsync(5000);
      expect(JSON.parse(adapter.data.get("f.json")!).files["/v/a.md"].grossTyped).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("强制 flush 不受最小写盘间隔限制", async () => {
    vi.useFakeTimers();
    try {
      store.recordChange("/v/a.md", 10, 0);
      await vi.advanceTimersByTimeAsync(200);
      // 间隔内强制 flush 仍立即落盘
      store.recordChange("/v/a.md", 5, 0);
      await store.flush();
      expect(JSON.parse(adapter.data.get("f.json")!).files["/v/a.md"].grossTyped).toBe(15);
    } finally {
      vi.useRealTimers();
    }
  });

  it("purgeInactiveFiles：清理超过 N 天未访问的文件统计", async () => {
    await store.load();
    const now = Date.now();
    const dayMs = 86_400_000;
    store.touchOpen("/v/old.md", now - 200 * dayMs);
    store.touchOpen("/v/new.md", now - 10 * dayMs);
    const removed = store.purgeInactiveFiles(now - 180 * dayMs);
    expect(removed).toBe(1);
    expect(store.getFileStats("/v/old.md")).toBeUndefined();
    expect(store.getFileStats("/v/new.md")).toBeDefined();
    // 持久化后依然保持清理结果
    await store.flush();
    const store2 = new StatsStore(adapter, PATHS);
    await store2.load();
    expect(store2.getFileStats("/v/old.md")).toBeUndefined();
    expect(store2.getFileStats("/v/new.md")).toBeDefined();
  });

  it("purgeInactiveFiles：lastOpened=0 的旧数据保守跳过", async () => {
    await store.load();
    store.recordChange("/v/legacy.md", 10, 0);
    const f = store.getFileStats("/v/legacy.md")!;
    f.lastOpened = 0; // 模拟无时间信息的旧数据
    const removed = store.purgeInactiveFiles(Date.now() - 100 * 86_400_000);
    expect(removed).toBe(0);
    expect(store.getFileStats("/v/legacy.md")).toBeDefined();
  });

  it("pruneOldDailyKeys：裁剪过期 daily/heatmap 键，保留最近键", async () => {
    await store.load();
    const g = store.getGlobalStats();
    g.dailyActiveByDate["2024-01-01"] = 100;
    g.dailyGrossByDate["2024-01-01"] = 100;
    g.dailyPeakByDate["2024-01-01"] = 80;
    g.heatmap["2024-01-01"] = { activeMs: new Array(24).fill(0), grossByHour: new Array(24).fill(0) };
    g.dailyActiveByDate["2026-08-01"] = 200;
    g.heatmap["2026-08-01"] = { activeMs: new Array(24).fill(1), grossByHour: new Array(24).fill(0) };
    const removed = store.pruneOldDailyKeys(365);
    // 4 个过期键（dailyActive/Gross/Peak + heatmap）被裁剪，2026-08-01 保留
    expect(removed).toBe(4);
    expect(g.dailyActiveByDate["2024-01-01"]).toBeUndefined();
    expect(g.dailyGrossByDate["2024-01-01"]).toBeUndefined();
    expect(g.dailyPeakByDate["2024-01-01"]).toBeUndefined();
    expect(g.heatmap["2024-01-01"]).toBeUndefined();
    expect(g.dailyActiveByDate["2026-08-01"]).toBe(200);
    expect(g.heatmap["2026-08-01"].activeMs).toHaveLength(24);
  });

  it("pruneOldDailyKeys：maxDays<=0 不清理", async () => {
    await store.load();
    const g = store.getGlobalStats();
    g.dailyActiveByDate["2020-01-01"] = 100;
    const removed = store.pruneOldDailyKeys(0);
    expect(removed).toBe(0);
    expect(g.dailyActiveByDate["2020-01-01"]).toBe(100);
  });

  describe("migratePaths 绝对路径 key 迁移（优化 1）", () => {
    it("Windows 盘符绝对路径映射为 vault 相对路径", async () => {
      await store.load();
      store.recordChange("D:/vault/笔记/日记.md", 100, 10);
      store.recordChange("D:/vault/笔记/日记.md", 50, 5);
      const migrated = store.migratePaths("D:/vault");
      expect(migrated).toBe(1);
      const f = store.getFileStats("笔记/日记.md")!;
      expect(f.grossTyped).toBe(150);
      expect(f.deletedChars).toBe(15);
      expect(store.getFileStats("D:/vault/笔记/日记.md")).toBeUndefined();
    });

    it("正斜杠绝对路径（Unix 形态）映射为相对路径", async () => {
      await store.load();
      store.recordChange("/vault/notes/a.md", 30, 0);
      const migrated = store.migratePaths("/vault");
      expect(migrated).toBe(1);
      expect(store.getFileStats("notes/a.md")?.grossTyped).toBe(30);
    });

    it("新旧 key 并存时合并累加（数值相加、时间取区间）", async () => {
      await store.load();
      store.recordChange("D:/vault/a.md", 100, 0);
      store.touchOpen("D:/vault/a.md", 1000);
      const old = store.getFileStats("D:/vault/a.md")!;
      old.firstSeen = 1000;
      old.lastOpened = 5000;
      // 新格式 key 已存在（迁移中途启动等场景）
      store.touchOpen("a.md", 7000);
      store.recordChange("a.md", 60, 0);
      const migrated = store.migratePaths("D:/vault");
      expect(migrated).toBe(1);
      const merged = store.getFileStats("a.md")!;
      expect(merged.grossTyped).toBe(160); // 100 + 60
      expect(merged.firstSeen).toBe(1000); // 取较早
      expect(merged.lastOpened).toBe(7000); // 取较新
    });

    it("非本库绝对路径原样保留（不删除任何数据）", async () => {
      await store.load();
      store.recordChange("F:/other/legacy.md", 10, 0);
      const migrated = store.migratePaths("D:/vault");
      expect(migrated).toBe(0);
      expect(store.getFileStats("F:/other/legacy.md")?.grossTyped).toBe(10);
    });

    it("已是相对路径的 key 不迁移", async () => {
      await store.load();
      store.recordChange("notes/a.md", 20, 0);
      const migrated = store.migratePaths("D:/vault");
      expect(migrated).toBe(0);
      expect(store.getFileStats("notes/a.md")?.grossTyped).toBe(20);
    });

    it("幂等：二次迁移无变化", async () => {
      await store.load();
      store.recordChange("D:/vault/a.md", 10, 0);
      store.migratePaths("D:/vault");
      expect(store.migratePaths("D:/vault")).toBe(0);
    });

    it("basePath 为 null 时不迁移", async () => {
      await store.load();
      store.recordChange("D:/vault/a.md", 10, 0);
      expect(store.migratePaths(null)).toBe(0);
    });

    it("迁移后写盘，重新加载保持相对路径", async () => {
      await store.load();
      store.recordChange("D:/vault/a.md", 88, 0);
      store.migratePaths("D:/vault");
      await store.flush();
      const store2 = new StatsStore(adapter, PATHS);
      await store2.load();
      expect(store2.getFileStats("a.md")?.grossTyped).toBe(88);
      expect(store2.getFileStats("D:/vault/a.md")).toBeUndefined();
    });
  });

  describe("applyImport 备份导入（功能 4）", () => {
    // overrides 中的全局数据键用字符串字面量 "global"（模拟 .typelog 备份格式，避免裸标识符）
    function backupData(overrides: { fileStats?: Record<string, unknown>; "global"?: Record<string, unknown>; project?: unknown } = {}) {
      const heat = new Array<number>(24).fill(0);
      heat[10] = 120_000;
      return {
        fileStats: {
          "笔记/a.md": { path: "笔记/a.md", grossTyped: 100, deletedChars: 5, activeTimeMs: 1000, firstSeen: 10, lastOpened: 20 },
        },
        project: { version: 1, grossTyped: 100, deletedChars: 5, activeTimeMs: 1000, updatedAt: 20 },
        "global": {
          grossTypedTotal: 100,
          deletedCharsTotal: 5,
          dailyActiveByDate: { "2026-08-01": 1000 },
          dailyGrossByDate: { "2026-08-01": 100 },
          dailyPeakByDate: { "2026-08-01": 50 },
          heatmap: { "2026-08-01": heat },
        },
        ...overrides,
      };
    }

    it("合并模式：数值相加、峰值取 max、时间取更全区间、热力图逐小时相加", async () => {
      await store.load();
      store.recordChange("笔记/a.md", 50, 5);
      store.touchOpen("笔记/a.md", 999);
      const g = store.getGlobalStats();
      g.dailyActiveByDate["2026-08-01"] = 1000;
      g.dailyGrossByDate["2026-08-01"] = 50;
      g.dailyPeakByDate["2026-08-01"] = 60; // 更高峰值保留
      const imported = store.applyImport(backupData(), "merge", null);
      expect(imported).toBe(1);
      const f = store.getFileStats("笔记/a.md")!;
      expect(f.grossTyped).toBe(150); // 50 + 100
      expect(f.deletedChars).toBe(10);
      expect(f.activeTimeMs).toBe(1000);
      expect(g.grossTypedTotal).toBe(150);
      expect(g.dailyGrossByDate["2026-08-01"]).toBe(150); // 50 + 100
      expect(g.dailyPeakByDate["2026-08-01"]).toBe(60); // max 保持
      expect(g.heatmap["2026-08-01"].activeMs[10]).toBe(120_000);
    });

    it("合并模式：不存在的文件新增，已存在数值不丢失（只增不减）", async () => {
      await store.load();
      store.recordChange("笔记/a.md", 30, 0);
      const imported = store.applyImport(backupData(), "merge", null);
      expect(imported).toBe(1);
      expect(store.getFileStats("笔记/a.md")?.grossTyped).toBe(130);
      expect(store.getFileStats("笔记/b.md")).toBeUndefined();
    });

    it("覆盖模式：整体替换为备份数据", async () => {
      await store.load();
      store.recordChange("笔记/other.md", 999, 0);
      const imported = store.applyImport(backupData(), "overwrite", null);
      expect(imported).toBe(1);
      expect(store.getFileStats("笔记/other.md")).toBeUndefined();
      expect(store.getFileStats("笔记/a.md")?.grossTyped).toBe(100);
      expect(store.getGlobalStats().grossTypedTotal).toBe(100);
    });

    it("旧备份绝对路径 key：按 basePath 映射为相对路径后合并", async () => {
      await store.load();
      const data = backupData({
        fileStats: { "D:/vault/笔记/a.md": { path: "D:/vault/笔记/a.md", grossTyped: 200, deletedChars: 0, activeTimeMs: 0, firstSeen: 1, lastOpened: 2 } },
      });
      store.applyImport(data, "merge", "D:/vault");
      expect(store.getFileStats("笔记/a.md")?.grossTyped).toBe(200);
      expect(store.getFileStats("D:/vault/笔记/a.md")).toBeUndefined();
    });

    it("非本库绝对路径 key 丢弃", async () => {
      await store.load();
      const data = backupData({
        fileStats: { "F:/other/x.md": { path: "F:/other/x.md", grossTyped: 500, deletedChars: 0, activeTimeMs: 0, firstSeen: 1, lastOpened: 2 } },
      });
      const imported = store.applyImport(data, "merge", "D:/vault");
      expect(imported).toBe(0);
      expect(store.getFileStats("F:/other/x.md")).toBeUndefined();
    });

    it("损坏数据消毒：非法字段回退为 0，不污染统计", async () => {
      await store.load();
      const data = backupData({
        "global": { grossTypedTotal: "bad", deletedCharsTotal: NaN, dailyGrossByDate: { "2026-08-01": "x" }, dailyActiveByDate: {}, dailyPeakByDate: {}, heatmap: {} },
      });
      store.applyImport(data, "overwrite", null);
      expect(store.getGlobalStats().grossTypedTotal).toBe(0);
      expect(store.getGlobalStats().dailyGrossByDate["2026-08-01"] ?? 0).toBe(0);
    });

    it("导入后写盘，重新加载保持一致", async () => {
      await store.load();
      store.applyImport(backupData(), "merge", null);
      await store.flush();
      const store2 = new StatsStore(adapter, PATHS);
      await store2.load();
      expect(store2.getFileStats("笔记/a.md")?.grossTyped).toBe(100);
      expect(store2.getGlobalStats().grossTypedTotal).toBe(100);
    });
  });

  describe("写盘失败回调（优化 5）", () => {
    // 可注入失败的适配器
    class FailAdapter implements StatsStorageAdapter {
      fail = true;
      data = new Map<string, string>();
      async read(path: string): Promise<string | null> {
        return this.data.get(path) ?? null;
      }
      async write(path: string, _content: string): Promise<void> {
        if (this.fail) throw new Error("disk full");
        this.data.set(path, _content);
      }
    }

    it("连续写盘失败 3 次触发回调，成功写盘后计数清零", async () => {
      const onFlushError = vi.fn();
      const fail = new FailAdapter();
      const s = new StatsStore(fail, PATHS, { onFlushError });
      await s.load();
      s.recordChange("/v/a.md", 10, 0);
      await s.flush(); // 失败 1
      await s.flush(); // 失败 2
      await s.flush(); // 失败 3 → 触发
      expect(onFlushError).toHaveBeenCalledTimes(1);
      // 恢复后成功写盘，计数清零；再次连续失败可再次触发
      fail.fail = false;
      await s.flush();
      fail.fail = true;
      s.recordChange("/v/a.md", 1, 0);
      await s.flush();
      await s.flush();
      await s.flush();
      expect(onFlushError).toHaveBeenCalledTimes(2);
    });

    it("未提供回调时连续失败不报错", async () => {
      const fail = new FailAdapter();
      const s = new StatsStore(fail, PATHS);
      await s.load();
      s.recordChange("/v/a.md", 10, 0);
      await s.flush();
      await s.flush();
      await s.flush();
      await s.flush();
      expect(s.getGlobalStats().grossTypedTotal).toBe(10); // 数据仍在内存
    });
  });
});

describe("当天分钟采样（曲线跨会话恢复）", () => {
  const DAY = "2026-08-06";
  let adapter: MemAdapter;
  let store: StatsStore;

  beforeEach(() => {
    adapter = new MemAdapter();
    store = new StatsStore(adapter, PATHS);
  });

  it("recordDaySample 追加/同分钟覆盖，getDaySeries 读取", () => {
    store.recordDaySample("/v/a.md", DAY, { t: 1_000, delta: 100, gross: 150 });
    store.recordDaySample("/v/a.md", DAY, { t: 2_000, delta: 200, gross: 300 });
    store.recordDaySample("/v/a.md", DAY, { t: 2_000, delta: 205, gross: 310 }); // 同分钟覆盖
    expect(store.getDaySeries("/v/a.md", DAY)).toEqual([
      { t: 1_000, delta: 100, gross: 150 },
      { t: 2_000, delta: 205, gross: 310 },
    ]);
  });

  it("不同文件/不同日期隔离存储", () => {
    store.recordDaySample("/v/a.md", DAY, { t: 1_000, delta: 1, gross: 1 });
    store.recordDaySample("/v/b.md", DAY, { t: 1_000, delta: 2, gross: 2 });
    store.recordDaySample("/v/a.md", "2026-08-07", { t: 1_000, delta: 3, gross: 3 });
    expect(store.getDaySeries("/v/a.md", DAY)).toHaveLength(1);
    expect(store.getDaySeries("/v/b.md", DAY)?.[0].delta).toBe(2);
    expect(store.getDaySeries("/v/a.md", "2026-08-07")?.[0].delta).toBe(3);
    expect(store.getDaySeries("/v/a.md", "2026-08-08")).toBeUndefined();
  });

  it("flush 落盘 + 重新加载恢复（模拟关闭 Obsidian 重开）", async () => {
    store.recordDaySample("/v/a.md", DAY, { t: 1_000, delta: 100, gross: 150 });
    await store.flush();

    const store2 = new StatsStore(adapter, PATHS);
    await store2.load();
    expect(store2.getDaySeries("/v/a.md", DAY)).toEqual([{ t: 1_000, delta: 100, gross: 150 }]);
  });

  it("损坏的采样数据被消毒（非法值回退 0，超上限裁最旧）", async () => {
    adapter.data.set(
      "f.json",
      JSON.stringify({
        version: 1,
        files: {},
        daySeries: {
          [DAY]: {
            "/v/a.md": [
              { t: 1, delta: "bad", gross: 2 },
              { t: 2, delta: 3, gross: 4 },
            ],
          },
        },
      }),
    );
    await store.load();
    expect(store.getDaySeries("/v/a.md", DAY)).toEqual([{ t: 1, delta: 0, gross: 2 }, { t: 2, delta: 3, gross: 4 }]);
  });

  it("pruneOldDailyKeys 清理过期日期的采样", async () => {
    const today = dateKey(new Date());
    store.recordDaySample("/v/a.md", "2026-07-01", { t: 1, delta: 1, gross: 1 });
    store.recordDaySample("/v/a.md", today, { t: 1, delta: 1, gross: 1 });
    // cutoff = 今天往前 2 天；07-01 过期被清理
    const removed = store.pruneOldDailyKeys(2);
    expect(removed).toBeGreaterThan(0);
    expect(store.getDaySeries("/v/a.md", "2026-07-01")).toBeUndefined();
    expect(store.getDaySeries("/v/a.md", today)).toHaveLength(1);
  });

  it("hardReset 清空采样", () => {
    store.recordDaySample("/v/a.md", DAY, { t: 1, delta: 1, gross: 1 });
    store.hardReset();
    expect(store.getDaySeries("/v/a.md", DAY)).toBeUndefined();
  });
});
