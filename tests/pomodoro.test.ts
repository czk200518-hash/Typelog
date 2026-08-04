// 番茄钟回归测试：验证由用户手动启动计时（非插件启动即计时），
// 连续活跃达到设定时长触发提醒、闲置中断重新起算、切换文件不打断、手动停止不再计时。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatsEngine, StatsEngineDeps } from "../src/tracking/statsEngine";
import { StatsStore } from "../src/core/statsStore";
import { SessionStatsStore } from "../src/core/sessionStore";
import type { TypeLogSettings } from "../src/core/settings";

// 最小可用的内存存储（复用 e2e 的写法）
class MemAdapter {
  data = new Map<string, string>();
  async read(path: string) {
    return this.data.get(path) ?? null;
  }
  async write(path: string, content: string) {
    this.data.set(path, content);
  }
}

function createEngine(pomodoroMinutes = 1, idleThresholdSec = 5) {
  const onPomodoroDue = vi.fn();
  const onUiUpdate = vi.fn();
  const settings: TypeLogSettings = {
    language: "zh",
    countMode: "strict",
    includePasteInSpeed: false,
    idleThresholdSec,
    excludePatterns: [],
    dailyWordGoal: 2000,
    dailyTimeGoalMin: 120,
    pomodoroEnabled: true,
    pomodoroMinutes,
    pomodoroMode: "active",
    showStatusBar: true,
    windowMode: "sidebar",
    popoutAlwaysOnTop: true,
    purgeInactiveDays: 0,
    dailyRetentionDays: 0,
  };
  const deps: StatsEngineDeps = {
    workspace: {} as never,
    vault: { cachedRead: async () => "" } as never,
    getSettings: () => settings,
    store: new StatsStore(new MemAdapter() as never, {
      fileStats: "f.json",
      project: "p.json",
      globalStats: "g.json",
    }),
    session: new SessionStatsStore(),
    isExcluded: () => false,
    onUiUpdate,
    onPomodoroDue,
  };
  return { engine: new StatsEngine(deps), deps, onPomodoroDue, settings };
}

// 连续活跃：每 1 秒 notifyActivity + tick（模拟键盘/编辑心跳）
function tickActive(engine: StatsEngine, from: number, seconds: number) {
  const m = engine as unknown as {
    activeMachine: { notifyActivity(n: number): void; tick(n: number, f: boolean): { active: boolean; activeMs: number } };
    currentPath: string | null;
    tick(): void;
  };
  m.activeMachine.notifyActivity(from);
  for (let i = 1; i <= seconds; i++) {
    m.activeMachine.notifyActivity(from + i * 1000);
    vi.setSystemTime(from + i * 1000);
    m.tick();
  }
}

// 设置前台文件（等价于打开一个统计文件）
function openFile(engine: StatsEngine, path: string) {
  const m = engine as unknown as { handleFileOpen(f: { path: string }): void };
  m.handleFileOpen({ path });
}

describe("番茄钟（手动启动）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("未手动开始时，连续活跃也不触发提醒（不再随插件启动自动计时）", () => {
    const { engine, onPomodoroDue } = createEngine(1);
    openFile(engine, "a.md");
    expect(engine.isPomodoroRunning()).toBe(false);
    tickActive(engine, 1_700_000_000_000, 61);
    expect(onPomodoroDue).not.toHaveBeenCalled();
  });

  it("手动开始后连续活跃达到设定时长触发一次提醒，且不重复触发", () => {
    const { engine, onPomodoroDue } = createEngine(1); // 1 分钟
    openFile(engine, "a.md");
    expect(engine.startPomodoro()).toBe(true);
    tickActive(engine, 1_700_000_000_000, 60);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
    // 达到后不重复触发
    tickActive(engine, 1_700_000_060_000, 5);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("手动停止后不再计时", () => {
    const { engine, onPomodoroDue } = createEngine(1);
    openFile(engine, "a.md");
    engine.startPomodoro();
    tickActive(engine, 1_700_000_000_000, 30);
    engine.stopPomodoro();
    expect(engine.isPomodoroRunning()).toBe(false);
    tickActive(engine, 1_700_000_030_000, 40);
    expect(onPomodoroDue).not.toHaveBeenCalled();
  });

  it("未开启番茄钟时无法手动开始", () => {
    const { engine, settings } = createEngine(1);
    settings.pomodoroEnabled = false;
    expect(engine.startPomodoro()).toBe(false);
    expect(engine.isPomodoroRunning()).toBe(false);
  });

  it("被闲置中断重置后，恢复活跃能重新起算并再次触发（回归：基准时间归零无法重新累计）", () => {
    const { engine, onPomodoroDue } = createEngine(1, 5);
    openFile(engine, "a.md");
    engine.startPomodoro();
    // 活跃 40 秒（未达 60 秒目标）
    tickActive(engine, 1_700_000_000_000, 40);
    expect(onPomodoroDue).not.toHaveBeenCalled();
    // 闲置 6 秒（超过 idleThresholdSec=5）→ 重置基准
    const m = engine as unknown as {
      activeMachine: { tick(n: number, f: boolean): { active: boolean; activeMs: number } };
      pomodoroStartedAt: number;
      tick(): void;
    };
    vi.setSystemTime(1_700_000_046_000);
    m.activeMachine.tick(1_700_000_046_000, true);
    m.tick();
    expect(m.pomodoroStartedAt).toBe(0);
    // 恢复活跃：应重新起算而不是永远为 0
    tickActive(engine, 1_700_000_047_000, 61);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("切换文件不打断番茄钟累计（连续编辑场景）", () => {
    const { engine, onPomodoroDue } = createEngine(1, 5);
    engine.startPomodoro();
    // 文件 A 活跃 30 秒
    openFile(engine, "a.md");
    tickActive(engine, 1_700_000_000_000, 30);
    // 切到文件 B 继续编辑 31 秒（共 61 秒）
    openFile(engine, "b.md");
    tickActive(engine, 1_700_000_030_000, 31);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("剩余时间随活跃累计递减，达到后归零", () => {
    const { engine } = createEngine(1);
    openFile(engine, "a.md");
    engine.startPomodoro();
    expect(engine.getPomodoroRemainingMs()).toBe(60_000);
    tickActive(engine, 1_700_000_000_000, 30);
    expect(engine.getPomodoroRemainingMs()).toBe(30_000);
    tickActive(engine, 1_700_000_030_000, 31);
    expect(engine.getPomodoroRemainingMs()).toBe(0);
  });

  // ---- 纯计时模式（real）：不依赖打字，按真实时间流逝 ----
  it("纯计时模式：即使不活跃也按真实时间计时", () => {
    const { engine, onPomodoroDue, settings } = createEngine(1, 5);
    settings.pomodoroMode = "real";
    openFile(engine, "a.md");
    engine.startPomodoro(); // startedAt = T0
    // 不做任何活跃操作，直接流逝 60 秒后触发心跳
    const m = engine as unknown as { tick(): void };
    vi.setSystemTime(1_700_000_060_000);
    m.tick();
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("纯计时模式：闲置不重置累计，可跨闲置累计到目标", () => {
    const { engine, onPomodoroDue, settings } = createEngine(1, 5);
    settings.pomodoroMode = "real";
    openFile(engine, "a.md");
    engine.startPomodoro();
    // 活跃 30 秒（活跃模式下会因闲置重置，纯计时不应重置）
    tickActive(engine, 1_700_000_000_000, 30);
    expect(onPomodoroDue).not.toHaveBeenCalled();
    // 闲置 10 秒（超过 idleThresholdSec=5）
    const m = engine as unknown as { pomodoroStartedAt: number; tick(): void };
    vi.setSystemTime(1_700_000_040_000);
    m.tick();
    expect(m.pomodoroStartedAt).toBe(1_700_000_000_000);
    // 再流逝 21 秒 → 启动后总计 61 秒
    vi.setSystemTime(1_700_000_061_000);
    m.tick();
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("纯计时模式：剩余时间按真实时间递减", () => {
    const { engine, settings } = createEngine(1);
    settings.pomodoroMode = "real";
    openFile(engine, "a.md");
    engine.startPomodoro();
    expect(engine.getPomodoroRemainingMs()).toBe(60_000);
    vi.setSystemTime(1_700_000_030_000);
    expect(engine.getPomodoroRemainingMs()).toBe(30_000);
  });

  // ---- 暂停 / 继续 ----
  it("暂停冻结计时，继续后跨段累计并触发提醒（纯计时）", () => {
    const { engine, onPomodoroDue, settings } = createEngine(1, 5);
    settings.pomodoroMode = "real";
    openFile(engine, "a.md");
    engine.startPomodoro(); // T0
    // 活跃 30 秒（累计 30s）
    tickActive(engine, 1_700_000_000_000, 30);
    expect(onPomodoroDue).not.toHaveBeenCalled();
    expect(engine.getPomodoroRemainingMs()).toBe(30_000);
    // 暂停：冻结在 30s
    engine.pausePomodoro();
    expect(engine.isPomodoroPaused()).toBe(true);
    expect(engine.isPomodoroRunning()).toBe(true);
    // 暂停期间流逝 10 秒：不计时
    const m = engine as unknown as { pomodoroElapsedMs: number; tick(): void };
    vi.setSystemTime(1_700_000_040_000);
    m.tick();
    expect(m.pomodoroElapsedMs).toBe(30_000);
    expect(engine.getPomodoroRemainingMs()).toBe(30_000);
    // 继续：再计 31 秒 → 累计 61s 触发一次
    engine.resumePomodoro();
    expect(engine.isPomodoroPaused()).toBe(false);
    tickActive(engine, 1_700_000_041_000, 31);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("暂停期间闲置不重置累计（活跃计时）", () => {
    const { engine, onPomodoroDue } = createEngine(1, 5); // active 模式
    openFile(engine, "a.md");
    engine.startPomodoro();
    tickActive(engine, 1_700_000_000_000, 30); // 活跃 30s
    engine.pausePomodoro();
    // 暂停并闲置 40 秒：不应触发“闲置重置”
    const m = engine as unknown as { pomodoroElapsedMs: number; tick(): void };
    vi.setSystemTime(1_700_000_070_000);
    m.tick();
    expect(m.pomodoroElapsedMs).toBe(30_000);
    expect(engine.getPomodoroRemainingMs()).toBe(30_000);
    // 继续并再活跃 31 秒 → 累计 61s 触发
    engine.resumePomodoro();
    tickActive(engine, 1_700_000_071_000, 31);
    expect(onPomodoroDue).toHaveBeenCalledTimes(1);
  });

  it("停止（含暂停状态）后完全复位，可重新开始", () => {
    const { engine, settings } = createEngine(1);
    settings.pomodoroMode = "real";
    openFile(engine, "a.md");
    engine.startPomodoro();
    tickActive(engine, 1_700_000_000_000, 30);
    engine.pausePomodoro();
    expect(engine.isPomodoroPaused()).toBe(true);
    engine.stopPomodoro();
    expect(engine.isPomodoroRunning()).toBe(false);
    expect(engine.isPomodoroPaused()).toBe(false);
    expect(engine.getPomodoroRemainingMs()).toBe(0);
    // 停止后重新开始：从头累计
    expect(engine.startPomodoro()).toBe(true);
    expect(engine.getPomodoroRemainingMs()).toBe(60_000);
  });

  it("未启动时暂停/继续无副作用", () => {
    const { engine } = createEngine(1);
    engine.pausePomodoro();
    expect(engine.isPomodoroPaused()).toBe(false);
    engine.resumePomodoro();
    expect(engine.isPomodoroRunning()).toBe(false);
    expect(engine.isPomodoroPaused()).toBe(false);
  });
});
