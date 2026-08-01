import { describe, it, expect, beforeEach } from "vitest";
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

const PATHS = { fileStats: "f.json", project: "p.json", global: "g.json" };

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
});
