// 状态栏控件 + 点击弹出的详情卡片
// 状态栏显示：当前速度 | 净字数 | 今日总输入量
import { Modal, setIcon } from "obsidian";
import type TypeLogPlugin from "../main";
import { dateKey, formatDuration, formatNumber } from "../core/format";
import { renderRingProgress } from "./svg";

export class StatusBarController {
  private el!: HTMLElement;
  private speedEl!: HTMLElement;
  private netEl!: HTMLElement;
  private todayEl!: HTMLElement;
  private lastRender = 0;
  private built = false;

  constructor(private plugin: TypeLogPlugin) {}

  get isBuilt(): boolean {
    return this.built;
  }

  build() {
    if (this.built) return;
    this.built = true;
    this.el = this.plugin.addStatusBarItem();
    this.el.addClass("typelog-statusbar");
    this.el.style.cursor = "pointer";
    this.el.title = "TypeLog 字迹（点击查看详情）";

    this.speedEl = this.el.createSpan({ cls: "typelog-sb-speed" });
    this.netEl = this.el.createSpan({ cls: "typelog-sb-net" });
    this.todayEl = this.el.createSpan({ cls: "typelog-sb-today" });

    this.el.addEventListener("click", (evt) => {
      evt.stopPropagation();
      new StatusBarDetailModal(this.plugin).open();
    });

    this.refresh(true);
  }

  // 500ms 节流刷新
  refresh(force = false) {
    if (!this.built) return;
    const now = Date.now();
    if (!force && now - this.lastRender < 500) return;
    this.lastRender = now;

    const engine = this.plugin.engine;
    const session = this.plugin.session.get();
    const cpm = engine?.getCpm() ?? 0;
    this.speedEl.setText(`${formatNumber(cpm)}字/分`);

    const netWords = session ? session.netStartWords + session.deltaWords : 0;
    this.netEl.setText(`${formatNumber(netWords)}字`);

    const todayKey = dateKey(new Date());
    const todayGross = this.plugin.store?.getGlobalStats().dailyGrossByDate[todayKey] ?? 0;
    this.todayEl.setText(`今日${formatNumber(todayGross)}`);
  }

  destroy() {
    if (!this.built) return;
    this.built = false;
    this.el?.remove();
  }
}

// ==================== 详情卡片 ====================

export class StatusBarDetailModal extends Modal {
  private timer: number | null = null;

  constructor(private plugin: TypeLogPlugin) {
    super(plugin.app);
    this.titleEl.setText("TypeLog 字迹 · 统计详情");
  }

  onOpen() {
    this.render();
    // 每秒刷新保持最新
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("typelog-modal");

    const engine = this.plugin.engine;
    const session = this.plugin.session.get();
    const path = engine?.getCurrentPath() ?? null;
    const fileStats = path ? this.plugin.store?.getFileStats(path) : undefined;
    const global = this.plugin.store.getGlobalStats();
    const todayKey = dateKey(new Date());
    const settings = this.plugin.settings;

    // ---- 头部横幅 ----
    const header = contentEl.createDiv({ cls: "typelog-modal-header" });
    const logo = header.createDiv({ cls: "typelog-modal-logo" });
    setIcon(logo, "bar-chart-2");
    const titleBox = header.createDiv({ cls: "typelog-modal-titlebox" });
    titleBox.createDiv({ cls: "typelog-modal-title" }).setText("TypeLog 字迹");
    const fileRow = titleBox.createDiv({ cls: "typelog-modal-file" });
    setIcon(fileRow.createSpan(), "file-text");
    fileRow.createSpan().setText(path ? path.split("/").pop() ?? path : "未打开文件");

    // ---- 文字指标 ----
    const wordsGroup = this.group(contentEl, "文字指标", "type");
    this.metric(wordsGroup, "current-net", "当前净字数", session ? formatNumber(session.netStartWords + session.deltaWords) : "—",
      session ? `${session.deltaWords >= 0 ? "+" : ""}${formatNumber(session.deltaWords)} 本次会话` : "", "blue");
    this.metric(wordsGroup, "gross-typed", "文件累计字数", fileStats ? formatNumber(fileStats.grossTyped) : "—",
      "累计键入（含删除/替换，永不回退）", "purple");
    this.metric(wordsGroup, "deleted", "删除/废弃字符", fileStats ? formatNumber(fileStats.deletedChars) : "—",
      "思维反复参考指标", "red");

    // ---- 时间指标 ----
    const timeGroup = this.group(contentEl, "时间指标", "clock");
    const spanMs = session ? Date.now() - session.openedAt : 0;
    this.metric(timeGroup, "session-active", "会话活跃时长", session ? formatDuration(session.activeTimeMs) : "—",
      session ? `闲置 ${formatDuration(Math.max(0, spanMs - session.activeTimeMs))}` : "", "green");
    this.metric(timeGroup, "file-active", "文件累计活跃", fileStats ? formatDuration(fileStats.activeTimeMs) : "—",
      "历史累计编辑时长", "blue");
    this.metric(timeGroup, "today-active", "今日编辑时长", formatDuration(global.dailyActiveByDate[todayKey] ?? 0), "全天活跃累计", "orange");

    // ---- 速度指标 ----
    const speedGroup = this.group(contentEl, "速度指标", "zap");
    this.metric(speedGroup, "cpm", "当前打字速度", session ? `${formatNumber(engine?.getCpm() ?? 0)} 字/分` : "—",
      session ? `WPM ${Math.round(engine?.getWpm() ?? 0)}（60秒滑动窗口）` : "", "blue");
    this.metric(speedGroup, "peak", "会话峰值速度", session ? `${formatNumber(session.peakSpeed)} 字/分` : "—",
      "10 秒窗口最高瞬时速度", "orange");
    this.metric(speedGroup, "today-gross", "今日总输入", formatNumber(global.dailyGrossByDate[todayKey] ?? 0),
      `终身累计 ${formatNumber(global.grossTypedTotal)}`, "purple");

    // ---- 今日目标进度 ----
    const todayWords = global.dailyGrossByDate[todayKey] ?? 0;
    const todayMs = global.dailyActiveByDate[todayKey] ?? 0;
    const goals = contentEl.createDiv({ cls: "typelog-modal-goals" });
    const goalItem = (svg: string, label: string, sub: string) => {
      const g = goals.createDiv({ cls: "typelog-modal-goal" });
      g.createDiv({ cls: "typelog-modal-goal-ring" }).innerHTML = svg;
      const t = g.createDiv({ cls: "typelog-modal-goal-text" });
      t.createDiv({ cls: "typelog-modal-goal-label" }).setText(label);
      t.createDiv({ cls: "typelog-modal-goal-sub" }).setText(sub);
    };
    const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
    goalItem(renderRingProgress(wordRatio, "字数", 64), "今日字数目标", `${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
    goalItem(renderRingProgress(timeRatio, "时长", 64), "今日时长目标", `${formatDuration(todayMs)} / ${settings.dailyTimeGoalMin}分钟`);
  }

  private group(container: HTMLElement, title: string, icon: string) {
    const g = container.createDiv({ cls: "typelog-modal-group" });
    const head = g.createDiv({ cls: "typelog-modal-group-head" });
    setIcon(head.createSpan(), icon);
    head.createSpan({ cls: "typelog-modal-group-title" }).setText(title);
    return g.createDiv({ cls: "typelog-modal-group-grid" });
  }

  private metric(parent: HTMLElement, icon: string, label: string, value: string, sub?: string, accent?: string) {
    const card = parent.createDiv({ cls: `typelog-modal-metric accent-${accent ?? "blue"}` });
    const iconWrap = card.createDiv({ cls: "typelog-modal-metric-icon" });
    setIcon(iconWrap, icon);
    const body = card.createDiv({ cls: "typelog-modal-metric-body" });
    body.createDiv({ cls: "typelog-modal-metric-label" }).setText(label);
    body.createDiv({ cls: "typelog-modal-metric-value" }).setText(value);
    if (sub) body.createDiv({ cls: "typelog-modal-metric-sub" }).setText(sub);
  }

  onClose() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.contentEl.empty();
  }
}
