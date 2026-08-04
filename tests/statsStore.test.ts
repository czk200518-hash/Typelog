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
    expect(store.getGlobalStats().heatmap[key][10]).toBe(1000);
    expect(store.getGlobalStats().dailyActiveByDate[key]).toBe(1000);
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

  it("sanitizeHeatmap 快速路径：合法 24 槽原样加载", async () => {
    const heat = Array.from({ length: 24 }, (_, i) => i * 100);
    adapter.data.set("g.json", JSON.stringify({
      grossTypedTotal: 100, deletedCharsTotal: 5,
      dailyActiveByDate: {}, dailyGrossByDate: {}, dailyPeakByDate: {},
      heatmap: { "2026-08-01": heat },
    }));
    await store.load();
    expect(store.getGlobalStats().heatmap["2026-08-01"]).toEqual(heat);
  });

  it("sanitizeHeatmap 损坏数据补 0 为 24 槽", async () => {
    // 长度不足 + 含非有限值，均走慢速清洗路径
    adapter.data.set("g.json", JSON.stringify({
      grossTypedTotal: 0, deletedCharsTotal: 0,
      dailyActiveByDate: {}, dailyGrossByDate: {}, dailyPeakByDate: {},
      heatmap: { "2026-08-01": [1, 2, "bad", NaN] },
    }));
    await store.load();
    const h = store.getGlobalStats().heatmap["2026-08-01"];
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
    g.heatmap["2024-01-01"] = new Array(24).fill(0);
    g.dailyActiveByDate["2026-08-01"] = 200;
    g.heatmap["2026-08-01"] = new Array(24).fill(1);
    const removed = store.pruneOldDailyKeys(365);
    // 4 个过期键（dailyActive/Gross/Peak + heatmap）被裁剪，2026-08-01 保留
    expect(removed).toBe(4);
    expect(g.dailyActiveByDate["2024-01-01"]).toBeUndefined();
    expect(g.dailyGrossByDate["2024-01-01"]).toBeUndefined();
    expect(g.dailyPeakByDate["2024-01-01"]).toBeUndefined();
    expect(g.heatmap["2024-01-01"]).toBeUndefined();
    expect(g.dailyActiveByDate["2026-08-01"]).toBe(200);
    expect(g.heatmap["2026-08-01"]).toHaveLength(24);
  });

  it("pruneOldDailyKeys：maxDays<=0 不清理", async () => {
    await store.load();
    const g = store.getGlobalStats();
    g.dailyActiveByDate["2020-01-01"] = 100;
    const removed = store.pruneOldDailyKeys(0);
    expect(removed).toBe(0);
    expect(g.dailyActiveByDate["2020-01-01"]).toBe(100);
  });
});
