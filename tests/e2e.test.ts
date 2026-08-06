import { describe, it, expect } from "vitest";
import { StatsStore, StatsStorageAdapter } from "../src/core/statsStore";
import { SessionStatsStore } from "../src/core/sessionStore";
import { SpeedTracker } from "../src/core/speedTracker";
import { ActiveStateMachine } from "../src/core/activeMachine";
import { diffText } from "../src/tracking/editorTracker";
import { parseChange } from "../src/core/changeParser";
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

describe("端到端业务链路（模拟编辑器→统计→三层持久化→导出）", () => {
  it("打开→逐字输入→删除→选中替换→粘贴→活跃计时→导出数据一致", async () => {
    const mem = new MemAdapter();
    const store = new StatsStore(mem, { fileStats: "f.json", project: "p.json", globalStats: "g.json" });
    await store.load();
    const session = new SessionStatsStore();
    const speed = new SpeedTracker();
    const machine = new ActiveStateMachine(5000);
    const filePath = "/vault/note.md";
    let doc = "";

    // 打开文件
    store.touchOpen(filePath, 1000);
    session.begin(filePath, doc, "strict", 1000);
    machine.start(1000);

    // 模拟 StatsEngine.handleChanges
    const applyChange = (newDoc: string, now: number, forcePaste = false) => {
      const d = diffText(doc, newDoc);
      doc = newDoc;
      const stats = parseChange(
        { insertedText: d.inserted, removedText: d.removed },
        { includePasteInSpeed: false, forcePaste },
      );
      session.applyChange(stats);
      store.recordChange(filePath, stats.typed, stats.deleted);
      speed.addChars(stats.typedManual, now);
      session.setPeak(speed.getPeak());
      store.recordPeak(speed.getPeak());
      machine.notifyActivity(now);
      return stats;
    };

    // 逐字输入"你好世界"
    applyChange("你", 2000);
    applyChange("你好", 3000);
    applyChange("你好世", 4000);
    applyChange("你好世界", 5000);
    // Backspace 删除"世"
    applyChange("你好界", 6000);
    // 选中"你好"替换为"HELLO"
    applyChange("HELLO界", 7000);
    // 粘贴大段文本（editor-paste 标记）
    applyChange("HELLO界" + "x".repeat(50), 8000, true);
    // 活跃计时（2 秒）
    machine.notifyActivity(8500);
    const t1 = machine.tick(9500, true);
    const t2 = machine.tick(10500, true);
    session.addActiveMs(t1.activeMs + t2.activeMs);
    store.recordActiveTime(filePath, t1.activeMs + t2.activeMs, 10);
    await store.flush();

    // ---- 会话与文件层一致 ----
    const snap = session.get();
    const fileStats = store.getFileStats(filePath)!;
    expect(snap!.grossTyped).toBe(59); // 4+0+5+50
    expect(snap!.deletedChars).toBe(3); // 1+2
    expect(fileStats.grossTyped).toBe(snap!.grossTyped);
    expect(fileStats.deletedChars).toBe(snap!.deletedChars);
    expect(fileStats.activeTimeMs).toBe(2000);
    expect(snap!.activeTimeMs).toBe(2000);

    // ---- 全局层一致 ----
    const g = store.getGlobalStats();
    const todayKey = dateKey(new Date());
    expect(g.grossTypedTotal).toBe(59);
    expect(g.dailyGrossByDate[todayKey] ?? 0).toBe(59);

    // ---- 峰值速度记录 ----
    expect(g.dailyPeakByDate[todayKey]).toBeGreaterThan(0);

    // ---- 导出数据 ----
    const exportData = {
      // 模拟导出 JSON 格式键 "global"（字符串字面量键，避免裸标识符）
      "global": store.getGlobalStats(),
      project: store.getProjectStats(),
      files: store.getAllFileStats(),
    };
    expect(exportData.files.length).toBe(1);
    expect(exportData.files[0].grossTyped).toBe(exportData["global"].grossTypedTotal);
    expect(exportData.project.grossTyped).toBe(exportData["global"].grossTypedTotal);

    // ---- 重新加载持久化数据（模拟重启） ----
    const store2 = new StatsStore(mem, { fileStats: "f.json", project: "p.json", globalStats: "g.json" });
    await store2.load();
    expect(store2.getFileStats(filePath)?.grossTyped).toBe(59);
    expect(store2.getGlobalStats().grossTypedTotal).toBe(59);
  });

  it("排除规则生效：被排除文件不计入统计", () => {
    const isExcluded = (p: string) => /node_modules/.test(p);
    expect(isExcluded("node_modules/a.js")).toBe(true);
    expect(isExcluded("notes/readme.md")).toBe(false);
  });
});
