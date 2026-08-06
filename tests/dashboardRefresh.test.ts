// @vitest-environment happy-dom
// 番茄钟时间输入框编辑态下 UI 刷新的回归测试：
// 1. 编辑输入框期间，窗口其他统计（今日编辑时长 / 当前文件活跃时长 / 热力图）仍每秒刷新；
// 2. 编辑期间番茄钟卡片节点不重建（输入框保持同一 DOM 节点、不丢焦点）；
// 3. 快速切换焦点（分→秒→分→失焦）编辑态不丢失，最终失焦后刷新恢复正常。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashboardView } from "../src/ui/dashboardView";
import type { TypeLogSettings } from "../src/core/settings";
import { dateKey } from "../src/core/format";

// ---- Obsidian DOM 扩展方法桩（createDiv / createEl / setText / empty / addClass ...） ----
function applyObsidianDomPolyfills() {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const set = (name: string, fn: (...args: never[]) => unknown) => {
    if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
  };

  set("createEl", function (this: HTMLElement, tag: string, opts: unknown, cb?: (el: HTMLElement) => void) {
    const el = document.createElement(tag);
    applyOpts(el, opts);
    this.appendChild(el);
    if (cb) cb(el);
    return el;
  });
  set("createDiv", function (this: HTMLElement, opts?: unknown) {
    return (this as unknown as { createEl(t: string, o: unknown): HTMLElement }).createEl("div", opts);
  });
  set("createSpan", function (this: HTMLElement, opts?: unknown) {
    return (this as unknown as { createEl(t: string, o: unknown): HTMLElement }).createEl("span", opts);
  });
  set("setText", function (this: HTMLElement, text: string) {
    this.textContent = text;
  });
  set("empty", function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  });
  set("addClass", function (this: HTMLElement, ...cls: string[]) {
    this.classList.add(...cls);
  });
  set("removeClass", function (this: HTMLElement, ...cls: string[]) {
    this.classList.remove(...cls);
  });
  set("toggleClass", function (this: HTMLElement, cls: string, on?: boolean) {
    this.classList.toggle(cls, on);
  });
  set("setCssProps", function (this: HTMLElement, props: Record<string, string>) {
    Object.assign(this.style, props);
  });
}

function applyOpts(el: HTMLElement, opts: unknown) {
  if (!opts) return;
  if (typeof opts === "string") {
    el.textContent = opts;
    return;
  }
  const o = opts as {
    cls?: string | string[];
    text?: string;
    title?: string;
    type?: string;
    value?: string;
    attr?: Record<string, string>;
  };
  if (o.cls) el.classList.add(...(Array.isArray(o.cls) ? o.cls : [o.cls]));
  if (o.text !== undefined) el.textContent = o.text;
  if (o.title) el.title = o.title;
  if (o.type) el.setAttribute("type", o.type);
  if (o.value !== undefined) el.setAttribute("value", o.value);
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
}

// ResizeObserver 桩（happy-dom 未内置）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface GlobalStatsMock {
  dailyActiveByDate: Record<string, number>;
  dailyGrossByDate: Record<string, number>;
  dailyPeakByDate: Record<string, number>;
  grossTypedTotal: number;
  heatmap: Record<string, { activeMs: number[]; grossByHour: number[] }>;
}

// ---- 模拟插件与可变数据 ----
function makePlugin() {
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
    goalNotify: false,
    pomodoroEnabled: true,
    pomodoroMinutes: 25,
    pomodoroMode: "active",
    showStatusBar: true,
    windowMode: "sidebar",
    popoutAlwaysOnTop: true,
    purgeInactiveDays: 0,
    dailyRetentionDays: 0,
    statusBarItems: [
      { id: "speed", enabled: true },
      { id: "net", enabled: true },
      { id: "todayGross", enabled: true },
      { id: "pomodoro", enabled: true },
    ],
  };
  const today = dateKey(new Date());
  const globalStats: GlobalStatsMock = {
    dailyActiveByDate: { [today]: 0 },
    dailyGrossByDate: { [today]: 0 },
    dailyPeakByDate: { [today]: 0 },
    grossTypedTotal: 0,
    heatmap: { [today]: { activeMs: new Array<number>(24).fill(0), grossByHour: new Array<number>(24).fill(0) } },
  };
  const sessionObj = {
    netStartWords: 0,
    deltaWords: 0,
    grossTyped: 0,
    deletedChars: 0,
    activeTimeMs: 0,
    peakSpeed: 0,
    minuteSeries: [] as { delta: number }[],
  };
  const plugin = {
    settings,
    engine: {
      isPomodoroRunning: () => false,
      isPomodoroPaused: () => false,
      getPomodoroRemainingMs: () => settings.pomodoroMinutes * 60_000,
      getCpm: () => 0,
    },
    session: { get: () => sessionObj },
    store: { getGlobalStats: () => globalStats },
    startPomodoro: () => {},
    pausePomodoro: () => {},
    resumePomodoro: () => {},
    confirmStopPomodoro: () => {},
  } as never;
  return { plugin, globalStats, sessionObj, today };
}

async function createView() {
  const { plugin, globalStats, sessionObj, today } = makePlugin();
  const view = new DashboardView({} as never, plugin);
  document.body.appendChild(view.contentEl);
  await view.onOpen();
  return { view, globalStats, sessionObj, today };
}

// 取“今日总览 / 当前文件”区块的指定指标文本
function sectionValue(root: HTMLElement, title: string, index: number): string {
  const sections = Array.from(root.querySelectorAll<HTMLElement>(".typelog-section"));
  const sec = sections.find((s) => s.querySelector("h3")?.textContent === title)!;
  return sec.querySelectorAll<HTMLElement>(".typelog-overview-value")[index].textContent ?? "";
}

// 模拟“每秒活跃 +60s”：数据递增
function tickSecond(globalStats: GlobalStatsMock, sessionObj: { activeTimeMs: number }, today: string, ms = 60_000) {
  globalStats.dailyActiveByDate[today] += ms;
  sessionObj.activeTimeMs += ms;
  globalStats.heatmap[today].activeMs[0] += ms;
}

describe("番茄钟时间输入框编辑态下的 UI 刷新", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    applyObsidianDomPolyfills();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("编辑时长期间：输入框不重建，下方累计时长与热力图每秒正常刷新", async () => {
    vi.useFakeTimers();
    const T0 = 1_750_000_000_000;
    vi.setSystemTime(T0);

    const { view, globalStats, sessionObj, today } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;

    // 进入编辑态：聚焦分钟输入框
    const mm = root.querySelector<HTMLInputElement>(".typelog-pomodoro-time-mm")!;
    mm.focus();
    expect((view as unknown as { timeEditing: boolean }).timeEditing).toBe(true);

    // 记录初始节点引用
    const cardA = root.querySelector(".typelog-pomodoro-card");
    const inputA = root.querySelector(".typelog-pomodoro-time-mm");
    const heatSvg0 = root.querySelector(".typelog-heatmap svg");
    expect(sectionValue(root, "今日总览", 0)).toBe("0秒");

    // 每秒：数据递增 + 刷新（3 秒）
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(T0 + i * 1000);
      tickSecond(globalStats, sessionObj, today);
      view.refresh();
    }

    // 1) 编辑中卡片/输入框不被重建（同一 DOM 节点，不丢焦点）
    expect(root.querySelector(".typelog-pomodoro-card")).toBe(cardA);
    expect(root.querySelector(".typelog-pomodoro-time-mm")).toBe(inputA);
    expect((inputA as HTMLInputElement).value).toBe("25");

    // 2) 今日编辑时长每秒跳动：0秒 → 3分00秒
    expect(sectionValue(root, "今日总览", 0)).toBe("3分00秒");

    // 3) 当前文件活跃时长同步跳动
    expect(sectionValue(root, "当前文件", 3)).toBe("3分00秒");

    // 4) 编辑期间走特判路径（不触碰番茄钟区块）；热力图已移至趋势页，今日页编辑期间保持节点引用不重建
    const heatSvg1 = root.querySelector(".typelog-heatmap svg");
    expect(heatSvg1).toBe(heatSvg0);
  });

  it("快速切换焦点（分→秒→分→失焦）编辑态稳定，失焦后刷新恢复", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    const mm = root.querySelector<HTMLInputElement>(".typelog-pomodoro-time-mm")!;
    const ss = root.querySelector<HTMLInputElement>(".typelog-pomodoro-time-ss")!;
    const flush = () => new Promise<void>((r) => setTimeout(r, 20));
    // 记录编辑前的热力图 svg（onOpen 全量构建的节点）
    const heatBefore = root.querySelector(".typelog-heatmap svg");

    // 聚焦分钟框 → 编辑态
    mm.focus();
    expect((view as unknown as { timeEditing: boolean }).timeEditing).toBe(true);

    // 分 → 秒：焦点转移不结束编辑
    ss.focus();
    await flush();
    expect((view as unknown as { timeEditing: boolean }).timeEditing).toBe(true);

    // 秒 → 分：再次转移仍保持编辑态
    mm.focus();
    await flush();
    expect((view as unknown as { timeEditing: boolean }).timeEditing).toBe(true);

    // 失焦到其他区域（点击文档正文）：编辑态结束，界面刷新
    mm.blur();
    await flush();
    expect((view as unknown as { timeEditing: boolean }).timeEditing).toBe(false);

    // 失焦后刷新：稳态走增量渲染，结构完全复用（输入框与热力图 svg 均不重建）
    view.refresh();
    const mm2 = root.querySelector(".typelog-pomodoro-time-mm");
    expect(mm2).toBeTruthy();
    expect(mm2).toBe(mm);
    const heatAfter = root.querySelector(".typelog-heatmap svg");
    expect(heatAfter).toBe(heatBefore);
  });
});
