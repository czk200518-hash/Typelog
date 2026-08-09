// 状态栏控件 + 点击弹出的详情卡片
// 状态栏显示项由设置驱动（功能 8）：顺序 = 设置数组顺序，仅渲染已启用项；
// 「goal」项（优化 4）：迷你进度条 + 百分比数字，仅字数目标，目标为 0 时隐藏
import { Modal, setIcon } from "obsidian";
import type TypeLogPlugin from "../main";
import type { StatusBarItemId } from "../core/settings";
import { dateKey, formatDuration, formatNumber, pad2, weekSum } from "../core/format";
import { renderRingProgress, type RingProgressHandle } from "./svg";
import { t } from "../core/i18n";

export class StatusBarController {
  private el!: HTMLElement;
  // 各显示项的外层节点（构建时按设置顺序创建，刷新时仅 setText/属性）
  private itemEls: Partial<Record<StatusBarItemId, HTMLElement>> = {};
  // goal 项内部节点（进度条填充 + 百分比文本）
  private goalFillEl: HTMLElement | null = null;
  private goalTextEl: HTMLElement | null = null;
  private lastRender = 0;
  private built = false;

  constructor(private plugin: TypeLogPlugin) {}

  get isBuilt(): boolean {
    return this.built;
  }

  build() {
    if (this.built) return;
    this.built = true;
    this.itemEls = {};
    this.goalFillEl = null;
    this.goalTextEl = null;
    this.el = this.plugin.addStatusBarItem();
    this.el.addClass("typelog-statusbar");
    this.el.title = t("brand.statusbarTitle");

    // 按设置顺序循环创建启用的显示项（goal 项内部含进度条结构）
    for (const item of this.plugin.settings.statusBarItems) {
      if (!item.enabled) continue;
      const id = item.id;
      const el = this.el.createSpan({ cls: `typelog-sb-${id}` });
      if (id === "goal") {
        const bar = el.createDiv({ cls: "typelog-sb-goal-bar" });
        this.goalFillEl = bar.createDiv({ cls: "typelog-sb-goal-fill" });
        this.goalTextEl = el.createDiv({ cls: "typelog-sb-goal-text" });
      }
      if (id === "pomodoro") {
        // 番茄钟入口：点击开始/停止（独立于详情弹窗；保留既有交互）
        el.title = t("sb.pomo.clickTitle");
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          this.plugin.togglePomodoro();
        });
      }
      this.itemEls[id] = el;
    }

    this.el.addEventListener("click", (evt) => {
      evt.stopPropagation();
      new StatusBarDetailModal(this.plugin).open();
    });

    this.refresh(true);
  }

  // 500ms 节流刷新：仅更新已启用的显示项
  refresh(force = false) {
    if (!this.built) return;
    const now = Date.now();
    if (!force && now - this.lastRender < 500) return;
    this.lastRender = now;

    const engine = this.plugin.engine;
    const session = this.plugin.session.get();
    const globalStats = this.plugin.store.getGlobalStats();
    const todayKey = dateKey(new Date());
    const set = (id: StatusBarItemId, text: string) => {
      const el = this.itemEls[id];
      if (el) el.setText(text);
    };

    set("speed", t("sb.speed", { n: formatNumber(engine?.getCpm() ?? 0) }));
    set("wpm", `WPM ${Math.round(engine?.getWpm() ?? 0)}`);

    const netWords = session ? session.netStartWords + session.deltaWords : 0;
    set("net", t("sb.net", { n: formatNumber(netWords) }));

    set("todayGross", t("sb.today", { n: formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0) }));
    set("todayActive", formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));

    // 目标进度（优化 4）：进度条 + 百分比；目标为 0 时隐藏
    const cur = engine?.getCurrentPath() ?? null;
    set("fileGross", cur ? formatNumber(this.plugin.store.getFileStats(cur)?.grossTyped ?? 0) : "");

    const goal = this.plugin.settings.dailyWordGoal;
    if (goal > 0) {
      const todayGross = globalStats.dailyGrossByDate[todayKey] ?? 0;
      const ratio = todayGross / goal;
      const pct = Math.round(ratio * 100);
      this.goalFillEl?.setCssProps({ width: `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%` });
      this.goalTextEl?.setText(pct > 100 ? `${pct}%+` : `${pct}%`);
      const goalEl = this.itemEls.goal;
      goalEl?.removeClass("typelog-sb-goal-hidden");
      if (goalEl) {
        goalEl.title = t("sb.goalTitle", {
          words: formatNumber(todayGross),
          goal: formatNumber(goal),
          active: formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0),
          timeGoal: this.plugin.settings.dailyTimeGoalMin,
        });
      }
    } else if (this.itemEls.goal) {
      this.itemEls.goal.addClass("typelog-sb-goal-hidden");
    }

    this.renderPomodoro();
  }

  // 番茄钟显示：未开始 → “🍅 开始”；运行中 → “🍅 mm:ss”倒计时
  private renderPomodoro() {
    const engine = this.plugin.engine;
    const el = this.itemEls.pomodoro;
    if (!engine || !el) return;
    if (!this.plugin.settings.pomodoroEnabled) {
      el.setText("");
      el.removeClass("typelog-sb-pomodoro-running");
      el.removeClass("typelog-sb-pomodoro-idle");
      el.removeClass("typelog-sb-pomodoro-paused");
      el.title = t("sb.pomo.disabledTitle");
      return;
    }
    if (engine.isPomodoroRunning()) {
      const remain = engine.getPomodoroRemainingMs();
      const totalSec = Math.max(0, Math.ceil(remain / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      if (engine.isPomodoroPaused()) {
        el.setText(`🍅 ⏸ ${m}:${pad2(s)}`);
        el.addClass("typelog-sb-pomodoro-paused");
        el.removeClass("typelog-sb-pomodoro-running");
        el.removeClass("typelog-sb-pomodoro-idle");
        el.title = t("sb.pomo.pausedTitle", { t: `${m}:${pad2(s)}` });
      } else {
        el.setText(`🍅 ${m}:${pad2(s)}`);
        el.addClass("typelog-sb-pomodoro-running");
        el.removeClass("typelog-sb-pomodoro-paused");
        el.removeClass("typelog-sb-pomodoro-idle");
        el.title = t("sb.pomo.runningTitle", { t: `${m}:${pad2(s)}` });
      }
    } else {
      el.setText(t("sb.pomo.start"));
      el.addClass("typelog-sb-pomodoro-idle");
      el.removeClass("typelog-sb-pomodoro-running");
      el.removeClass("typelog-sb-pomodoro-paused");
      el.title = t("sb.pomo.idleTitle");
    }
  }

  destroy() {
    if (!this.built) return;
    this.built = false;
    this.el?.remove();
    this.itemEls = {};
  }
}

// ==================== 详情卡片 ====================

// 详情弹窗：打开时构建一次结构并缓存可变节点引用，每秒仅增量更新数值（零节点重建）
export class StatusBarDetailModal extends Modal {
  private timer: number | null = null;
  // 可变节点引用（构建时收集，刷新时仅 setText/更新属性）
  private fileEl!: HTMLElement;
  private netWordsEl!: HTMLElement;
  private grossEl!: HTMLElement;
  private deletedEl!: HTMLElement;
  private sessionActiveEl!: HTMLElement;
  private fileActiveEl!: HTMLElement;
  private todayActiveEl!: HTMLElement;
  private cpmEl!: HTMLElement;
  private peakEl!: HTMLElement;
  private todayGrossEl!: HTMLElement;
  private wordRing!: RingProgressHandle;
  private wordRingSubEl!: HTMLElement;
  private timeRing!: RingProgressHandle;
  private timeRingSubEl!: HTMLElement;
  // 周目标环（功能 7；对应目标为 0 时不构建）
  private weekWordRing: RingProgressHandle | null = null;
  private weekWordRingSubEl: HTMLElement | null = null;
  private weekTimeRing: RingProgressHandle | null = null;
  private weekTimeRingSubEl: HTMLElement | null = null;

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
    const fileRow = titleBox.createDiv({ cls: "typelog-modal-file" });
    setIcon(fileRow.createSpan(), "file-text");
    this.fileEl = fileRow.createSpan();

    // ---- 文字指标 ----
    const wordsGroup = this.group(contentEl, t("modal.wordsGroup"), "type");
    const net = this.metric(wordsGroup, t("modal.netWords"), "", "blue");
    this.netWordsEl = net.valueEl;
    const gross = this.metric(wordsGroup, t("modal.grossTyped"), "", "purple");
    this.grossEl = gross.valueEl;
    const deleted = this.metric(wordsGroup, t("modal.deleted"), "", "red");
    this.deletedEl = deleted.valueEl;

    // ---- 时间指标 ----
    const timeGroup = this.group(contentEl, t("modal.timeGroup"), "clock");
    const sessionActive = this.metric(timeGroup, t("modal.sessionActive"), "", "green");
    this.sessionActiveEl = sessionActive.valueEl;
    const fileActive = this.metric(timeGroup, t("modal.fileActive"), "", "blue");
    this.fileActiveEl = fileActive.valueEl;
    const todayActive = this.metric(timeGroup, t("modal.todayActive"), "", "orange");
    this.todayActiveEl = todayActive.valueEl;

    // ---- 速度指标 ----
    const speedGroup = this.group(contentEl, t("modal.speedGroup"), "zap");
    const cpm = this.metric(speedGroup, t("modal.cpm"), "", "blue");
    this.cpmEl = cpm.valueEl;
    const peak = this.metric(speedGroup, t("modal.peak"), "", "orange");
    this.peakEl = peak.valueEl;
    const todayGross = this.metric(speedGroup, t("modal.todayGross"), "", "purple");
    this.todayGrossEl = todayGross.valueEl;

    // ---- 今日目标进度 ----
    const goals = contentEl.createDiv({ cls: "typelog-modal-goals" });
    const wordGoal = this.goalItem(goals, 0, t("modal.wordGoalRing"), t("modal.wordGoalLabel"), "");
    this.wordRing = wordGoal.ring;
    this.wordRingSubEl = wordGoal.subEl;
    const timeGoal = this.goalItem(goals, 0, t("modal.timeGoalRing"), t("modal.timeGoalLabel"), "");
    this.timeRing = timeGoal.ring;
    this.timeRingSubEl = timeGoal.subEl;

    // 周目标环（仅启用时构建）
    const settings = this.plugin.settings;
    if (settings.weeklyWordGoal > 0) {
      const weekWord = this.goalItem(goals, 0, t("modal.weekWordGoalRing"), t("modal.weekWordLabel"), "");
      this.weekWordRing = weekWord.ring;
      this.weekWordRingSubEl = weekWord.subEl;
    }
    if (settings.weeklyTimeGoalMin > 0) {
      const weekTime = this.goalItem(goals, 0, t("modal.weekTimeGoalRing"), t("modal.weekTimeLabel"), "");
      this.weekTimeRing = weekTime.ring;
      this.weekTimeRingSubEl = weekTime.subEl;
    }
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
    this.grossEl.setText(fileStats ? formatNumber(fileStats.grossTyped) : "—");
    this.deletedEl.setText(fileStats ? formatNumber(fileStats.deletedChars) : "—");

    this.sessionActiveEl.setText(session ? formatDuration(session.activeTimeMs) : "—");
    this.fileActiveEl.setText(fileStats ? formatDuration(fileStats.activeTimeMs) : "—");
    this.todayActiveEl.setText(formatDuration(globalStats.dailyActiveByDate[todayKey] ?? 0));

    this.cpmEl.setText(session ? t("sb.speed", { n: formatNumber(engine?.getCpm() ?? 0) }) : "—");
    this.peakEl.setText(session ? t("sb.speed", { n: formatNumber(session.peakSpeed) }) : "—");
    this.todayGrossEl.setText(formatNumber(globalStats.dailyGrossByDate[todayKey] ?? 0));

    const todayWords = globalStats.dailyGrossByDate[todayKey] ?? 0;
    const todayMs = globalStats.dailyActiveByDate[todayKey] ?? 0;
    const wordRatio = settings.dailyWordGoal > 0 ? todayWords / settings.dailyWordGoal : 0;
    const timeRatio = settings.dailyTimeGoalMin > 0 ? todayMs / (settings.dailyTimeGoalMin * 60_000) : 0;
    this.wordRing.setProgress(wordRatio);
    this.wordRingSubEl.setText(`${formatNumber(todayWords)} / ${formatNumber(settings.dailyWordGoal)}`);
    this.timeRing.setProgress(timeRatio);
    this.timeRingSubEl.setText(`${formatDuration(todayMs)} / ${t("modal.minutesUnit", { n: settings.dailyTimeGoalMin })}`);

    // 周目标环增量更新
    if (this.weekWordRing && this.weekWordRingSubEl && settings.weeklyWordGoal > 0) {
      const weekWords = weekSum(globalStats.dailyGrossByDate);
      this.weekWordRing.setProgress(weekWords / settings.weeklyWordGoal);
      this.weekWordRingSubEl.setText(`${formatNumber(weekWords)} / ${formatNumber(settings.weeklyWordGoal)}`);
    }
    if (this.weekTimeRing && this.weekTimeRingSubEl && settings.weeklyTimeGoalMin > 0) {
      const weekMs = weekSum(globalStats.dailyActiveByDate);
      this.weekTimeRing.setProgress(weekMs / (settings.weeklyTimeGoalMin * 60_000));
      this.weekTimeRingSubEl.setText(`${formatDuration(weekMs)} / ${t("modal.minutesUnit", { n: settings.weeklyTimeGoalMin })}`);
    }
  }

  private group(container: HTMLElement, title: string, icon: string) {
    const g = container.createDiv({ cls: "typelog-modal-group" });
    const head = g.createDiv({ cls: "typelog-modal-group-head" });
    setIcon(head.createSpan(), icon);
    head.createSpan({ cls: "typelog-modal-group-title" }).setText(title);
    return g.createDiv({ cls: "typelog-modal-group-grid" });
  }

  private metric(parent: HTMLElement, label: string, value: string, accent?: string): { valueEl: HTMLElement } {
    const card = parent.createDiv({ cls: `typelog-modal-metric accent-${accent ?? "blue"}` });
    const body = card.createDiv({ cls: "typelog-modal-metric-body" });
    body.createDiv({ cls: "typelog-modal-metric-label" }).setText(label);
    const valueEl = body.createDiv({ cls: "typelog-modal-metric-value" });
    valueEl.setText(value);
    return { valueEl };
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
