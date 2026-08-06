// 导入统计数据弹窗（功能 4）：选择 .typelog 备份文件 → 导入模式（合并/覆盖）→ 可选恢复设置。
// 覆盖模式需二次确认（DoubleConfirmModal）；导入前插件自动备份当前数据到 .typelog/backups/。
import { App, Modal, Notice, Setting } from "obsidian";
import type TypeLogPlugin from "../main";
import { getNodeRequire } from "../tracking/storageAdapter";
import { DoubleConfirmModal } from "./doubleConfirmModal";
import { t } from "../core/i18n";

// 系统资源管理器选择文件（桌面端 Electron）；失败返回 null
export async function pickSystemFile(): Promise<string | null> {
  const req = getNodeRequire();
  if (!req) return null;
  try {
    const electron = req("electron") as {
      remote?: { dialog: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
    };
    const remote = electron?.remote;
    if (!remote) return null;
    const res = await remote.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "TypeLog 备份", extensions: ["typelog", "json"] }],
    });
    if (!res.canceled && res.filePaths.length > 0) return res.filePaths[0];
  } catch {
    // 对话框被中断等场景忽略
  }
  return null;
}

export class ImportStatsModal extends Modal {
  private path = "";
  private mode: "merge" | "overwrite" = "merge";
  private restoreSettings = false;

  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app);
    this.titleEl.setText(t("import.title"));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: t("import.hint"), cls: "typelog-desc-preline" });

    let pathText: { setValue(v: string): void };
    new Setting(contentEl)
      .setName(t("import.path"))
      .addText((text) => {
        pathText = text;
        text.setPlaceholder(".typelog / .json").onChange((v) => (this.path = v.trim()));
      })
      .addButton((b) =>
        b.setButtonText(t("import.browse")).onClick(async () => {
          const chosen = await pickSystemFile();
          if (!chosen) {
            new Notice(t("export.browseFail"));
            return;
          }
          this.path = chosen;
          pathText.setValue(chosen);
        }),
      );

    new Setting(contentEl)
      .setName(t("import.mode"))
      .addDropdown((dd) =>
        dd
          .addOption("merge", t("import.modeMerge"))
          .addOption("overwrite", t("import.modeOverwrite"))
          .setValue(this.mode)
          .onChange((v) => (this.mode = v as "merge" | "overwrite")),
      );

    new Setting(contentEl)
      .setName(t("import.restoreSettings"))
      .setDesc(t("import.restoreSettingsDesc"))
      .addToggle((tg) => tg.setValue(this.restoreSettings).onChange((v) => (this.restoreSettings = v)));

    new Setting(contentEl).addButton((b) => b.setButtonText(t("import.doImport")).setCta().onClick(() => this.doImport()));
  }

  private doImport() {
    if (!this.path) {
      new Notice(t("import.noPath"));
      return;
    }
    const run = () => {
      this.plugin
        .importStats(this.path, this.mode, this.restoreSettings)
        .then(() => {
          new Notice(t("notice.importDone"));
          this.close();
        })
        .catch((e: unknown) => new Notice(t("notice.importFail", { err: String(e) })));
    };
    if (this.mode === "overwrite") {
      new DoubleConfirmModal(this.app, {
        title: t("import.overwriteTitle"),
        step1: [t("import.overwriteStep1a"), t("import.overwriteStep1b")],
        step2: [t("import.overwriteStep2")],
        countdownSec: 10,
        confirmText: t("import.overwriteConfirm"),
        onConfirm: run,
      }).open();
    } else {
      run();
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
