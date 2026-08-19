import { ItemView, WorkspaceLeaf } from "obsidian";
import type TypeLogPlugin from "../main";
import { dateKey, formatDuration, formatNumber, pad2, weekSum } from "../core/format";
import { renderBarChart, renderLineChart, renderHeatmap, renderRingProgress, type BarPoint, type RingProgressHandle } from "./svg";
import { t } from "../core/i18n";

export const VIEW_TYPE_TYPELOG = "typelog-dashboard";

// 热力图 6 级色阶（与 svg.ts renderHeatmap 内部分级一致，供增量更新今日格 fill）
const HEAT_COLORS = ["var(--background-modifier-border)", "#d7f0e0", "#a6e2ba", "#5cc786", "#2ea85f", "#1d8a49"];

// 按维度把日总值映射为 0-5 级（活跃=分钟阈值；字数=字符阈值，二者量纲不同）
function heatLevel(value: number, mode: "active" | "gross"): number {
  if (value <= 0) return 0;
  if (mode === "active") {
    const minutes = value / 60_000;
    if (minutes < 5) return 1;
    if (minutes < 15) return 2;
    if (minutes < 30) return 3;
    if (minutes < 45) return 4;
    return 5;
  }
  if (value < 200) return 1;
  if (value < 500) return 2;
  if (value < 1000) return 3;
  if (value < 2000) return 4;
  return 5;
}

export class DashboardView extends ItemView {
  private root!: HTMLElement;
  private lastRender = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  // 精简模式（悬浮窗）：只显示核心指标，不显示曲线图/热力图/目标环
  private isCompact = false;
  // 是否悬浮窗（popout）：启用置顶拉回
  private isPopout = false;
  // 是否正在编辑番茄钟时间输入框（编辑期间跳过自动重绘，避免失焦）
  private timeEditing = false;
  // ---- 增量渲染缓存：结构只构建一次，秒级刷新仅 setText/setAttribute ----
  // 结构是否已构建（首次/跨天/跨月/尺寸变化/模式切换时为 false，触发全量重建）
  private structureBuilt = false;
  private renderTodayKey = "";
  private renderMonthKey = "";
  // 今日总览区块
  private ovActiveEl!: HTMLElement;
  private ovGrossEl!: HTMLElement;
  private ovPeakEl!: HTMLElement;
  private wordRing: RingProgressHandle | null = null;
  private wordLabelEl!: HTMLElement;
  private timeRing: RingProgressHandle | null = null;
  private timeLabelEl!: HTMLElement;
  // 周目标环（功能 7；对应目标为 0 时不构建，引用为 null）
  private weekWordRing: RingProgressHandle | null = null;
  private weekWordLabelEl!: HTMLElement;
  private weekTimeRing: RingProgressHandle | null = null;
  private weekTimeLabelEl!: HTMLElement;
  // 当前文件区块
  private fileNetEl!: HTMLElement;
  private fileGrossEl!: HTMLElement;
  private fileDeletedEl!: HTMLElement;
  private fileActiveEl!: HTMLElement;
  private fileCpmEl!: HTMLElement;
  // 曲线采样长度（变化时重绘当前文件区块；-1=无会话）
  private chartLen = -1;
  // 热力图区块：今日格 rect 引用（同月内仅更新该格 fill）
  private heatTodayRect: SVGRectElement | null = null;
  // 番茄钟区块
  private pomoStateCached = "";
  private pomoTimeEl: HTMLElement | null = null;
  private pomoBarFillEl!: HTMLElement;
  // ---- 标签页结构（功能 1）：顶部标签栏 + 「今日/趋势」两页 ----
  // 当前激活页（今日页为默认；趋势页含范围/指标切换）
  private activeTab: "today" | "trend" = "today";
  private tabBar!: HTMLElement;
  private tabTodayBtn!: HTMLElement;
  private tabTrendBtn!: HTMLElement;
  private todayPage!: HTMLElement;
  private trendPage!: HTMLElement;
  // 趋势页状态：范围（天数）与指标（gross/active/peak）
  private trendRange: 7 | 30 = 7;
  private trendMetric: "gross" | "active" | "peak" = "gross";
  // 热力图维度（优化 3）：active=活跃时长 / gross=字数分布
  private heatMode: "active" | "gross" = "active";

  constructor(leaf: WorkspaceLeaf, private plugin: TypeLogPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TYPELOG;
  }

  getDisplayText(): string {
    return t("brand.name");
  }

  getIcon(): string {
    return "bar-chart-2";
  }

  setCompact(v: boolean) {
    this.isCompact = v;
    // 模式切换：结构与全模式不同，强制下次全量重建
    this.structureBuilt = false;
    if (this.root) this.render();
  }

  // 语言切换：强制全量重建使全部文本按新语言显示
  applyLanguage() {
    this.structureBuilt = false;
    if (this.root) this.render();
  }

  setPopout(v: boolean) {
    this.isPopout = v;
  }

  async onOpen() {
    this.timeEditing = false;
    this.root = this.contentEl.createDiv({ cls: "typelog-dashboard" });
    this.render();
    // 容器尺寸变化时重绘（拖动窗口时内容随宽度重排而非整体缩放）
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer !== null) return;
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        if (this.root) {
          // 容器尺寸变化：图表宽度需重排，强制全量重建
          this.structureBuilt = false;
          this.render();
        }
      }, 150);
    });
    this.resizeObserver.observe(this.root);
    // 悬浮窗置顶：失焦后自动拉回
    const win = this.getOwnWindow();
    if (win) win.addEventListener("blur", this.handleBlur);
  }

  async onClose() {
    const win = this.getOwnWindow();
    if (win) win.removeEventListener("blur", this.handleBlur);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.contentEl.empty();
  }

  // 当前视图窗口（popout 为悬浮窗窗口）
  getOwnWindow(): Window | null {
    return this.contentEl.ownerDocument.defaultView;
  }

  // 悬浮窗失焦自动拉回置顶
  private handleBlur = () => {
    if (!this.isPopout || !this.plugin.settings.popoutAlwaysOnTop) return;
    const win = this.getOwnWindow();
    if (!win) return;
    let attempts = 0;
    const pullBack = () => {
      if (attempts++ >= 2) return;
      window.setTimeout(() => {
        try {
          // 仅当 Obsidian 主窗口仍在前台时拉回，避免打断切换其他应用
          if (document.hasFocus() && !win.document.hidden) {
            win.focus();
            pullBack();
          }
        } catch {
          // 窗口已关闭等场景忽略
        }
      }, 100);
    };
    pullBack();
  };

  // 300ms 节流刷新：引擎每秒回调一次，节流阈值必须明显小于 1s，
  // 否则渲染相位偏移会跳过整秒（显示从 1 秒直接跳到 3 秒），造成“跳秒”假象
  refresh() {
    const now = Date.now();
    if (now - this.lastRender < 300) return;
    this.lastRender = now;
    if (this.root) this.render();
  }

  // 兼容 easy-keep-view 等插件对视图统一调用
  refreshContent() {
    this.refresh();
  }

  // 渲染入口：优先走增量更新（结构一次构建 + 数值 setText）；
  // 首次 / 跨天 / 跨月 / 尺寸变化 / 模式切换 / 编辑态 时回退全量或局部重建
  private render() {
    const el = this.root;
    const compact = this.isCompact;

    // 编辑番茄钟时间时：只原位重建统计区块，番茄钟区块节点完全不触碰（避免移除聚焦元素导致失焦）。
    // 热力图位于趋势页，不受影响，无需重建
    if (this.timeEditing && !compact) {
      this.replaceSection(el, "typelog-section-ov", (p) => this.buildOverviewSection(p));
      this.replaceSection(el, "typelog-section-file", (p) => this.buildFileSection(p));
      return;
    }

    // ---- 悬浮窗精简模式：仅今日三数据（结构简单，直接重建） ----
    if (compact) {
      el.empty();
      el.toggleClass("typelog-compact", true);
      const globalStats = this.plugin.store.getGlobalStats();
      const todayKey = dateKey(new Date());
      const compactRow = el.createDiv({ cls: "typelog-overview-row typelog-compact-row" });
      this.statItem(compactRow, t("dash.todayActive"), formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));
      this.statItem(compactRow, t("dash.todayGross"), formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));
      this.statItem(compactRow, t("dash.todayPeak"), `${formatNumber(globalStats.dailyPeakByDate[todayKey] ?? 0)} ${t("sb.speedUnit")}`);
      return;
    }

    const now = new Date();
    const todayKey = dateKey(now);
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;

    // 首次 / 跨天 / 跨月 / 结构缺失 → 全量重建
    if (!this.structureBuilt || this.renderTodayKey !== todayKey || this.renderMonthKey !== monthKey) {
      this.fullRender(now, todayKey, monthKey);
      return;
    }

    // 稳态：仅更新变化的数值文本与少量属性
    this.updateValues(now, todayKey);
  }

  // 全量重建：标签栏 + 「今日/趋势」两页，并缓存所有可变节点引用
  private fullRender(now: Date, todayKey: string, monthKey: string) {
    const el = this.root;
    this.renderTodayKey = todayKey;
    this.renderMonthKey = monthKey;
    el.empty();
    el.toggleClass("typelog-compact", false);
    // 标签栏（精简模式不渲染，见 render() compact 分支）
    this.buildTabBar(el);
    // 两页容器：非激活页保留在 DOM（隐藏而非销毁），切换页时重建目标页结构
    this.todayPage = el.createDiv({ cls: "typelog-tab-page typelog-tab-page-today" });
    this.trendPage = el.createDiv({ cls: "typelog-tab-page typelog-tab-page-trend" });
    this.buildOverviewSection(this.todayPage);
    this.buildPomodoroSection(this.todayPage);
    this.buildFileSection(this.todayPage);
    this.buildTrendSection(this.trendPage);
    this.buildHeatmapSection(this.trendPage);
    this.applyTabVisibility();
    this.structureBuilt = true;
    // 全量构建已写入初始值，此处同步引用缓存并兜底刷新（幂等）
    this.updateValues(now, todayKey);
  }

  // 标签栏：两个标签按钮，切换仅 addClass/removeClass（非激活页隐藏而非销毁）
  private buildTabBar(parent: HTMLElement) {
    this.tabBar = parent.createDiv({ cls: "typelog-dashboard-tabs" });
    const mkTab = (cls: string, label: string) => {
      const btn = this.tabBar.createEl("button", { cls: `typelog-dashboard-tab ${cls}` });
      btn.setText(label);
      return btn;
    };
    this.tabTodayBtn = mkTab("typelog-tab-today", t("dash.tabToday"));
    this.tabTrendBtn = mkTab("typelog-tab-trend", t("dash.tabTrend"));
    this.tabTodayBtn.addEventListener("click", () => this.switchTab("today"));
    this.tabTrendBtn.addEventListener("click", () => this.switchTab("trend"));
  }

  // 切换标签页：更新激活态与页面显隐；切到趋势页时重建趋势区块（数据可能已变化）
  private switchTab(tab: "today" | "trend") {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.applyTabVisibility();
    if (tab === "trend") {
      this.rebuildTrend();
    } else if (this.structureBuilt) {
      this.updateValues(new Date(), this.renderTodayKey);
    }
  }

  // 依据当前激活页应用标签激活态与页面显隐
  private applyTabVisibility() {
    this.tabTodayBtn?.toggleClass("is-active", this.activeTab === "today");
    this.tabTrendBtn?.toggleClass("is-active", this.activeTab === "trend");
    this.todayPage?.toggleClass("is-hidden", this.activeTab !== "today");
    this.trendPage?.toggleClass("is-hidden", this.activeTab !== "trend");
  }

  // 增量更新：对比引用节点直接 setText / 更新 SVG 属性，零节点重建
  private updateValues(now: Date, todayKey: string) {
    const globalStats = this.plugin.store.getGlobalStats();
    const settings = this.plugin.settings;
    const todayActive = globalStats.dailyActiveByDate[todayKey] ?? 0;
    const todayGross = globalStats.dailyGrossByDate[todayKey] ?? 0;
    const todayPeak = globalStats.dailyPeakByDate[todayKey] ?? 0;

    // 今日总览三指标 + 目标进度环
    this.setText(this.ovActiveEl, formatDuration(todayActive));
    this.setText(this.ovGrossEl, formatNumber(todayGross));
    this.setText(this.ovPeakEl, `${formatNumber(todayPeak)} ${t("sb.speedUnit")}`);
    const wordRatio = settings.dailyWordGoal > 0 ? todayGross / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayActive / (settings.dailyTimeGoalMin * 60_000) : 0;
    this.wordRing?.setProgress(wordRatio);
    this.setText(this.wordLabelEl, `${formatNumber(todayGross)} / ${formatNumber(settings.dailyWordGoal)}`);
    this.timeRing?.setProgress(timeRatio);
    this.setText(this.timeLabelEl, `${formatDuration(todayActive)} / ${t("modal.minutesUnit", { n: settings.dailyTimeGoalMin })}`);
    // 周目标环增量更新（周内累计随每日数据增长）
    if (settings.weeklyWordGoal > 0 && this.weekWordRing) {
      const weekWords = weekSum(globalStats.dailyGrossByDate);
      this.weekWordRing.setProgress(weekWords / settings.weeklyWordGoal);
      this.setText(this.weekWordLabelEl, `${formatNumber(weekWords)} / ${formatNumber(settings.weeklyWordGoal)}`);
    }
    if (settings.weeklyTimeGoalMin > 0 && this.weekTimeRing) {
      const weekMs = weekSum(globalStats.dailyActiveByDate);
      this.weekTimeRing.setProgress(weekMs / (settings.weeklyTimeGoalMin * 60_000));
      this.setText(this.weekTimeLabelEl, `${formatDuration(weekMs)} / ${t("modal.minutesUnit", { n: settings.weeklyTimeGoalMin })}`);
    }

    // 当前文件：会话状态变化（无↔有）或曲线采样长度变化时重建该区块，否则仅更新数值
    const session = this.plugin.session.get();
    const engine = this.plugin.engine;
    if (session && engine) {
      if (this.chartLen === -1) {
        this.replaceSection(this.root, "typelog-section-file", (p) => this.buildFileSection(p));
        return;
      }
      this.setText(this.fileNetEl, formatNumber(session.netStartWords + session.deltaWords));
      this.setText(this.fileGrossEl, formatNumber(session.grossTyped));
      this.setText(this.fileDeletedEl, formatNumber(session.deletedChars));
      this.setText(this.fileActiveEl, formatDuration(session.activeTimeMs));
      this.setText(this.fileCpmEl, `${formatNumber(engine.getCpm())} ${t("sb.speedUnit")}`);
      // 跨分钟新增采样点：长度变化即重绘当前文件区块（频率 1 次/分钟，可接受）
      const seriesLen = Math.min(session.minuteSeries.length, 120);
      if (seriesLen !== this.chartLen) {
        this.replaceSection(this.root, "typelog-section-file", (p) => this.buildFileSection(p));
        return;
      }
    } else if (this.chartLen !== -1) {
      // 会话结束（切走文件）：重建为提示态
      this.replaceSection(this.root, "typelog-section-file", (p) => this.buildFileSection(p));
      return;
    }

    // 热力图：同月内仅更新今日格 fill
    this.updateHeatmapToday(globalStats);

    // 番茄钟：状态切换时重建，运行中仅更新倒计时与进度条
    this.updatePomodoro();
  }

  // 热力图今日格增量更新（仅改该格 fill，不重建 SVG）
  private updateHeatmapToday(globalStats: ReturnType<TypeLogPlugin["store"]["getGlobalStats"]>) {
    if (!this.heatTodayRect) return;
    const key = dateKey(new Date());
    const day = globalStats.heatmap[key];
    const level = heatLevel(this.heatDayValue(day), this.heatMode);
    this.heatTodayRect.setAttribute("fill", HEAT_COLORS[level]);
  }

  // 热力图某日某维度的日总值（活跃毫秒或累计输入）
  private heatDayValue(day: { activeMs: number[]; grossByHour: number[] } | undefined): number {
    if (!day) return 0;
    const arr = this.heatMode === "active" ? day.activeMs : day.grossByHour;
    return (arr || []).reduce((a, b) => a + (b || 0), 0);
  }

  // 番茄钟增量更新：状态切换重建区块；running 态更新倒计时文本与进度条
  private updatePomodoro() {
    const engine = this.plugin.engine;
    const settings = this.plugin.settings;
    if (!settings.pomodoroEnabled) return;
    const state = engine.isPomodoroPaused() ? "paused" : engine.isPomodoroRunning() ? "running" : "idle";
    if (state !== this.pomoStateCached) {
      this.replaceSection(this.root, "typelog-section-pomo", (p) => this.buildPomodoroSection(p));
      return;
    }
    if (state === "running" && this.pomoTimeEl) {
      const remain = engine.getPomodoroRemainingMs();
      const totalSec = Math.max(0, Math.ceil(remain / 1000));
      this.pomoTimeEl.setText(`${Math.floor(totalSec / 60)}:${pad2(totalSec % 60)}`);
      const total = settings.pomodoroMinutes * 60_000;
      const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - remain / total)) : 0;
      this.pomoBarFillEl?.setCssProps({ width: `${(ratio * 100).toFixed(1)}%` });
    }
  }

  // 引用节点安全 setText（避免对可能未构建的节点调用）
  private setText(el: HTMLElement | null | undefined, text: string) {
    if (el) el.setText(text);
  }

  // 原地替换某个统计区块：新节点先追加到末尾，再移动到旧节点位置，保持区块顺序。
  // 今日页区块统一在 todayPage 内查找与插入（标签页结构下 root 含标签栏与两页容器）
  private replaceSection(el: HTMLElement, cls: string, build: (parent: HTMLElement) => HTMLElement) {
    const scope = this.todayPage ?? el;
    const old = scope.querySelector<HTMLElement>(`.${cls}`);
    const fresh = build(scope);
    if (old) {
      scope.insertBefore(fresh, old);
      old.remove();
    }
  }

  // 创建指标项并返回数值节点（供增量更新 setText）
  private statItem(row: HTMLElement, label: string, value: string): HTMLElement {
    const d = row.createDiv({ cls: "typelog-overview-item" });
    const v = d.createDiv({ cls: "typelog-overview-value" });
    v.setText(value);
    d.createDiv({ cls: "typelog-overview-label" }).setText(label);
    return v;
  }

  // ---- 今日总览 ----
  private buildOverviewSection(parent: HTMLElement): HTMLElement {
    const globalStats = this.plugin.store.getGlobalStats();
    const settings = this.plugin.settings;
    const todayKey = this.renderTodayKey || dateKey(new Date());
    const section = parent.createDiv({ cls: "typelog-section typelog-section-ov" });
    section.createEl("h3", { text: t("dash.todayOverview"), cls: "typelog-section-title" });

    const statsRow = section.createDiv({ cls: "typelog-overview-row" });
    this.ovActiveEl = this.statItem(statsRow, t("dash.todayActive"), formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));
    this.ovGrossEl = this.statItem(statsRow, t("dash.todayGross"), formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));
    this.ovPeakEl = this.statItem(statsRow, t("dash.todayPeak"), `${formatNumber(globalStats.dailyPeakByDate[todayKey] ?? 0)} ${t("sb.speedUnit")}`);

    // 每日目标进度环（句柄缓存供增量更新环比例）
    const goals = section.createDiv({ cls: "typelog-goals" });
    const todayWords = globalStats.dailyGrossByDate[todayKey] ?? 0;
    const todayMs = globalStats.dailyActiveByDate[todayKey] ?? 0;
    const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
    const goalItem = (ratio: number, ringLabel: string, text: string) => {
      const g = goals.createDiv({ cls: "typelog-goal-item" });
      const handle = renderRingProgress(g.createDiv({ cls: "typelog-goal-ring" }), ratio, ringLabel);
      const label = g.createDiv({ cls: "typelog-goal-label" });
      label.setText(text);
      return { handle, label };
    };
    const word = goalItem(wordRatio, t("dash.wordGoal"), `${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
    this.wordRing = word.handle;
    this.wordLabelEl = word.label;
    const time = goalItem(timeRatio, t("dash.timeGoal"), `${formatDuration(todayMs)} / ${t("modal.minutesUnit", { n: settings.dailyTimeGoalMin })}`);
    this.timeRing = time.handle;
    this.timeLabelEl = time.label;

    // 周目标环（仅启用时构建；默认 0 不显示，避免 "0 / 0"）
    if (settings.weeklyWordGoal > 0) {
      const weekWords = weekSum(globalStats.dailyGrossByDate);
      const weekWord = goalItem(weekWords / settings.weeklyWordGoal, t("dash.weekWordGoal"), `${formatNumber(weekWords)} / ${formatNumber(settings.weeklyWordGoal)}`);
      this.weekWordRing = weekWord.handle;
      this.weekWordLabelEl = weekWord.label;
    }
    if (settings.weeklyTimeGoalMin > 0) {
      const weekMs = weekSum(globalStats.dailyActiveByDate);
      const weekTime = goalItem(
        weekMs / (settings.weeklyTimeGoalMin * 60_000),
        t("dash.weekTimeGoal"),
        `${formatDuration(weekMs)} / ${t("modal.minutesUnit", { n: settings.weeklyTimeGoalMin })}`,
      );
      this.weekTimeRing = weekTime.handle;
      this.weekTimeLabelEl = weekTime.label;
    }
    return section;
  }

  // ---- 当前文件 ----
  private buildFileSection(parent: HTMLElement): HTMLElement {
    const session = this.plugin.session.get();
    const engine = this.plugin.engine;
    const section = parent.createDiv({ cls: "typelog-section typelog-section-file" });
    section.createEl("h3", { text: t("dash.currentFile"), cls: "typelog-section-title" });
    if (session && engine) {
      const frow = section.createDiv({ cls: "typelog-overview-row" });
      const fitem = (label: string, value: string) => {
        const d = frow.createDiv({ cls: "typelog-overview-item" });
        const v = d.createDiv({ cls: "typelog-overview-value" });
        v.setText(value);
        d.createDiv({ cls: "typelog-overview-label" }).setText(label);
        return v;
      };
      this.fileNetEl = fitem(t("dash.netWords"), formatNumber(session.netStartWords + session.deltaWords));
      this.fileGrossEl = fitem(t("dash.grossTyped"), formatNumber(session.grossTyped));
      this.fileDeletedEl = fitem(t("dash.deleted"), formatNumber(session.deletedChars));
      this.fileActiveEl = fitem(t("dash.activeTime"), formatDuration(session.activeTimeMs));
      this.fileCpmEl = fitem(t("dash.currentSpeed"), `${formatNumber(engine.getCpm())} ${t("sb.speedUnit")}`);

      // 分钟级增长曲线（宽度自适应容器）；超长会话仅渲染最近 120 个采样点，避免 DOM 节点膨胀
      const series = session.minuteSeries.slice(-120);
      this.chartLen = series.length;
      if (series.length >= 1) {
        const chartBox = section.createDiv({ cls: "typelog-chart" });
        chartBox.createDiv({ cls: "typelog-chart-label" }).setText(t("dash.chartLabel"));
        const points = series.map((s, i) => ({ x: i, y: s.delta }));
        const chartWidth = Math.max(240, (this.root.clientWidth || 320) - 20);
        renderLineChart(chartBox.createDiv({ cls: "typelog-chart-svg" }), points, { width: chartWidth, height: 110 });
      } else {
        section.createDiv({ cls: "typelog-empty" }).setText(t("dash.chartEmpty"));
      }
    } else {
      this.chartLen = -1;
      section.createDiv({ cls: "typelog-empty" }).setText(t("dash.fileEmpty"));
    }
    return section;
  }

  // ---- 打字热力图（GitHub 贡献图风格，当月每天；活跃时长/字数双维度可切换） ----
  private buildHeatmapSection(parent: HTMLElement): HTMLElement {
    const globalStats = this.plugin.store.getGlobalStats();
    const section = parent.createDiv({ cls: "typelog-section typelog-section-heat" });
    section.createEl("h3", { text: t("dash.heatmap"), cls: "typelog-section-title" });

    // 维度切换（活跃时长 / 字数）
    const controls = section.createDiv({ cls: "typelog-trend-controls" });
    const heatGroup = controls.createDiv({ cls: "typelog-trend-control-group" });
    this.segBtn(heatGroup, this.heatMode === "active", () => {
      this.heatMode = "active";
      this.rebuildHeatmap();
    }).setText(t("dash.heatActive"));
    this.segBtn(heatGroup, this.heatMode === "gross", () => {
      this.heatMode = "gross";
      this.rebuildHeatmap();
    }).setText(t("dash.heatGross"));

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // 当月第一天是周几（周一=0），用于网格定位
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const numCols = Math.ceil((offset + daysInMonth) / 7);
    const cols = [] as { minutes: number; isCurrent: boolean }[][];
    // 今日格在网格中的位置（列=周索引，行=星期索引），供增量更新今日格 fill
    let todayRow = 0;
    let todayCol = 0;
    for (let c = 0; c < numCols; c++) {
      const col: { minutes: number; isCurrent: boolean }[] = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(year, month, 1 + (c * 7 + r) - offset);
        const isCurrent = d.getMonth() === month;
        if (isCurrent && d.getDate() === now.getDate()) {
          todayRow = r;
          todayCol = c;
        }
        let minutes = 0;
        if (isCurrent) {
          // 按当前维度取日总值（活跃毫秒 / 累计输入），active 模式换算为分钟供色阶使用
          const day = globalStats.heatmap[dateKey(d)];
          const value = this.heatDayValue(day);
          minutes = this.heatMode === "active" ? Math.round(value / 60_000) : value;
        }
        col.push({ minutes, isCurrent });
      }
      cols.push(col);
    }
    const heatmapContainer = section.createDiv({ cls: "typelog-heatmap" });
    renderHeatmap(heatmapContainer, {
      cols,
      cellSize: 20,
    });
    // rect 按「行(星期) 外循环 × 列(周) 内循环」顺序创建，索引 = r*7+c
    this.heatTodayRect = heatmapContainer.querySelectorAll<SVGRectElement>("rect")[todayRow * 7 + todayCol] ?? null;

    const legend = section.createDiv({ cls: "typelog-legend" });
    legend.createSpan().setText(t("dash.legendLess"));
    HEAT_COLORS.forEach((c) => {
      legend.createSpan({ cls: "typelog-legend-cell" }).setCssProps({ background: c });
    });
    legend.createSpan().setText(t("dash.legendMore"));
    return section;
  }

  // 重建热力图区块（维度切换时调用；热力图位于趋势页）
  private rebuildHeatmap() {
    if (!this.trendPage) return;
    const old = this.trendPage.querySelector<HTMLElement>(".typelog-section-heat");
    const fresh = this.buildHeatmapSection(this.trendPage);
    if (old) {
      this.trendPage.insertBefore(fresh, old);
      old.remove();
    }
  }

  // ---- 趋势页：每日柱状图（范围/指标切换） ----
  private buildTrendSection(parent: HTMLElement): HTMLElement {
    const section = parent.createDiv({ cls: "typelog-section typelog-section-trend" });
    section.createEl("h3", { text: t("dash.trendTitle"), cls: "typelog-section-title" });

    // 控件行：范围（7/30 天）+ 指标（字数/时长/速度）
    const controls = section.createDiv({ cls: "typelog-trend-controls" });
    const rangeGroup = controls.createDiv({ cls: "typelog-trend-control-group" });
    rangeGroup.createDiv({ cls: "typelog-trend-group-label" }).setText(t("dash.trendRange"));
    this.segBtn(rangeGroup, this.trendRange === 7, () => {
      this.trendRange = 7;
      this.rebuildTrend();
    }).setText(t("dash.trendRange7"));
    this.segBtn(rangeGroup, this.trendRange === 30, () => {
      this.trendRange = 30;
      this.rebuildTrend();
    }).setText(t("dash.trendRange30"));
    const metricGroup = controls.createDiv({ cls: "typelog-trend-control-group" });
    metricGroup.createDiv({ cls: "typelog-trend-group-label" }).setText(t("dash.trendMetric"));
    this.segBtn(metricGroup, this.trendMetric === "gross", () => {
      this.trendMetric = "gross";
      this.rebuildTrend();
    }).setText(t("dash.trendGross"));
    this.segBtn(metricGroup, this.trendMetric === "active", () => {
      this.trendMetric = "active";
      this.rebuildTrend();
    }).setText(t("dash.trendActive"));
    this.segBtn(metricGroup, this.trendMetric === "peak", () => {
      this.trendMetric = "peak";
      this.rebuildTrend();
    }).setText(t("dash.trendPeak"));

    // 柱状图（宽度自适应容器）
    const chartBox = section.createDiv({ cls: "typelog-chart" });
    const points = this.buildTrendSeries(this.trendRange, this.trendMetric);
    if (points.length === 0) {
      chartBox.createDiv({ cls: "typelog-empty" }).setText(t("svg.noData"));
    } else {
      const chartWidth = Math.max(240, (this.root.clientWidth || 320) - 20);
      renderBarChart(chartBox.createDiv({ cls: "typelog-chart-svg" }), points, { width: chartWidth, height: 140 });
    }
    return section;
  }

  // 分段按钮：active 时加激活类；点击回调由调用方传入（通常重建趋势区块）
  private segBtn(group: HTMLElement, active: boolean, onClick: () => void): HTMLElement {
    const btn = group.createEl("button", { cls: `typelog-trend-btn${active ? " is-active" : ""}` });
    btn.addEventListener("click", onClick);
    return btn;
  }

  // 重建趋势区块（范围/指标切换或切回趋势页时调用；非趋势页不操作）
  private rebuildTrend() {
    if (!this.trendPage || this.activeTab !== "trend") return;
    const old = this.trendPage.querySelector<HTMLElement>(".typelog-section-trend");
    const fresh = this.buildTrendSection(this.trendPage);
    if (old) {
      this.trendPage.insertBefore(fresh, old);
      old.remove();
    }
  }

  // 构建趋势序列：近 N 天（含今天），按指标取 daily*ByDate；缺失的天补 0
  private buildTrendSeries(days: number, metric: "gross" | "active" | "peak"): BarPoint[] {
    const globalStats = this.plugin.store.getGlobalStats();
    const map =
      metric === "gross"
        ? globalStats.dailyGrossByDate
        : metric === "active"
          ? globalStats.dailyActiveByDate
          : globalStats.dailyPeakByDate;
    const out: BarPoint[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dateKey(d);
      out.push({ label: key.slice(5), value: map[key] ?? 0 });
    }
    return out;
  }

  // ---- 番茄钟控制：开始/暂停/继续/停止（停止需二次确认） ----
  private buildPomodoroSection(parent: HTMLElement): HTMLElement {
    const engine = this.plugin.engine;
    const settings = this.plugin.settings;

    const section = parent.createDiv({ cls: "typelog-section typelog-section-pomo" });
    section.createEl("h3", { text: t("dash.pomodoro"), cls: "typelog-section-title" });

    if (!settings.pomodoroEnabled) {
      const disabled = section.createDiv({ cls: "typelog-pomodoro-disabled" });
      disabled.createDiv({ cls: "typelog-pomodoro-disabled-title", text: t("dash.pomoDisabled") });
      disabled.createDiv({ cls: "typelog-pomodoro-disabled-hint", text: t("dash.pomoDisabledHint") });
      return section;
    }

    const card = section.createDiv({ cls: "typelog-pomodoro-card" });

    // 状态 + 模式
    const state = engine.isPomodoroPaused() ? "paused" : engine.isPomodoroRunning() ? "running" : "idle";
    this.pomoStateCached = state;
    const stateText = state === "paused" ? t("dash.pomoStatePaused") : state === "running" ? t("dash.pomoStateRunning") : t("dash.pomoStateIdle");
    card.createDiv({ cls: `typelog-pomodoro-state ${state}` }).setText(stateText);
    const modeText = settings.pomodoroMode === "real" ? t("dash.pomoModeReal") : t("dash.pomoModeActive");
    card.createDiv({ cls: "typelog-pomodoro-mode" }).setText(`${modeText}`);

    // 剩余时间：运行中为倒计时；未开始时显示目标时长（可编辑）
    const remain = engine.isPomodoroRunning() ? engine.getPomodoroRemainingMs() : settings.pomodoroMinutes * 60_000;
    const totalSec = Math.max(0, Math.ceil(remain / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    this.pomoTimeEl = null;
    if (!engine.isPomodoroRunning()) {
      const editRow = card.createDiv({ cls: "typelog-pomodoro-time-edit" });
      const mmInput = editRow.createEl("input", { cls: "typelog-pomodoro-time-input typelog-pomodoro-time-mm" });
      mmInput.inputMode = "numeric";
      mmInput.value = String(m);
      editRow.createSpan({ cls: "typelog-pomodoro-time-sep", text: ":" });
      const ssInput = editRow.createEl("input", { cls: "typelog-pomodoro-time-input typelog-pomodoro-time-ss" });
      ssInput.inputMode = "numeric";
      ssInput.value = String(s).padStart(2, "0");
      const commit = () => {
        const mm = parseInt(mmInput.value, 10);
        const ss = parseInt(ssInput.value, 10);
        // 逻辑判断：分/秒均为非负整数、秒不超过 59、总时长大于 0，否则恢复原值
        this.timeEditing = false;
        if (isNaN(mm) || isNaN(ss) || mm < 0 || ss < 0 || ss > 59) {
          this.render();
          return;
        }
        const total = mm * 60 + ss;
        // 总时长需大于 0 且不超过 7 天（秒），否则恢复原值（上限与 parseMinutesSeconds 一致）
        if (total <= 0 || total > 7 * 24 * 60 * 60) {
          this.render();
          return;
        }
        this.plugin.settings.pomodoroMinutes = total / 60;
        void this.plugin.saveSettings();
        this.render();
      };
      const startEditing = () => {
        this.timeEditing = true;
      };
      const maybeEndEditing = () => {
        // 失焦但焦点转移到另一个输入框时继续编辑
        window.setTimeout(() => {
          if (document.activeElement !== mmInput && document.activeElement !== ssInput) {
            this.timeEditing = false;
            this.render();
          }
        }, 0);
      };
      mmInput.addEventListener("focus", startEditing);
      ssInput.addEventListener("focus", startEditing);
      mmInput.addEventListener("change", commit);
      ssInput.addEventListener("change", commit);
      mmInput.addEventListener("blur", maybeEndEditing);
      ssInput.addEventListener("blur", maybeEndEditing);
      mmInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
      ssInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
    } else {
      const timeEl = card.createDiv({ cls: "typelog-pomodoro-time" });
      timeEl.setText(`${m}:${pad2(s)}`);
      timeEl.title = t("dash.pomoTimeTitle");
      this.pomoTimeEl = timeEl;
    }

    // 进度条
    const total = settings.pomodoroMinutes * 60_000;
    const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - remain / total)) : 0;
    const bar = card.createDiv({ cls: "typelog-pomodoro-bar" });
    const barFill = bar.createDiv({ cls: "typelog-pomodoro-bar-fill" });
    barFill.setCssProps({ width: `${(ratio * 100).toFixed(1)}%` });
    this.pomoBarFillEl = barFill;

    // 操作按钮
    const row = card.createDiv({ cls: "typelog-pomodoro-actions" });
    if (!engine.isPomodoroRunning()) {
      const start = row.createEl("button", { text: t("dash.pomoStart"), cls: "mod-cta" });
      start.addEventListener("click", () => this.plugin.startPomodoro());
      const stop = row.createEl("button", { text: t("dash.pomoStop"), cls: "mod-warning" });
      stop.disabled = true;
      stop.title = t("dash.pomoStopDisabledTitle");
    } else if (engine.isPomodoroPaused()) {
      const resume = row.createEl("button", { text: t("dash.pomoResume"), cls: "mod-cta" });
      resume.addEventListener("click", () => this.plugin.resumePomodoro());
      const stop = row.createEl("button", { text: t("dash.pomoStop"), cls: "mod-warning" });
      stop.addEventListener("click", () => this.plugin.confirmStopPomodoro());
    } else {
      const pause = row.createEl("button", { text: t("dash.pomoPause") });
      pause.addEventListener("click", () => this.plugin.pausePomodoro());
      const stop = row.createEl("button", { text: t("dash.pomoStop"), cls: "mod-warning" });
      stop.addEventListener("click", () => this.plugin.confirmStopPomodoro());
    }
    return section;
  }
}
