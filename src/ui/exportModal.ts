// 导出统计报表弹窗：可选择导出格式、导出目录（资源管理器选择或 vault 内文件夹补全）与文件名
import { App, FileSystemAdapter, Modal, Notice, Setting, TFolder } from "obsidian";
import { AbstractInputSuggest } from "obsidian";
import type TypeLogPlugin from "../main";
import { defaultExportName } from "../core/format";
import { getNodeRequire } from "../tracking/storageAdapter";

// vault 文件夹建议器（输入时按路径前缀补全）
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase();
    const out: TFolder[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          out.push(child);
          walk(child);
        }
      }
    };
    walk(this.app.vault.getRoot());
    return out.filter((f) => f.path.toLowerCase().includes(lower)).slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path || "/");
  }

  selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent) {
    this.setValue(folder.path || "/");
    this.close();
  }
}

// 在系统资源管理器中选取文件夹（桌面端 Electron）；失败返回 null
export async function pickSystemFolder(): Promise<string | null> {
  const req = getNodeRequire();
  if (!req) return null;
  try {
    const electron = req("electron") as {
      remote?: { dialog: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
    };
    const remote = electron?.remote;
    if (!remote) return null;
    const res = await remote.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (!res.canceled && res.filePaths.length > 0) return res.filePaths[0];
  } catch {
    // 对话框被中断等场景忽略
  }
  return null;
}

export class ExportStatsModal extends Modal {
  private format: "json" | "csv" = "json";
  private dir = "typelog-exports";
  private fileName = defaultExportName();

  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app);
    this.titleEl.setText("导出统计报表");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("导出格式").addDropdown((dd) =>
      dd
        .addOption("json", "JSON")
        .addOption("csv", "CSV")
        .setValue(this.format)
        .onChange((v) => (this.format = v as "json" | "csv")),
    );

    let dirText: { setValue(v: string): void };
    new Setting(contentEl)
      .setName("导出目录")
      .addText((text) => {
        dirText = text;
        text.setValue(this.dir).onChange((v) => (this.dir = v.trim() || "typelog-exports"));
        // 挂载 vault 内文件夹自动补全
        new FolderSuggest(this.app, text.inputEl);
      })
      .addButton((b) =>
        b.setButtonText("浏览…").onClick(async () => {
          const chosen = await pickSystemFolder();
          if (!chosen) {
            new Notice("TypeLog：当前环境不支持系统文件夹选择，请手动输入路径");
            return;
          }
          this.dir = this.toVaultRelative(chosen);
          dirText.setValue(this.dir);
        }),
      );

    new Setting(contentEl)
      .setName("文件名")
      .setDesc("不需要包含扩展名")
      .addText((text) =>
        text.setValue(this.fileName).onChange((v) => (this.fileName = v.trim())),
      );

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("导出").setCta().onClick(() => this.doExport()),
    );
  }

  private doExport() {
    void this.plugin.exportStats(this.format, this.dir, this.fileName);
    this.close();
  }

  // 所选绝对路径若在 vault 内则转相对路径，否则保留系统绝对路径
  private toVaultRelative(abs: string): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const base = adapter.getBasePath();
      if (base) {
        const normAbs = abs.replace(/\\/g, "/").replace(/\/+$/g, "");
        const normBase = base.replace(/\\/g, "/").replace(/\/+$/g, "");
        if (normAbs === normBase) return "";
        if (normAbs.startsWith(normBase + "/")) return normAbs.slice(normBase.length + 1);
      }
    }
    return abs;
  }

  onClose() {
    this.contentEl.empty();
  }
}
