import { ItemView, WorkspaceLeaf } from "obsidian";
import type TypeLogPlugin from "../main";
import { dateKey, formatDuration, formatNumber } from "../core/format";
import { renderLineChart, renderHeatmap, renderRingProgress } from "./svg";

export const VIEW_TYPE_TYPELOG = "typelog-dashboard";

export class DashboardView extends ItemView {
  private root!: HTMLElement;
  private lastRender = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  // 精简模式（悬浮窗）：只显示核心指标，不显示曲线图/热力图/目标环
  private isCompact = false;
  // 是否悬浮窗（popout）：启用置顶拉回
  private isPopout = false;

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
      clearTimeout(this.resizeTimer);
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
      setTimeout(() => {
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

  // 1s 节流刷新
  refresh() {
    const now = Date.now();
    if (now - this.lastRender < 1000) return;
    this.lastRender = now;
    if (this.root) this.render();
  }

  // 兼容 easy-keep-view 等插件对视图统一调用
  refreshContent() {
    this.refresh();
  }

  private render() {
    const el = this.root;
    el.empty();
    el.toggleClass("typelog-compact", this.isCompact);

    const global = this.plugin.store.getGlobalStats();
    const session = this.plugin.session.get();
    const engine = this.plugin.engine;
    const todayKey = dateKey(new Date());
    const settings = this.plugin.settings;

    const statItem = (row: HTMLElement, label: string, value: string) => {
      const d = row.createDiv({ cls: "typelog-overview-item" });
      d.createDiv({ cls: "typelog-overview-value" }).setText(value);
      d.createDiv({ cls: "typelog-overview-label" }).setText(label);
    };

    // ---- 悬浮窗精简模式：仅今日三数据 ----
    if (this.isCompact) {
      const compactRow = el.createDiv({ cls: "typelog-overview-row typelog-compact-row" });
      statItem(compactRow, "今日编辑时长", formatDuration(global.dailyActiveByDate[todayKey] ?? 0));
      statItem(compactRow, "今日累计输入", formatNumber(global.dailyGrossByDate[todayKey] ?? 0));
      statItem(compactRow, "今日峰值", `${formatNumber(global.dailyPeakByDate[todayKey] ?? 0)} 字/分`);
      return;
    }

    // ---- 今日总览 ----
    const overview = el.createDiv({ cls: "typelog-section" });
    overview.createEl("h3", { text: "今日总览", cls: "typelog-section-title" });

    const statsRow = overview.createDiv({ cls: "typelog-overview-row" });
    statItem(statsRow, "今日编辑时长", formatDuration(global.dailyActiveByDate[todayKey] ?? 0));
    statItem(statsRow, "今日累计输入", formatNumber(global.dailyGrossByDate[todayKey] ?? 0));
    statItem(statsRow, "今日峰值", `${formatNumber(global.dailyPeakByDate[todayKey] ?? 0)} 字/分`);

    // 每日目标进度环（精简模式隐藏）
    if (!this.isCompact) {
      const goals = overview.createDiv({ cls: "typelog-goals" });
      const todayWords = global.dailyGrossByDate[todayKey] ?? 0;
      const todayMs = global.dailyActiveByDate[todayKey] ?? 0;
      const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
      const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
      const goalItem = (svg: string, label: string) => {
        const g = goals.createDiv({ cls: "typelog-goal-item" });
        g.createDiv({ cls: "typelog-goal-ring" }).innerHTML = svg;
        g.createDiv({ cls: "typelog-goal-label" }).setText(label);
      };
      goalItem(renderRingProgress(wordRatio, "字数目标"), `${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
      goalItem(renderRingProgress(timeRatio, "时长目标"), `${formatDuration(todayMs)} / ${settings.dailyTimeGoalMin}分钟`);
    }

    // ---- 当前文件 ----
    const fileSection = el.createDiv({ cls: "typelog-section" });
    fileSection.createEl("h3", { text: "当前文件", cls: "typelog-section-title" });
    if (session && engine) {
      const frow = fileSection.createDiv({ cls: "typelog-overview-row" });
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

      // 分钟级增长曲线（精简模式隐藏；宽度自适应容器）
      if (!this.isCompact) {
        if (session.minuteSeries.length >= 2) {
          const chartBox = fileSection.createDiv({ cls: "typelog-chart" });
          chartBox.createDiv({ cls: "typelog-chart-label" }).setText("字数增长");
          const points = session.minuteSeries.map((s, i) => ({ x: i, y: s.delta }));
          const chartWidth = Math.max(240, (this.root.clientWidth || 320) - 20);
          chartBox.createDiv({ cls: "typelog-chart-svg" }).innerHTML = renderLineChart(points, { width: chartWidth, height: 110 });
        } else {
          fileSection.createDiv({ cls: "typelog-empty" }).setText("编辑超过1分钟生成曲线");
        }
      }
    } else {
      fileSection.createDiv({ cls: "typelog-empty" }).setText("打开并编辑一个 Markdown 文件开始统计");
    }

    // ---- 打字热力图（GitHub 贡献图风格，当月每天） ----
    if (!this.isCompact) {
      const heatSection = el.createDiv({ cls: "typelog-section" });
      heatSection.createEl("h3", { text: "打字热力图", cls: "typelog-section-title" });

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
            const hours = global.heatmap[dateKey(d)];
            if (hours) minutes = Math.round(hours.reduce((a, b) => a + (b || 0), 0) / 60_000);
          }
          col.push({ minutes, isCurrent });
        }
        cols.push(col);
      }
      heatSection.createDiv({ cls: "typelog-heatmap" }).innerHTML = renderHeatmap({
        cols,
        monthLabel: `${year}年${month + 1}月`,
        cellSize: 20,
      });

      const legend = heatSection.createDiv({ cls: "typelog-legend" });
      legend.createSpan().setText("少");
      ["var(--background-modifier-border)", "#d7f0e0", "#a6e2ba", "#5cc786", "#2ea85f", "#1d8a49"].forEach((c) => {
        legend.createSpan({ cls: "typelog-legend-cell" }).setCssProps({ background: c });
      });
      legend.createSpan().setText("多");
    }
  }
}
