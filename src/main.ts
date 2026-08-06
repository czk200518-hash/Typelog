import { MarkdownView, Notice, Plugin, FileSystemAdapter } from "obsidian";
import {
  TypeLogSettings,
  DEFAULT_SETTINGS,
  UiLang,
  STATUS_BAR_ITEM_IDS,
  type StatusBarItemConfig,
  type StatusBarItemId,
} from "./core/settings";
import { setLang, t } from "./core/i18n";
import { StatsStore } from "./core/statsStore";
import { SessionStatsStore } from "./core/sessionStore";
import { compileIgnorePatterns, IgnoreMatcher } from "./core/pathFilter";
import { defaultExportName, formatMinutesSeconds, safeFileName } from "./core/format";
import { buildCsvExport } from "./core/csvExport";
import { buildMarkdownReport, type ReportRange, type ReportTemplate } from "./core/reportBuilder";
import { StatsEngine, toStatsKey } from "./tracking/statsEngine";
import { AdaptiveStorageAdapter, getNodeRequire, isSystemPath } from "./tracking/storageAdapter";
import { UiController } from "./ui/uiController";
import { ConfirmModal, DoubleConfirmModal } from "./ui/doubleConfirmModal";
import { ExportStatsModal } from "./ui/exportModal";
import { ImportStatsModal } from "./ui/importModal";
import { RankingModal } from "./ui/rankingModal";
import { TypeLogSettingTab } from "./ui/settingsTab";
import type { FileStats } from "./types";

// 设置加载消毒：仅采纳类型与取值范围合法的字段，避免旧版本/损坏数据覆盖默认值
export function sanitizeSettings(data: Partial<TypeLogSettings> | null | undefined): Partial<TypeLogSettings> {
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
  if (typeof data.weeklyWordGoal === "number" && Number.isFinite(data.weeklyWordGoal) && data.weeklyWordGoal >= 0)
    out.weeklyWordGoal = data.weeklyWordGoal;
  if (typeof data.weeklyTimeGoalMin === "number" && Number.isFinite(data.weeklyTimeGoalMin) && data.weeklyTimeGoalMin >= 0)
    out.weeklyTimeGoalMin = data.weeklyTimeGoalMin;
  if (typeof data.goalNotify === "boolean") out.goalNotify = data.goalNotify;
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
  // 状态栏显示项：白名单校验（仅采纳合法 id + boolean 开关），去重，损坏数据回退默认
  if (Array.isArray(data.statusBarItems)) {
    const seen = new Set<string>();
    const items: StatusBarItemConfig[] = [];
    for (const it of data.statusBarItems) {
      const id = (it as { id?: unknown } | null)?.id;
      if (typeof id === "string" && (STATUS_BAR_ITEM_IDS as string[]).includes(id) && !seen.has(id)) {
        seen.add(id);
        items.push({ id: id as StatusBarItemId, enabled: (it as { enabled?: unknown }).enabled !== false });
      }
    }
    if (items.length > 0) {
      // 旧设置文件缺 goal 项时自动补齐（目标进度条默认启用，插在「今日总输入」之后，保持默认布局）
      if (!seen.has("goal")) {
        const goal: StatusBarItemConfig = { id: "goal", enabled: true };
        const gi = items.findIndex((i) => i.id === "todayGross");
        if (gi >= 0) items.splice(gi + 1, 0, goal);
        else items.push(goal);
      }
      out.statusBarItems = items;
    }
  }
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
    this.store = new StatsStore(
      this.storage,
      {
        fileStats: ".typelog/file-stats.json",
        project: ".typelog/project.json",
        globalStats: globalPath,
      },
      {
        // 连续写盘失败时提示（优化 5）
        onFlushError: () => new Notice(t("notice.flushError")),
      },
    );
    await this.store.load();

    // 启动一次性迁移：旧版本文件统计 key 为绝对路径（D:/vault/xxx.md），
    // vault 移动/换机后全部失效；统一映射为 vault 相对路径（幂等，二次启动自动跳过）
    const adapter = this.app.vault.adapter;
    const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
    if (this.store.migratePaths(basePath) > 0) void this.store.flush();

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
      onGoalDue: () => this.onGoalDue(),
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
    this.settingTab?.refresh();
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

  // 每日目标达成通知（功能 5）
  private onGoalDue() {
    new Notice(t("notice.goalDone"));
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
      id: "export-report",
      name: t("cmd.exportReport"),
      // 一键生成：默认完整版 + 近 7 天，写入 typelog-reports/
      callback: () => void this.exportStats("md", "typelog-reports", "", { mdTemplate: "full", mdRange: 7 }),
    });
    this.addCommand({
      id: "export-backup",
      name: t("cmd.exportBackup"),
      callback: () =>
        void this.exportBackup()
          .then((p) => new Notice(t("notice.exportDone", { path: p })))
          .catch((e) => new Notice(t("notice.exportFail", { err: String(e) }))),
    });
    this.addCommand({
      id: "import-stats",
      name: t("cmd.importStats"),
      callback: () => this.openImportModal(),
    });
    this.addCommand({
      id: "open-ranking",
      name: t("cmd.openRanking"),
      callback: () => new RankingModal(this.app, this).open(),
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
    const abs = toStatsKey(view.file.path);
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
  // format: json（全量）/ csv（文件级 或 文件+每日+热力图）/ md（Markdown 统计报告，可选模板与范围）
  async exportStats(
    format: "json" | "csv" | "md",
    dir = "typelog-exports",
    name = "",
    opts: { csvContent?: "files" | "all"; mdTemplate?: ReportTemplate; mdRange?: ReportRange } = {},
  ) {
    const data = {
      exportedAt: new Date().toISOString(),
      // JSON 导出格式的全局数据键固定为 "global"（历史兼容），计算属性避免裸标识符
      ["global"]: this.store.getGlobalStats(),
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
        : format === "md"
          ? buildMarkdownReport(
              {
                globalStats: this.store.getGlobalStats(),
                files: this.filterExistingFiles(this.store.getAllFileStats()),
                pluginVersion: this.manifest.version,
                vaultName: this.app.vault.getName(),
              },
              { template: opts.mdTemplate ?? "full", range: opts.mdRange ?? 7 },
            )
          : buildCsvExport(this.store.getGlobalStats(), this.store.getAllFileStats(), opts.csvContent ?? "all");
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

  // 过滤已被删除的文件统计（报告/排行只展示当前 vault 中存在的文件）
  private filterExistingFiles<T extends { path: string }>(files: T[]): T[] {
    const vault = this.app.vault;
    return files.filter((f) => vault.getAbstractFileByPath(f.path) !== null);
  }

  // 当前 vault 中仍存在的文件统计（排行/报告共用）
  getExistingFileStats(): FileStats[] {
    return this.filterExistingFiles(this.store.getAllFileStats());
  }

  // ---- 数据备份 / 导入恢复（功能 4）----
  // 导出单一 .typelog 备份文件（自描述 JSON，含 format/version 头）
  async exportBackup(dir = "typelog-backups", name = ""): Promise<string> {
    const backup = {
      format: "typelog-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      source: {
        pluginVersion: this.manifest.version,
        vaultName: this.app.vault.getName(),
        vaultPath: this.getVaultBasePath() ?? "",
      },
      data: {
        fileStats: Object.fromEntries(this.store.getAllFileStats().map((f) => [f.path, f])),
        project: this.store.getProjectStats(),
        // .typelog 备份格式的全局数据键固定为 "global"（历史兼容），计算属性避免裸标识符
        ["global"]: this.store.getGlobalStats(),
        settings: this.settings,
      },
    };
    const safeName = safeFileName(name || `typelog-backup-${defaultExportName()}`) || `typelog-backup-${defaultExportName()}`;
    const targetDir = dir.trim().replace(/[\\/]+$/g, "") || "typelog-backups";
    const filePath = `${targetDir}/${safeName}.typelog`;
    const content = JSON.stringify(backup, null, 2);
    if (isSystemPath(targetDir)) {
      await this.storage.write(filePath, content);
    } else {
      let cur = "";
      for (const part of targetDir.split("/")) {
        cur = cur ? `${cur}/${part}` : part;
        if (!(await this.app.vault.adapter.exists(cur))) {
          await this.app.vault.adapter.mkdir(cur);
        }
      }
      await this.app.vault.create(filePath, content);
    }
    return filePath;
  }

  // 导入 .typelog 备份：校验 → 导入前自动备份 → 按模式合并/覆盖 → 可选恢复设置
  async importStats(path: string, mode: "merge" | "overwrite", restoreSettings: boolean): Promise<void> {
    const content = await this.storage.read(path);
    if (!content) throw new Error(t("notice.importReadFail"));
    let parsed: { format?: unknown; version?: unknown; data?: unknown };
    try {
      // JSON.parse 返回 any：先断言 unknown 再收窄，避免 no-unsafe-assignment 告警
      parsed = JSON.parse(content) as unknown as { format?: unknown; version?: unknown; data?: unknown };
    } catch {
      throw new Error(t("notice.importInvalid"));
    }
    if (!parsed || parsed.format !== "typelog-backup") throw new Error(t("notice.importInvalid"));
    if (parsed.version !== 1) throw new Error(t("notice.importVersion"));

    // 导入前自动备份当前数据（可回滚）
    try {
      await this.exportBackup(".typelog/backups", `backup-before-import-${Date.now()}`);
    } catch (e) {
      console.error("[TypeLog] 导入前自动备份失败：", e);
    }

    // .typelog 备份格式的全局数据键为 "global"（历史兼容）；fileStats/project 直接读取
    const data = (parsed.data ?? {}) as { fileStats?: unknown; project?: unknown; settings?: unknown };
    this.store.applyImport(data, mode, this.getVaultBasePath());

    if (restoreSettings && data.settings && typeof data.settings === "object") {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, sanitizeSettings(data.settings as Partial<TypeLogSettings>));
      await this.saveSettings();
      this.applyLanguage();
    }
    await this.store.flush();
    this.ui.refresh();
  }

  // vault 基础路径（桌面端 FileSystemAdapter）；非桌面端返回 null
  private getVaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  // 打开导入弹窗（覆盖模式内部二次确认）
  openImportModal() {
    new ImportStatsModal(this.app, this).open();
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
