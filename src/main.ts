import { MarkdownView, Notice, Plugin } from "obsidian";
import { TypeLogSettings, DEFAULT_SETTINGS, UiLang } from "./core/settings";
import { setLang, t } from "./core/i18n";
import { StatsStore } from "./core/statsStore";
import { SessionStatsStore } from "./core/sessionStore";
import { compileIgnorePatterns, IgnoreMatcher } from "./core/pathFilter";
import { defaultExportName, formatMinutesSeconds, safeFileName } from "./core/format";
import { StatsEngine, toAbsolutePath } from "./tracking/statsEngine";
import { AdaptiveStorageAdapter, getNodeRequire, isSystemPath } from "./tracking/storageAdapter";
import { UiController } from "./ui/uiController";
import { ConfirmModal, DoubleConfirmModal } from "./ui/doubleConfirmModal";
import { ExportStatsModal } from "./ui/exportModal";
import { TypeLogSettingTab } from "./ui/settingsTab";

// CSV 字段转义：含逗号/引号/换行时加引号包裹并双写内部引号；
// 以 = + - @ 开头时前置单引号，防止在 Excel 中被当作公式执行（CSV 注入防护）
function csvField(v: string | number): string {
  const s = String(v);
  const safe = /^[=+@-]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

// 设置加载消毒：仅采纳类型与取值范围合法的字段，避免旧版本/损坏数据覆盖默认值
function sanitizeSettings(data: Partial<TypeLogSettings> | null | undefined): Partial<TypeLogSettings> {
  const out: Partial<TypeLogSettings> = {};
  if (!data || typeof data !== "object") return out;
  if (data.language === "zh" || data.language === "en") out.language = data.language;
  if (data.countMode === "strict" || data.countMode === "loose") out.countMode = data.countMode;
  if (typeof data.includePasteInSpeed === "boolean") out.includePasteInSpeed = data.includePasteInSpeed;
  if (
    typeof data.idleThresholdSec === "number" &&
    Number.isFinite(data.idleThresholdSec) &&
    data.idleThresholdSec >= 1 &&
    data.idleThresholdSec <= 120
  )
    out.idleThresholdSec = data.idleThresholdSec;
  if (Array.isArray(data.excludePatterns) && data.excludePatterns.every((p) => typeof p === "string"))
    out.excludePatterns = [...data.excludePatterns];
  if (typeof data.dailyWordGoal === "number" && Number.isFinite(data.dailyWordGoal) && data.dailyWordGoal >= 0)
    out.dailyWordGoal = data.dailyWordGoal;
  if (typeof data.dailyTimeGoalMin === "number" && Number.isFinite(data.dailyTimeGoalMin) && data.dailyTimeGoalMin >= 0)
    out.dailyTimeGoalMin = data.dailyTimeGoalMin;
  if (typeof data.pomodoroEnabled === "boolean") out.pomodoroEnabled = data.pomodoroEnabled;
  if (typeof data.pomodoroMinutes === "number" && Number.isFinite(data.pomodoroMinutes) && data.pomodoroMinutes > 0)
    out.pomodoroMinutes = data.pomodoroMinutes;
  if (data.pomodoroMode === "real" || data.pomodoroMode === "active") out.pomodoroMode = data.pomodoroMode;
  if (typeof data.showStatusBar === "boolean") out.showStatusBar = data.showStatusBar;
  if (data.windowMode === "none" || data.windowMode === "sidebar" || data.windowMode === "floating")
    out.windowMode = data.windowMode;
  if (typeof data.popoutAlwaysOnTop === "boolean") out.popoutAlwaysOnTop = data.popoutAlwaysOnTop;
  if (
    typeof data.purgeInactiveDays === "number" &&
    Number.isFinite(data.purgeInactiveDays) &&
    data.purgeInactiveDays >= 0
  )
    out.purgeInactiveDays = data.purgeInactiveDays;
  if (
    typeof data.dailyRetentionDays === "number" &&
    Number.isFinite(data.dailyRetentionDays) &&
    data.dailyRetentionDays >= 0
  )
    out.dailyRetentionDays = data.dailyRetentionDays;
  return out;
}

// 插件入口：双轨统计（净产出 NetWords + 总劳动量 GrossTyped）
export default class TypeLogPlugin extends Plugin {
  settings: TypeLogSettings = DEFAULT_SETTINGS;
  store!: StatsStore;
  // 自适应存储（系统路径 / vault 路径），导出报表等复用其系统路径写入能力
  storage!: AdaptiveStorageAdapter;
  session = new SessionStatsStore();
  engine!: StatsEngine;
  ui!: UiController;
  // 设置页引用（语言切换时重渲染）
  settingTab!: TypeLogSettingTab;
  private ignoreMatcher: IgnoreMatcher = () => false;

  async onload() {
    await this.loadSettings();
    // 应用持久化的语言偏好（默认中文）
    setLang(this.settings.language);
    this.ignoreMatcher = compileIgnorePatterns(this.settings.excludePatterns);

    // 三层存储
    this.storage = new AdaptiveStorageAdapter(this.app.vault);
    const req = getNodeRequire();
    let globalPath = ".typelog/global.json";
    if (req) {
      const os = req("os");
      const path = req("path");
      globalPath = path.join(os.homedir(), ".typelog", "global.json");
    }
    this.store = new StatsStore(this.storage, {
      fileStats: ".typelog/file-stats.json",
      project: ".typelog/project.json",
      globalStats: globalPath,
    });
    await this.store.load();

    // 统计引擎
    this.engine = new StatsEngine({
      workspace: this.app.workspace,
      vault: this.app.vault,
      getSettings: () => this.settings,
      store: this.store,
      session: this.session,
      isExcluded: (p) => this.ignoreMatcher(p),
      onUiUpdate: () => this.onUiUpdate(),
      onPomodoroDue: () => this.onPomodoroDue(),
    });
    this.engine.start();

    // UI 与命令（视图注册在 UiController.init 中，勿重复注册）
    this.ui = new UiController(this);
    this.ui.init();
    this.registerCommands();
    this.registerRibbon();
  }

  // 切换界面语言：更新 i18n 当前语言 → 保存偏好 → 全量重渲染 UI（无需重启）
  async setLanguage(lang: UiLang) {
    if (this.settings.language === lang) return;
    this.settings.language = lang;
    setLang(lang);
    await this.saveSettings();
    this.applyLanguage();
  }

  // 语言切换后立即生效：重建状态栏/统计面板/设置页，并更新命令名称
  applyLanguage() {
    this.ui.applyLanguage();
    this.settingTab?.display();
    this.registerCommands();
  }

  onunload() {
    this.engine?.stop();
    this.ui?.destroy();
    void this.store?.flush();
  }

  private registerRibbon() {
    this.addRibbonIcon("bar-chart-2", t("brand.name"), () => {
      this.ui.openStatsWindow();
    });
  }

  private onUiUpdate() {
    this.ui?.refresh();
  }

  private onPomodoroDue() {
    const modeText = this.settings.pomodoroMode === "real" ? t("notice.modeTimer") : t("notice.modeActiveEdit");
    const notice = new Notice(t("notice.pomoDone", { mode: modeText, time: formatMinutesSeconds(this.settings.pomodoroMinutes) }), 6000);
    // 完成提醒改为屏幕中央弹窗
    notice.messageEl.addClass("typelog-notice-center");
    // 一轮结束自动复位，需手动开始下一轮
    this.engine.stopPomodoro();
  }

  // 切换番茄钟运行状态（状态栏/设置按钮/命令触发）
  // 运行中 → 停止（二次确认）；已暂停 → 继续；未开始 → 开始
  togglePomodoro() {
    const engine = this.engine;
    if (engine.isPomodoroPaused()) {
      this.resumePomodoro();
    } else if (engine.isPomodoroRunning()) {
      this.confirmStopPomodoro();
    } else {
      this.startPomodoro();
    }
  }

  // 显式开始（返回是否成功启动）
  startPomodoro(): boolean {
    if (this.engine.startPomodoro()) {
      const modeText = this.settings.pomodoroMode === "real" ? t("notice.modeTimer") : t("notice.modeActiveStart");
      new Notice(t("notice.pomoStarted", { mode: modeText, time: formatMinutesSeconds(this.settings.pomodoroMinutes) }));
      return true;
    }
    new Notice(t("notice.pomoNotEnabled"));
    return false;
  }

  // 暂停：冻结计时（已累计时长保留）
  pausePomodoro() {
    this.engine.pausePomodoro();
    new Notice(t("notice.pomoPaused"));
  }

  // 继续：恢复计时
  resumePomodoro() {
    this.engine.resumePomodoro();
    new Notice(t("notice.pomoResumed"));
  }

  // 停止：单次二次确认（说明操作与后果，直接确认/取消）
  confirmStopPomodoro() {
    if (!this.engine.isPomodoroRunning()) return;
    new ConfirmModal(this.app, {
      title: t("confirm.stopPomoTitle"),
      text: [t("confirm.stopPomoText1"), t("confirm.stopPomoText2")],
      confirmText: t("confirm.stopPomoConfirm"),
      onConfirm: () => {
        this.engine.stopPomodoro();
        new Notice(t("notice.pomoStopped"));
      },
    }).open();
  }

  // 命令注册：语言切换时重新调用以更新命令面板中的名称（同 id 覆盖）
  registerCommands() {
    this.addCommand({
      id: "toggle-pomodoro",
      name: t("cmd.pomodoro"),
      callback: () => this.togglePomodoro(),
    });
    this.addCommand({
      id: "open-dashboard",
      name: t("cmd.openDashboard"),
      callback: () => this.ui.openStatsWindow(),
    });
    this.addCommand({
      id: "reset-session",
      name: t("cmd.resetSession"),
      callback: () => this.confirmResetSession(),
    });
    this.addCommand({
      id: "export-stats",
      name: t("cmd.exportStats"),
      callback: () => new ExportStatsModal(this.app, this).open(),
    });
    this.addCommand({
      id: "hard-reset",
      name: t("cmd.hardReset"),
      callback: () => this.confirmHardReset(),
    });
    this.addCommand({
      id: "purge-stale-data",
      name: t("cmd.purgeStale"),
      callback: () => this.confirmPurgeData(),
    });
  }

  // 重置会话统计（仅会话级，不影响历史累计）
  resetSession() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice(t("notice.noMarkdown"));
      return;
    }
    const abs = toAbsolutePath(this.app.vault, view.file.path);
    this.session.begin(abs, view.editor.getValue(), this.settings.countMode, Date.now());
    new Notice(t("notice.sessionReset"));
  }

  // 重置会话：两阶段二次确认（第二步含 10s 倒计时）
  confirmResetSession() {
    new DoubleConfirmModal(this.app, {
      title: t("confirm.resetSessionTitle"),
      step1: [t("confirm.resetSessionStep1a"), t("confirm.resetSessionStep1b")],
      step2: [t("confirm.resetSessionStep2")],
      countdownSec: 10,
      confirmText: t("confirm.resetSessionConfirm"),
      onConfirm: () => this.resetSession(),
    }).open();
  }

  // 硬重置：两阶段二次确认（第二步含 10s 倒计时）
  confirmHardReset() {
    new DoubleConfirmModal(this.app, {
      title: t("confirm.hardResetTitle"),
      step1: [t("confirm.hardResetStep1a"), t("confirm.hardResetStep1b")],
      step2: [t("confirm.hardResetStep2")],
      countdownSec: 10,
      confirmText: t("confirm.hardResetConfirm"),
      onConfirm: () => {
        this.store.hardReset();
        void this.store.flush();
        new Notice(t("notice.hardResetDone"));
      },
    }).open();
  }

  // 清理过期数据：按设置的保留天数裁剪文件统计与每日统计（两步确认；终身累计不受影响）
  confirmPurgeData() {
    const { purgeInactiveDays, dailyRetentionDays } = this.settings;
    if (purgeInactiveDays <= 0 && dailyRetentionDays <= 0) {
      new Notice(t("notice.purgeDisabled"));
      return;
    }
    const parts: string[] = [];
    if (purgeInactiveDays > 0) parts.push(t("confirm.purgePartFile", { n: purgeInactiveDays }));
    if (dailyRetentionDays > 0) parts.push(t("confirm.purgePartDaily", { n: dailyRetentionDays }));
    new DoubleConfirmModal(this.app, {
      title: t("confirm.purgeTitle"),
      step1: [t("confirm.purgeStep1a", { desc: parts.join("；") }), t("confirm.purgeStep1b")],
      step2: [t("confirm.purgeStep2")],
      countdownSec: 10,
      confirmText: t("confirm.purgeConfirm"),
      onConfirm: () => {
        const dayMs = 86_400_000;
        let total = 0;
        if (purgeInactiveDays > 0) total += this.store.purgeInactiveFiles(Date.now() - purgeInactiveDays * dayMs);
        if (dailyRetentionDays > 0) total += this.store.pruneOldDailyKeys(dailyRetentionDays);
        void this.store.flush();
        new Notice(t("notice.purgeDone", { n: total }));
        this.ui.refresh();
      },
    }).open();
  }

  // 导出统计报表：目录可为 vault 内相对路径或系统绝对路径（含 Windows 资源管理器选择的文件夹）
  async exportStats(format: "json" | "csv", dir = "typelog-exports", name = "") {
    const data = {
      exportedAt: new Date().toISOString(),
      global: this.store.getGlobalStats(),
      project: this.store.getProjectStats(),
      files: this.store.getAllFileStats(),
    };
    // 清洗文件名，空则回退到默认名
    const safeName = safeFileName(name || defaultExportName()) || defaultExportName();
    const targetDir = dir.trim().replace(/[\\/]+$/g, "") || "typelog-exports";
    const filePath = `${targetDir}/${safeName}.${format}`;
    const content =
      format === "json"
        ? JSON.stringify(data, null, 2)
        : (() => {
            const header = "path,grossTyped,deletedChars,activeTimeMs,firstSeen,lastOpened";
            const rows = this.store
              .getAllFileStats()
              .map((f) => [csvField(f.path), f.grossTyped, f.deletedChars, f.activeTimeMs, f.firstSeen, f.lastOpened].join(","));
            return "\uFEFF" + header + "\n" + rows.join("\n");
          })();
    try {
      if (isSystemPath(targetDir)) {
        // 系统绝对路径（vault 外）：Node fs 写入，自动创建目录
        await this.storage.write(filePath, content);
      } else {
        // vault 内相对路径：逐层创建目录后经 vault 写入
        let cur = "";
        for (const part of targetDir.split("/")) {
          cur = cur ? `${cur}/${part}` : part;
          if (!(await this.app.vault.adapter.exists(cur))) {
            await this.app.vault.adapter.mkdir(cur);
          }
        }
        await this.app.vault.create(filePath, content);
      }
      new Notice(t("notice.exportDone", { path: filePath }));
    } catch (e) {
      new Notice(t("notice.exportFail", { err: String(e) }));
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<TypeLogSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, sanitizeSettings(data));
    // 一次性迁移：v1.0.6 及之前「每日统计保留 365 天」是默认值并已落盘。
    // 检测到旧默认组合（文件不清理 + 每日 365）时归零为新默认「不清理」，避免旧默认覆盖新默认
    if (this.settings.purgeInactiveDays === 0 && this.settings.dailyRetentionDays === 365) {
      this.settings.dailyRetentionDays = 0;
      await this.saveData(this.settings);
    }
  }

  // 排除规则变更后热更新匹配器（设置页调用，无需重载插件即可生效）
  refreshExcludePatterns() {
    this.ignoreMatcher = compileIgnorePatterns(this.settings.excludePatterns);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
