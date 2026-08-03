import { MarkdownView, Notice, Plugin } from "obsidian";
import { TypeLogSettings, DEFAULT_SETTINGS } from "./core/settings";
import { StatsStore } from "./core/statsStore";
import { SessionStatsStore } from "./core/sessionStore";
import { compileIgnorePatterns, IgnoreMatcher } from "./core/pathFilter";
import { defaultExportName, formatMinutesSeconds, safeFileName } from "./core/format";
import { StatsEngine, toAbsolutePath } from "./tracking/statsEngine";
import { AdaptiveStorageAdapter, getNodeRequire, isSystemPath } from "./tracking/storageAdapter";
import { UiController } from "./ui/uiController";
import { ConfirmModal, DoubleConfirmModal } from "./ui/doubleConfirmModal";
import { ExportStatsModal } from "./ui/exportModal";

// 插件入口：双轨统计（净产出 NetWords + 总劳动量 GrossTyped）
export default class TypeLogPlugin extends Plugin {
  settings: TypeLogSettings = DEFAULT_SETTINGS;
  store!: StatsStore;
  // 自适应存储（系统路径 / vault 路径），导出报表等复用其系统路径写入能力
  storage!: AdaptiveStorageAdapter;
  session = new SessionStatsStore();
  engine!: StatsEngine;
  ui!: UiController;
  private ignoreMatcher: IgnoreMatcher = () => false;

  async onload() {
    await this.loadSettings();
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

  onunload() {
    this.engine?.stop();
    this.ui?.destroy();
    void this.store?.flush();
  }

  private registerRibbon() {
    this.addRibbonIcon("bar-chart-2", "TypeLog 字迹", () => {
      this.ui.openStatsWindow();
    });
  }

  private onUiUpdate() {
    this.ui?.refresh();
  }

  private onPomodoroDue() {
    const modeText = this.settings.pomodoroMode === "real" ? "计时" : "连续编辑";
    const notice = new Notice(`🍅 番茄钟完成！已${modeText} ${formatMinutesSeconds(this.settings.pomodoroMinutes)}，休息一下吧！`, 6000);
    // 完成提醒改为屏幕中央弹窗
    notice.noticeEl.addClass("typelog-notice-center");
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
      const modeText = this.settings.pomodoroMode === "real" ? "计时" : "连续活跃";
      new Notice(`🍅 番茄钟已开始（${modeText}），${formatMinutesSeconds(this.settings.pomodoroMinutes)} 后提醒休息`);
      return true;
    }
    new Notice("TypeLog：请先在设置中开启番茄钟提醒");
    return false;
  }

  // 暂停：冻结计时（已累计时长保留）
  pausePomodoro() {
    this.engine.pausePomodoro();
    new Notice("🍅 番茄钟已暂停");
  }

  // 继续：恢复计时
  resumePomodoro() {
    this.engine.resumePomodoro();
    new Notice("🍅 番茄钟已继续");
  }

  // 停止：单次二次确认（说明操作与后果，直接确认/取消）
  confirmStopPomodoro() {
    if (!this.engine.isPomodoroRunning()) return;
    new ConfirmModal(this.app, {
      title: "确认停止番茄钟？",
      text: [
        "操作：立即停止当前番茄钟，本轮已累计的时间将被清除，需重新开始才能再次计时。",
        "后果：仅影响当前这轮番茄钟计时，不会清除任何统计数据；随时可再次点击“开始番茄钟”。",
      ],
      confirmText: "确认停止番茄钟",
      onConfirm: () => {
        this.engine.stopPomodoro();
        new Notice("🍅 番茄钟已停止");
      },
    }).open();
  }

  private registerCommands() {
    this.addCommand({
      id: "toggle-pomodoro",
      name: "开始/停止番茄钟",
      callback: () => this.togglePomodoro(),
    });
    this.addCommand({
      id: "open-dashboard",
      name: "打开统计窗口",
      callback: () => this.ui.openStatsWindow(),
    });
    this.addCommand({
      id: "reset-session",
      name: "重置当前文件统计",
      callback: () => this.confirmResetSession(),
    });
    this.addCommand({
      id: "export-stats",
      name: "导出统计报表（自定义路径与文件名）",
      callback: () => new ExportStatsModal(this.app, this).open(),
    });
    this.addCommand({
      id: "hard-reset",
      name: "硬重置（清除所有历史）",
      callback: () => this.confirmHardReset(),
    });
  }

  // 重置会话统计（仅会话级，不影响历史累计）
  resetSession() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("当前没有打开的 Markdown 文件");
      return;
    }
    const abs = toAbsolutePath(this.app.vault, view.file.path);
    this.session.begin(abs, view.editor.getValue(), this.settings.countMode, Date.now());
    new Notice("TypeLog：已重置当前文件会话统计");
  }

  // 重置会话：两阶段二次确认（第二步含 10s 倒计时）
  confirmResetSession() {
    new DoubleConfirmModal(this.app, {
      title: "确认重置当前文件会话统计？",
      step1: [
        "操作：将当前打开文件本次会话的统计（净字数、累计输入、删除字符、活跃时长、峰值速度）清零，并重新开始累计。",
        "后果：本次会话的统计数据将丢失且无法恢复；不影响该文件的历史累计与全局统计。",
      ],
      step2: [
        "最终确认：点击下方“确认重置会话”后，当前文件本次会话统计将立即清零。",
      ],
      countdownSec: 10,
      confirmText: "确认重置会话",
      onConfirm: () => this.resetSession(),
    }).open();
  }

  // 硬重置：两阶段二次确认（第二步含 10s 倒计时）
  confirmHardReset() {
    new DoubleConfirmModal(this.app, {
      title: "确认硬重置所有历史统计？",
      step1: [
        "操作：永久删除全部文件层、工程层、全局层统计数据（含终身累计、每日热力图、峰值速度等）。",
        "后果：所有历史统计将全部丢失且不可恢复，建议先使用“导出统计报表”备份数据。",
      ],
      step2: [
        "最终确认：此操作不可撤销，确认后所有历史统计将被永久清除！",
      ],
      countdownSec: 10,
      confirmText: "确认清除所有历史",
      onConfirm: () => {
        this.store.hardReset();
        void this.store.flush();
        new Notice("TypeLog：所有历史统计已清除");
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
              .map((f) => [f.path, f.grossTyped, f.deletedChars, f.activeTimeMs, f.firstSeen, f.lastOpened].join(","));
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
      new Notice(`TypeLog：已导出 ${filePath}`);
    } catch (e) {
      new Notice(`TypeLog：导出失败 ${String(e)}`);
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<TypeLogSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
