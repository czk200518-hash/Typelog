// @vitest-environment happy-dom
// 功能 1 回归测试：统计窗口标签页结构（今日/趋势）
// 1. 标签栏渲染与激活态；
// 2. 切到「趋势」页：趋势区块 + 柱状图渲染，范围/指标切换重建；
// 3. 页面显隐（非激活页保留 DOM，隐藏而非销毁）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashboardView } from "../src/ui/dashboardView";
import type { TypeLogSettings } from "../src/core/settings";
import { dateKey } from "../src/core/format";

// ---- Obsidian DOM 扩展方法桩（与 dashboardRefresh.test.ts 一致） ----
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
  const o = opts as { cls?: string | string[]; text?: string; title?: string };
  if (o.cls) el.classList.add(...(Array.isArray(o.cls) ? o.cls : [o.cls]));
  if (o.text !== undefined) el.textContent = o.text;
  if (o.title) el.title = o.title;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
  // 构造近 7 天的趋势数据：每天 gross 递增、active 固定、peak 固定
  const dailyGrossByDate: Record<string, number> = {};
  const dailyActiveByDate: Record<string, number> = {};
  const dailyPeakByDate: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    dailyGrossByDate[k] = 100 + (6 - i) * 50;
    dailyActiveByDate[k] = 60_000 * (6 - i);
    dailyPeakByDate[k] = 40 + (6 - i);
  }
  const globalStats = {
    dailyActiveByDate,
    dailyGrossByDate,
    dailyPeakByDate,
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
  return { plugin, globalStats };
}

async function createView() {
  const { plugin, globalStats } = makePlugin();
  const view = new DashboardView({} as never, plugin);
  document.body.appendChild(view.contentEl);
  await view.onOpen();
  return { view, globalStats };
}

function tabBtn(root: HTMLElement, tab: string): HTMLElement {
  return root.querySelector<HTMLElement>(`.typelog-dashboard-tab.typelog-tab-${tab}`)!;
}

describe("功能 1：统计窗口标签页结构", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    applyObsidianDomPolyfills();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("标签栏渲染：今日激活、趋势未激活；今日页可见、趋势页隐藏", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    expect(tabBtn(root, "today")).toBeTruthy();
    expect(tabBtn(root, "trend")).toBeTruthy();
    expect(tabBtn(root, "today").classList.contains("is-active")).toBe(true);
    expect(tabBtn(root, "trend").classList.contains("is-active")).toBe(false);
    expect(root.querySelector(".typelog-tab-page-today")?.classList.contains("is-hidden")).toBe(false);
    expect(root.querySelector(".typelog-tab-page-trend")?.classList.contains("is-hidden")).toBe(true);
  });

  it("切换到趋势页：趋势区块 + 柱状图渲染，今日页隐藏", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    tabBtn(root, "trend").click();
    expect(tabBtn(root, "trend").classList.contains("is-active")).toBe(true);
    expect(root.querySelector(".typelog-tab-page-trend")?.classList.contains("is-hidden")).toBe(false);
    expect(root.querySelector(".typelog-tab-page-today")?.classList.contains("is-hidden")).toBe(true);
    const trendSec = root.querySelector<HTMLElement>(".typelog-section-trend")!;
    expect(trendSec).toBeTruthy();
    // 柱状图：7 根柱（近 7 天）
    const bars = Array.from(trendSec.querySelectorAll<SVGRectElement>("rect"));
    expect(bars.length).toBe(7);
    // 今天（最后一根）绿色高亮
    expect(bars[6].getAttribute("fill")).toBe("var(--color-green)");
  });

  it("范围切换 7→30 天：柱体数量从 7 变 30", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    tabBtn(root, "trend").click();
    const rangeBtns = Array.from(root.querySelectorAll<HTMLElement>(".typelog-trend-btn"));
    const btn30 = rangeBtns.find((b) => b.textContent === "30 天")!;
    btn30.click();
    const trendSec = root.querySelector<HTMLElement>(".typelog-section-trend")!;
    expect(trendSec.querySelectorAll<SVGRectElement>("rect").length).toBe(30);
  });

  it("指标切换 字数→活跃时长：柱体高度随数据变化", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    tabBtn(root, "trend").click();
    const metricBtns = Array.from(root.querySelectorAll<HTMLElement>(".typelog-trend-btn"));
    const activeBtn = metricBtns.find((b) => b.textContent === "活跃时长")!;
    activeBtn.click();
    const trendSec = root.querySelector<HTMLElement>(".typelog-section-trend")!;
    // 活跃时长数据：第 5 天为 0，柱高 ~0.5 下限；第 6 天为 60s，柱高 > 第 5 天
    const bars = Array.from(trendSec.querySelectorAll<SVGRectElement>("rect"));
    expect(parseFloat(bars[5].getAttribute("height")!)).toBeLessThan(parseFloat(bars[6].getAttribute("height")!));
  });

  it("切回今日页：今日页重新可见且区块仍在", async () => {
    const { view } = await createView();
    const root = view.contentEl.querySelector<HTMLElement>(".typelog-dashboard")!;
    tabBtn(root, "trend").click();
    tabBtn(root, "today").click();
    expect(root.querySelector(".typelog-tab-page-today")?.classList.contains("is-hidden")).toBe(false);
    expect(root.querySelector(".typelog-tab-page-trend")?.classList.contains("is-hidden")).toBe(true);
    // 今日页三区块完整（热力图已移至趋势页）
    expect(root.querySelector(".typelog-section-ov")).toBeTruthy();
    expect(root.querySelector(".typelog-section-pomo")).toBeTruthy();
    expect(root.querySelector(".typelog-section-file")).toBeTruthy();
    // 热力图位于趋势页：今日页不含，趋势页含
    expect(root.querySelector(".typelog-tab-page-today .typelog-section-heat")).toBeNull();
    expect(root.querySelector(".typelog-tab-page-trend .typelog-section-heat")).toBeTruthy();
  });
});
