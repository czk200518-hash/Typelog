// 状态栏控件 + 点击弹出的详情卡片
// 状态栏显示：当前速度 | 净字数 | 今日总输入量
import { Modal, setIcon } from "obsidian";
import type TypeLogPlugin from "../main";
import { dateKey, formatDuration, formatNumber, pad2 } from "../core/format";
import { renderRingProgress, type RingProgressHandle } from "./svg";
import { t } from "../core/i18n";

export class StatusBarController {
  private el!: HTMLElement;
  private speedEl!: HTMLElement;
  private netEl!: HTMLElement;
  private todayEl!: HTMLElement;
  private pomodoroEl!: HTMLElement;
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
    this.el.title = t("brand.statusbarTitle");

    this.speedEl = this.el.createSpan({ cls: "typelog-sb-speed" });
    this.netEl = this.el.createSpan({ cls: "typelog-sb-net" });
    this.todayEl = this.el.createSpan({ cls: "typelog-sb-today" });

    // 番茄钟入口：点击开始/停止（独立于详情弹窗）
    this.pomodoroEl = this.el.createSpan({ cls: "typelog-sb-pomodoro" });
    this.pomodoroEl.title = t("sb.pomo.clickTitle");
    this.pomodoroEl.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.plugin.togglePomodoro();
    });

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
    this.speedEl.setText(t("sb.speed", { n: formatNumber(cpm) }));

    const netWords = session ? session.netStartWords + session.deltaWords : 0;
    this.netEl.setText(t("sb.net", { n: formatNumber(netWords) }));

    const todayKey = dateKey(new Date());
    const todayGross = this.plugin.store?.getGlobalStats().dailyGrossByDate[todayKey] ?? 0;
    this.todayEl.setText(t("sb.today", { n: formatNumber(todayGross) }));

    this.renderPomodoro();
  }

  // 番茄钟显示：未开始 → “🍅 开始”；运行中 → “🍅 mm:ss”倒计时
  private renderPomodoro() {
    const engine = this.plugin.engine;
    if (!engine) return;
    if (!this.plugin.settings.pomodoroEnabled) {
      this.pomodoroEl.setText("");
      this.pomodoroEl.removeClass("typelog-sb-pomodoro-running");
      this.pomodoroEl.removeClass("typelog-sb-pomodoro-idle");
      this.pomodoroEl.removeClass("typelog-sb-pomodoro-paused");
      this.pomodoroEl.title = t("sb.pomo.disabledTitle");
      return;
    }
    if (engine.isPomodoroRunning()) {
      const remain = engine.getPomodoroRemainingMs();
      const totalSec = Math.max(0, Math.ceil(remain / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      if (engine.isPomodoroPaused()) {
        this.pomodoroEl.setText(`🍅 ⏸ ${m}:${pad2(s)}`);
        this.pomodoroEl.addClass("typelog-sb-pomodoro-paused");
        this.pomodoroEl.removeClass("typelog-sb-pomodoro-running");
        this.pomodoroEl.removeClass("typelog-sb-pomodoro-idle");
        this.pomodoroEl.title = t("sb.pomo.pausedTitle", { t: `${m}:${pad2(s)}` });
      } else {
        this.pomodoroEl.setText(`🍅 ${m}:${pad2(s)}`);
        this.pomodoroEl.addClass("typelog-sb-pomodoro-running");
        this.pomodoroEl.removeClass("typelog-sb-pomodoro-paused");
        this.pomodoroEl.removeClass("typelog-sb-pomodoro-idle");
        this.pomodoroEl.title = t("sb.pomo.runningTitle", { t: `${m}:${pad2(s)}` });
      }
    } else {
      this.pomodoroEl.setText(t("sb.pomo.start"));
      this.pomodoroEl.addClass("typelog-sb-pomodoro-idle");
      this.pomodoroEl.removeClass("typelog-sb-pomodoro-running");
      this.pomodoroEl.removeClass("typelog-sb-pomodoro-paused");
      this.pomodoroEl.title = t("sb.pomo.idleTitle");
    }
  }

  destroy() {
    if (!this.built) return;
    this.built = false;
    this.el?.remove();
  }
}

// ==================== 详情卡片 ====================

// 详情弹窗：打开时构建一次结构并缓存可变节点引用，每秒仅增量更新数值（零节点重建）
export class StatusBarDetailModal extends Modal {
  private timer: number | null = null;
  // 可变节点引用（构建时收集，刷新时仅 setText/更新属性）
  private fileEl!: HTMLElement;
  private netWordsEl!: HTMLElement;
  private deltaEl!: HTMLElement;
  private grossEl!: HTMLElement;
  private deletedEl!: HTMLElement;
  private sessionActiveEl!: HTMLElement;
  private idleEl!: HTMLElement;
  private fileActiveEl!: HTMLElement;
  private todayActiveEl!: HTMLElement;
  private cpmEl!: HTMLElement;
  private wpmEl!: HTMLElement;
  private peakEl!: HTMLElement;
  private todayGrossEl!: HTMLElement;
  private lifetimeEl!: HTMLElement;
  private wordRing!: RingProgressHandle;
  private wordRingSubEl!: HTMLElement;
  private timeRing!: RingProgressHandle;
  private timeRingSubEl!: HTMLElement;

  constructor(private plugin: TypeLogPlugin) {
    super(plugin.app);
    this.titleEl.setText(t("modal.title"));
  }

  onOpen() {
    this.buildStructure();
    this.updateValues();
    // 每秒只刷新数值，不重建 DOM
    this.timer = window.setInterval(() => this.updateValues(), 1000);
  }

  // 构建一次全部结构，缓存可变节点引用
  private buildStructure() {
    const { contentEl } = this;
    contentEl.addClass("typelog-modal");

    // ---- 头部横幅 ----
    const header = contentEl.createDiv({ cls: "typelog-modal-header" });
    const logo = header.createDiv({ cls: "typelog-modal-logo" });
    setIcon(logo, "bar-chart-2");
    const titleBox = header.createDiv({ cls: "typelog-modal-titlebox" });
    titleBox.createDiv({ cls: "typelog-modal-title" }).setText(t("brand.name"));
    const fileRow = titleBox.createDiv({ cls: "typelog-modal-file" });
    setIcon(fileRow.createSpan(), "file-text");
    this.fileEl = fileRow.createSpan();

    // ---- 文字指标 ----
    const wordsGroup = this.group(contentEl, t("modal.wordsGroup"), "type");
    const net = this.metric(wordsGroup, "current-net", t("modal.netWords"), "", "", "blue");
    this.netWordsEl = net.valueEl;
    this.deltaEl = net.subEl!;
    const gross = this.metric(wordsGroup, "gross-typed", t("modal.grossTyped"), "", t("modal.grossTypedSub"), "purple");
    this.grossEl = gross.valueEl;
    const deleted = this.metric(wordsGroup, "deleted", t("modal.deleted"), "", t("modal.deletedSub"), "red");
    this.deletedEl = deleted.valueEl;

    // ---- 时间指标 ----
    const timeGroup = this.group(contentEl, t("modal.timeGroup"), "clock");
    const sessionActive = this.metric(timeGroup, "session-active", t("modal.sessionActive"), "", "", "green");
    this.sessionActiveEl = sessionActive.valueEl;
    this.idleEl = sessionActive.subEl!;
    const fileActive = this.metric(timeGroup, "file-active", t("modal.fileActive"), "", t("modal.fileActiveSub"), "blue");
    this.fileActiveEl = fileActive.valueEl;
    const todayActive = this.metric(timeGroup, "today-active", t("modal.todayActive"), "", t("modal.todayActiveSub"), "orange");
    this.todayActiveEl = todayActive.valueEl;

    // ---- 速度指标 ----
    const speedGroup = this.group(contentEl, t("modal.speedGroup"), "zap");
    const cpm = this.metric(speedGroup, "cpm", t("modal.cpm"), "", "", "blue");
    this.cpmEl = cpm.valueEl;
    this.wpmEl = cpm.subEl!;
    const peak = this.metric(speedGroup, "peak", t("modal.peak"), "", t("modal.peakSub"), "orange");
    this.peakEl = peak.valueEl;
    const todayGross = this.metric(speedGroup, "today-gross", t("modal.todayGross"), "", "", "purple");
    this.todayGrossEl = todayGross.valueEl;
    this.lifetimeEl = todayGross.subEl!;

    // ---- 今日目标进度 ----
    const goals = contentEl.createDiv({ cls: "typelog-modal-goals" });
    const wordGoal = this.goalItem(goals, 0, t("modal.wordGoalRing"), t("modal.wordGoalLabel"), "");
    this.wordRing = wordGoal.ring;
    this.wordRingSubEl = wordGoal.subEl;
    const timeGoal = this.goalItem(goals, 0, t("modal.timeGoalRing"), t("modal.timeGoalLabel"), "");
    this.timeRing = timeGoal.ring;
    this.timeRingSubEl = timeGoal.subEl;
  }

  // 每秒增量更新：只 setText 数值节点 + 更新进度环属性
  private updateValues() {
    const engine = this.plugin.engine;
    const session = this.plugin.session.get();
    const path = engine?.getCurrentPath() ?? null;
    const fileStats = path ? this.plugin.store?.getFileStats(path) : undefined;
    const globalStats = this.plugin.store.getGlobalStats();
    const todayKey = dateKey(new Date());
    const settings = this.plugin.settings;

    this.fileEl.setText(path ? path.split("/").pop() ?? path : t("modal.noFile"));

    this.netWordsEl.setText(session ? formatNumber(session.netStartWords + session.deltaWords) : "—");
    this.deltaEl.setText(session ? t("modal.thisSession", { n: `${session.deltaWords >= 0 ? "+" : ""}${formatNumber(session.deltaWords)}` }) : "");
    this.grossEl.setText(fileStats ? formatNumber(fileStats.grossTyped) : "—");
    this.deletedEl.setText(fileStats ? formatNumber(fileStats.deletedChars) : "—");

    const spanMs = session ? Date.now() - session.openedAt : 0;
    this.sessionActiveEl.setText(session ? formatDuration(session.activeTimeMs) : "—");
    this.idleEl.setText(session ? t("modal.idle", { d: formatDuration(Math.max(0, spanMs - session.activeTimeMs)) }) : "");
    this.fileActiveEl.setText(fileStats ? formatDuration(fileStats.activeTimeMs) : "—");
    this.todayActiveEl.setText(formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));

    this.cpmEl.setText(session ? t("sb.speed", { n: formatNumber(engine?.getCpm() ?? 0) }) : "—");
    this.wpmEl.setText(session ? `WPM ${Math.round(engine?.getWpm() ?? 0)}${t("modal.wpmSub")}` : "");
    this.peakEl.setText(session ? t("sb.speed", { n: formatNumber(session.peakSpeed) }) : "—");
    this.todayGrossEl.setText(formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));
    this.lifetimeEl.setText(t("modal.lifetime", { n: formatNumber(globalStats.grossTypedTotal) }));

    const todayWords = globalStats.dailyGrossByDate[todayKey] ?? 0;
    const todayMs = globalStats.dailyActiveByDate[todayKey] ?? 0;
    const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
    this.wordRing.setProgress(wordRatio);
    this.wordRingSubEl.setText(`${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
    this.timeRing.setProgress(timeRatio);
    this.timeRingSubEl.setText(`${formatDuration(todayMs)} / ${t("modal.minutesUnit", { n: settings.dailyTimeGoalMin })}`);
  }

  private group(container: HTMLElement, title: string, icon: string) {
    const g = container.createDiv({ cls: "typelog-modal-group" });
    const head = g.createDiv({ cls: "typelog-modal-group-head" });
    setIcon(head.createSpan(), icon);
    head.createSpan({ cls: "typelog-modal-group-title" }).setText(title);
    return g.createDiv({ cls: "typelog-modal-group-grid" });
  }

  private metric(parent: HTMLElement, icon: string, label: string, value: string, sub?: string, accent?: string): { valueEl: HTMLElement; subEl?: HTMLElement } {
    const card = parent.createDiv({ cls: `typelog-modal-metric accent-${accent ?? "blue"}` });
    const iconWrap = card.createDiv({ cls: "typelog-modal-metric-icon" });
    setIcon(iconWrap, icon);
    const body = card.createDiv({ cls: "typelog-modal-metric-body" });
    body.createDiv({ cls: "typelog-modal-metric-label" }).setText(label);
    const valueEl = body.createDiv({ cls: "typelog-modal-metric-value" });
    valueEl.setText(value);
    let subEl: HTMLElement | undefined;
    if (sub !== undefined) {
      subEl = body.createDiv({ cls: "typelog-modal-metric-sub" });
      subEl.setText(sub);
    }
    return { valueEl, subEl };
  }

  private goalItem(goals: HTMLElement, ratio: number, ringLabel: string, label: string, sub: string): { ring: RingProgressHandle; subEl: HTMLElement } {
    const g = goals.createDiv({ cls: "typelog-modal-goal" });
    const ring = renderRingProgress(g.createDiv({ cls: "typelog-modal-goal-ring" }), ratio, ringLabel, 64);
    const t = g.createDiv({ cls: "typelog-modal-goal-text" });
    t.createDiv({ cls: "typelog-modal-goal-label" }).setText(label);
    const subEl = t.createDiv({ cls: "typelog-modal-goal-sub" });
    subEl.setText(sub);
    return { ring, subEl };
  }

  onClose() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.contentEl.empty();
  }
}
