import { ItemView, WorkspaceLeaf } from "obsidian";
import type TypeLogPlugin from "../main";
import { dateKey, formatDuration, formatNumber, pad2 } from "../core/format";
import { renderLineChart, renderHeatmap, renderRingProgress } from "./svg";

export const VIEW_TYPE_TYPELOG = "typelog-dashboard";

// 时长显示（整分钟不带小数，非整分钟保留 1 位小数）
function formatMinutes(minutes: number): string {
  return minutes % 1 === 0 ? String(minutes) : minutes.toFixed(1);
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

  constructor(leaf: WorkspaceLeaf, private plugin: TypeLogPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TYPELOG;
  }

  getDisplayText(): string {
    return "TypeLog 字迹";
  }

  getIcon(): string {
    return "bar-chart-2";
  }

  setCompact(v: boolean) {
    this.isCompact = v;
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
        if (this.root) this.render();
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

  private render() {
    const el = this.root;
    const compact = this.isCompact;

    // 编辑番茄钟时间时：只原位重建统计区块，番茄钟区块节点完全不触碰（避免移除聚焦元素导致失焦）
    if (this.timeEditing && !compact) {
      this.replaceSection(el, "typelog-section-ov", (p) => this.buildOverviewSection(p));
      this.replaceSection(el, "typelog-section-file", (p) => this.buildFileSection(p));
      this.replaceSection(el, "typelog-section-heat", (p) => this.buildHeatmapSection(p));
      return;
    }

    el.empty();
    el.toggleClass("typelog-compact", compact);

    const globalStats = this.plugin.store.getGlobalStats();
    const session = this.plugin.session.get();
    const engine = this.plugin.engine;
    const todayKey = dateKey(new Date());
    const settings = this.plugin.settings;

    // ---- 悬浮窗精简模式：仅今日三数据 ----
    if (compact) {
      const compactRow = el.createDiv({ cls: "typelog-overview-row typelog-compact-row" });
      this.statItem(compactRow, "今日编辑时长", formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));
      this.statItem(compactRow, "今日累计输入", formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));
      this.statItem(compactRow, "今日峰值", `${formatNumber(globalStats.dailyPeakByDate[todayKey] ?? 0)} 字/分`);
      return;
    }

    this.buildOverviewSection(el);
    this.buildPomodoroSection(el);
    this.buildFileSection(el);
    this.buildHeatmapSection(el);
  }

  // 原地替换某个统计区块：新节点先追加到末尾，再移动到旧节点位置，保持“今日总览→番茄钟→当前文件→热力图”顺序
  private replaceSection(el: HTMLElement, cls: string, build: (parent: HTMLElement) => HTMLElement) {
    const old = el.querySelector<HTMLElement>(`.${cls}`);
    const fresh = build(el);
    if (old) {
      el.insertBefore(fresh, old);
      old.remove();
    }
  }

  private statItem(row: HTMLElement, label: string, value: string) {
    const d = row.createDiv({ cls: "typelog-overview-item" });
    d.createDiv({ cls: "typelog-overview-value" }).setText(value);
    d.createDiv({ cls: "typelog-overview-label" }).setText(label);
  }

  // ---- 今日总览 ----
  private buildOverviewSection(parent: HTMLElement): HTMLElement {
    const globalStats = this.plugin.store.getGlobalStats();
    const settings = this.plugin.settings;
    const todayKey = dateKey(new Date());
    const section = parent.createDiv({ cls: "typelog-section typelog-section-ov" });
    section.createEl("h3", { text: "今日总览", cls: "typelog-section-title" });

    const statsRow = section.createDiv({ cls: "typelog-overview-row" });
    this.statItem(statsRow, "今日编辑时长", formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));
    this.statItem(statsRow, "今日累计输入", formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));
    this.statItem(statsRow, "今日峰值", `${formatNumber(globalStats.dailyPeakByDate[todayKey] ?? 0)} 字/分`);

    // 每日目标进度环
    const goals = section.createDiv({ cls: "typelog-goals" });
    const todayWords = globalStats.dailyGrossByDate[todayKey] ?? 0;
    const todayMs = globalStats.dailyActiveByDate[todayKey] ?? 0;
    const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
    const goalItem = (ratio: number, ringLabel: string, text: string) => {
      const g = goals.createDiv({ cls: "typelog-goal-item" });
      renderRingProgress(g.createDiv({ cls: "typelog-goal-ring" }), ratio, ringLabel);
      g.createDiv({ cls: "typelog-goal-label" }).setText(text);
    };
    goalItem(wordRatio, "字数目标", `${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
    goalItem(timeRatio, "时长目标", `${formatDuration(todayMs)} / ${settings.dailyTimeGoalMin}分钟`);
    return section;
  }

  // ---- 当前文件 ----
  private buildFileSection(parent: HTMLElement): HTMLElement {
    const session = this.plugin.session.get();
    const engine = this.plugin.engine;
    const section = parent.createDiv({ cls: "typelog-section typelog-section-file" });
    section.createEl("h3", { text: "当前文件", cls: "typelog-section-title" });
    if (session && engine) {
      const frow = section.createDiv({ cls: "typelog-overview-row" });
      const fitem = (label: string, value: string) => {
        const d = frow.createDiv({ cls: "typelog-overview-item" });
        d.createDiv({ cls: "typelog-overview-value" }).setText(value);
        d.createDiv({ cls: "typelog-overview-label" }).setText(label);
      };
      fitem("净字数", formatNumber(session.netStartWords + session.deltaWords));
      fitem("累计输入", formatNumber(session.grossTyped));
      fitem("删改", formatNumber(session.deletedChars));
      fitem("活跃时长", formatDuration(session.activeTimeMs));
      fitem("当前速度", `${formatNumber(engine.getCpm())} 字/分`);

      // 分钟级增长曲线（宽度自适应容器）
      if (session.minuteSeries.length >= 1) {
        const chartBox = section.createDiv({ cls: "typelog-chart" });
        chartBox.createDiv({ cls: "typelog-chart-label" }).setText("字数增长");
        const points = session.minuteSeries.map((s, i) => ({ x: i, y: s.delta }));
        const chartWidth = Math.max(240, (this.root.clientWidth || 320) - 20);
        renderLineChart(chartBox.createDiv({ cls: "typelog-chart-svg" }), points, { width: chartWidth, height: 110 });
      } else {
        section.createDiv({ cls: "typelog-empty" }).setText("编辑超过1分钟生成曲线");
      }
    } else {
      section.createDiv({ cls: "typelog-empty" }).setText("打开并编辑一个 Markdown 文件开始统计");
    }
    return section;
  }

  // ---- 打字热力图（GitHub 贡献图风格，当月每天） ----
  private buildHeatmapSection(parent: HTMLElement): HTMLElement {
    const globalStats = this.plugin.store.getGlobalStats();
    const section = parent.createDiv({ cls: "typelog-section typelog-section-heat" });
    section.createEl("h3", { text: "打字热力图", cls: "typelog-section-title" });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // 当月第一天是周几（周一=0），用于网格定位
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const numCols = Math.ceil((offset + daysInMonth) / 7);
    const cols = [] as { minutes: number; isCurrent: boolean }[][];
    for (let c = 0; c < numCols; c++) {
      const col: { minutes: number; isCurrent: boolean }[] = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(year, month, 1 + (c * 7 + r) - offset);
        const isCurrent = d.getMonth() === month;
        let minutes = 0;
        if (isCurrent) {
          const hours = globalStats.heatmap[dateKey(d)];
          if (hours) minutes = Math.round(hours.reduce((a, b) => a + (b || 0), 0) / 60_000);
        }
        col.push({ minutes, isCurrent });
      }
      cols.push(col);
    }
    renderHeatmap(section.createDiv({ cls: "typelog-heatmap" }), {
      cols,
      cellSize: 20,
    });

    const legend = section.createDiv({ cls: "typelog-legend" });
    legend.createSpan().setText("少");
    ["var(--background-modifier-border)", "#d7f0e0", "#a6e2ba", "#5cc786", "#2ea85f", "#1d8a49"].forEach((c) => {
      legend.createSpan({ cls: "typelog-legend-cell" }).setCssProps({ background: c });
    });
    legend.createSpan().setText("多");
    return section;
  }

  // ---- 番茄钟控制：开始/暂停/继续/停止（停止需二次确认） ----
  private buildPomodoroSection(parent: HTMLElement): HTMLElement {
    const engine = this.plugin.engine;
    const settings = this.plugin.settings;

    const section = parent.createDiv({ cls: "typelog-section typelog-section-pomo" });
    section.createEl("h3", { text: "番茄钟", cls: "typelog-section-title" });

    if (!settings.pomodoroEnabled) {
      const disabled = section.createDiv({ cls: "typelog-pomodoro-disabled" });
      disabled.createDiv({ cls: "typelog-pomodoro-disabled-title", text: "🍅 番茄钟未开启" });
      disabled.createDiv({ cls: "typelog-pomodoro-disabled-hint", text: "请在「设置 → 番茄钟提醒」中开启后使用" });
      return section;
    }

    const card = section.createDiv({ cls: "typelog-pomodoro-card" });

    // 状态 + 模式
    const state = engine.isPomodoroPaused() ? "paused" : engine.isPomodoroRunning() ? "running" : "idle";
    const stateText = state === "paused" ? "已暂停" : state === "running" ? "进行中" : "未开始";
    card.createDiv({ cls: `typelog-pomodoro-state ${state}` }).setText(stateText);
    const modeText = settings.pomodoroMode === "real" ? "纯计时" : "活跃计时";
    card.createDiv({ cls: "typelog-pomodoro-mode" }).setText(`${modeText}`);

    // 剩余时间：运行中为倒计时；未开始时显示目标时长（可编辑）
    const remain = engine.isPomodoroRunning() ? engine.getPomodoroRemainingMs() : settings.pomodoroMinutes * 60_000;
    const totalSec = Math.max(0, Math.ceil(remain / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
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
        if (total <= 0) {
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
      timeEl.title = "番茄钟进行中，时长不可修改";
    }

    // 进度条
    const total = settings.pomodoroMinutes * 60_000;
    const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - remain / total)) : 0;
    const bar = card.createDiv({ cls: "typelog-pomodoro-bar" });
    bar.createDiv({ cls: "typelog-pomodoro-bar-fill" }).setCssProps({ width: `${(ratio * 100).toFixed(1)}%` });

    // 操作按钮
    const row = card.createDiv({ cls: "typelog-pomodoro-actions" });
    if (!engine.isPomodoroRunning()) {
      const start = row.createEl("button", { text: "开始番茄钟", cls: "mod-cta" });
      start.addEventListener("click", () => this.plugin.startPomodoro());
      const stop = row.createEl("button", { text: "停止", cls: "mod-warning" });
      stop.disabled = true;
      stop.title = "番茄钟未开始";
    } else if (engine.isPomodoroPaused()) {
      const resume = row.createEl("button", { text: "继续", cls: "mod-cta" });
      resume.addEventListener("click", () => this.plugin.resumePomodoro());
      const stop = row.createEl("button", { text: "停止", cls: "mod-warning" });
      stop.addEventListener("click", () => this.plugin.confirmStopPomodoro());
    } else {
      const pause = row.createEl("button", { text: "暂停" });
      pause.addEventListener("click", () => this.plugin.pausePomodoro());
      const stop = row.createEl("button", { text: "停止", cls: "mod-warning" });
      stop.addEventListener("click", () => this.plugin.confirmStopPomodoro());
    }
    return section;
  }
}
