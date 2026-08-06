// 功能 5：每日目标达成通知（字数/时长首次达成触发一次，跨天重置）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatsEngine, StatsEngineDeps } from "../src/tracking/statsEngine";
import { StatsStore } from "../src/core/statsStore";
import { SessionStatsStore } from "../src/core/sessionStore";
import type { TypeLogSettings } from "../src/core/settings";

class MemAdapter {
  data = new Map<string, string>();
  async read(path: string) {
    return this.data.get(path) ?? null;
  }
  async write(path: string, content: string) {
    this.data.set(path, content);
  }
}

function makeEngine(overrides: Partial<TypeLogSettings>) {
  const onGoalDue = vi.fn();
  const onUiUpdate = vi.fn();
  const settings: TypeLogSettings = {
    language: "zh",
    countMode: "strict",
    includePasteInSpeed: false,
    idleThresholdSec: 5,
    excludePatterns: [],
    dailyWordGoal: 2000,
    dailyTimeGoalMin: 120,
    weeklyWordGoal: 0,
    weeklyTimeGoalMin: 0,
    goalNotify: true,
    pomodoroEnabled: false,
    pomodoroMinutes: 25,
    pomodoroMode: "active",
    showStatusBar: true,
    windowMode: "sidebar",
    popoutAlwaysOnTop: true,
    purgeInactiveDays: 0,
    dailyRetentionDays: 0,
    statusBarItems: [],
    ...overrides,
  };
  const store = new StatsStore(new MemAdapter() as never, { fileStats: "f", project: "p", globalStats: "g" });
  const deps: StatsEngineDeps = {
    workspace: {} as never,
    vault: { cachedRead: async () => "" } as never,
    getSettings: () => settings,
    store,
    session: new SessionStatsStore(),
    isExcluded: () => false,
    onUiUpdate,
    onPomodoroDue: vi.fn(),
    onGoalDue,
  };
  const engine = new StatsEngine(deps);
  const tick = () => (engine as unknown as { tick(): void }).tick();
  return { store, onGoalDue, tick };
}

describe("功能 5：每日目标达成通知", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("字数目标达成触发一次，同日不重复", () => {
    vi.setSystemTime(new Date(2026, 7, 6, 9, 0, 0));
    const { store, onGoalDue, tick } = makeEngine({ dailyWordGoal: 100, dailyTimeGoalMin: 0 });
    store.recordChange("a.md", 60, 0);
    tick();
    expect(onGoalDue).not.toHaveBeenCalled(); // 未达标
    store.recordChange("a.md", 40, 0); // 当日累计 100
    tick();
    expect(onGoalDue).toHaveBeenCalledTimes(1);
    tick();
    expect(onGoalDue).toHaveBeenCalledTimes(1); // 同日不重复
  });

  it("时长目标达成同样触发", () => {
    vi.setSystemTime(new Date(2026, 7, 6, 9, 0, 0));
    const { store, onGoalDue, tick } = makeEngine({ dailyWordGoal: 0, dailyTimeGoalMin: 10 });
    store.recordActiveTime("a.md", 9 * 60_000, 9);
    tick();
    expect(onGoalDue).not.toHaveBeenCalled(); // 9 分钟未达标
    store.recordActiveTime("a.md", 60_000, 9); // 累计 10 分钟
    tick();
    expect(onGoalDue).toHaveBeenCalledTimes(1);
  });

  it("跨天重置：次日可再次通知", () => {
    const T0 = new Date(2026, 7, 6, 9, 0, 0).getTime();
    vi.setSystemTime(T0);
    const { store, onGoalDue, tick } = makeEngine({ dailyWordGoal: 100, dailyTimeGoalMin: 0 });
    store.recordChange("a.md", 100, 0);
    tick();
    expect(onGoalDue).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 86_400_000); // 次日
    store.recordChange("a.md", 100, 0); // 次日累计 100
    tick();
    expect(onGoalDue).toHaveBeenCalledTimes(2);
  });

  it("goalNotify 关闭时不触发", () => {
    vi.setSystemTime(new Date(2026, 7, 6, 9, 0, 0));
    const { store, onGoalDue, tick } = makeEngine({ goalNotify: false, dailyWordGoal: 1, dailyTimeGoalMin: 0 });
    store.recordChange("a.md", 100, 0);
    tick();
    expect(onGoalDue).not.toHaveBeenCalled();
  });
});
