import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { TypeLogSettings, DEFAULT_SETTINGS } from "./core/settings";
import { StatsStore } from "./core/statsStore";
import { SessionStatsStore } from "./core/sessionStore";
import { compileIgnorePatterns, IgnoreMatcher } from "./core/pathFilter";
import { dateKey } from "./core/format";
import { StatsEngine, toAbsolutePath } from "./tracking/statsEngine";
import { AdaptiveStorageAdapter, getNodeRequire } from "./tracking/storageAdapter";
import { UiController } from "./ui/uiController";
import { HardResetModal } from "./ui/hardResetModal";

// 插件入口：双轨统计（净产出 NetWords + 总劳动量 GrossTyped）
export default class TypeLogPlugin extends Plugin {
  settings: TypeLogSettings = DEFAULT_SETTINGS;
  store!: StatsStore;
  session = new SessionStatsStore();
  engine!: StatsEngine;
  ui!: UiController;
  private ignoreMatcher: IgnoreMatcher = () => false;

  async onload() {
    await this.loadSettings();
    this.ignoreMatcher = compileIgnorePatterns(this.settings.excludePatterns);

    // 三层存储
    const adapter = new AdaptiveStorageAdapter(this.app.vault);
    const req = getNodeRequire();
    let globalPath = ".typelog/global.json";
    if (req) {
      const os = req("os");
      const path = req("path");
      globalPath = path.join(os.homedir(), ".typelog", "global.json");
    }
    this.store = new StatsStore(adapter, {
      fileStats: ".typelog/file-stats.json",
      project: ".typelog/project.json",
      global: globalPath,
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
    new Notice(`🍅 已连续编辑 ${this.settings.pomodoroMinutes} 分钟，休息一下吧！`);
  }

  private registerCommands() {
    this.addCommand({
      id: "open-dashboard",
      name: "打开统计窗口",
      callback: () => this.ui.openStatsWindow(),
    });
    this.addCommand({
      id: "reset-session",
      name: "重置当前文件统计",
      callback: () => this.resetSession(),
    });
    this.addCommand({
      id: "export-json",
      name: "导出所有统计报表（JSON）",
      callback: () => void this.exportStats("json"),
    });
    this.addCommand({
      id: "export-csv",
      name: "导出所有统计报表（CSV）",
      callback: () => void this.exportStats("csv"),
    });
    this.addCommand({
      id: "hard-reset",
      name: "硬重置（清除所有历史）",
      callback: () => new HardResetModal(this.app, this).open(),
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

  // 导出到 vault 的 typelog-exports 目录
  async exportStats(format: "json" | "csv") {
    const data = {
      exportedAt: new Date().toISOString(),
      global: this.store.getGlobalStats(),
      project: this.store.getProjectStats(),
      files: this.store.getAllFileStats(),
    };
    const dir = "typelog-exports";
    if (!(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }
    const name = `typelog-${dateKey(new Date())}-${Date.now()}`;
    try {
      if (format === "json") {
        const path = `${dir}/${name}.json`;
        await this.app.vault.create(path, JSON.stringify(data, null, 2));
        new Notice(`TypeLog：已导出 ${path}`);
      } else {
        const header = "path,grossTyped,deletedChars,activeTimeMs,firstSeen,lastOpened";
        const rows = this.store.getAllFileStats().map((f) =>
          [f.path, f.grossTyped, f.deletedChars, f.activeTimeMs, f.firstSeen, f.lastOpened].join(","),
        );
        const path = `${dir}/${name}.csv`;
        await this.app.vault.create(path, "\uFEFF" + header + "\n" + rows.join("\n"));
        new Notice(`TypeLog：已导出 ${path}`);
      }
    } catch (e) {
      new Notice(`TypeLog：导出失败 ${String(e)}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
