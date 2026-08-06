// 导出统计报表弹窗：可选择导出格式、导出目录（资源管理器选择或 vault 内文件夹补全）与文件名。
// 格式：JSON（全量）/ CSV（文件级 或 全部区块）/ Markdown（完整/精简模板 + 范围可选）
import { AbstractInputSuggest, App, FileSystemAdapter, Modal, Notice, Setting, TFolder } from "obsidian";
import type TypeLogPlugin from "../main";
import { defaultExportName } from "../core/format";
import type { ReportRange, ReportTemplate } from "../core/reportBuilder";
import { getNodeRequire } from "../tracking/storageAdapter";
import { t } from "../core/i18n";

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
  private format: "json" | "csv" | "md" = "json";
  private dir = "typelog-exports";
  private fileName = defaultExportName();
  // CSV 导出内容（文件级 / 全部）
  private csvContent: "files" | "all" = "all";
  // Markdown 报告选项
  private mdTemplate: ReportTemplate = "full";
  private mdRange: ReportRange = 7;
  // 格式相关的条件设置项容器（格式切换时重建）
  private extraSetting: Setting | null = null;

  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app);
    this.titleEl.setText(t("export.title"));
  }

  onOpen() {
    this.build();
  }

  // 重建弹窗内容（格式切换时整体重建，保持 dir/fileName 状态）
  private build() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(t("export.format")).addDropdown((dd) =>
      dd
        .addOption("json", "JSON")
        .addOption("csv", "CSV")
        .addOption("md", "Markdown")
        .setValue(this.format)
        .onChange((v) => {
          this.format = v as "json" | "csv" | "md";
          this.build();
        }),
    );

    this.buildExtra(contentEl);

    let dirText: { setValue(v: string): void };
    new Setting(contentEl)
      .setName(t("export.dir"))
      .addText((text) => {
        dirText = text;
        text.setValue(this.dir).onChange((v) => (this.dir = v.trim() || "typelog-exports"));
        // 挂载 vault 内文件夹自动补全
        new FolderSuggest(this.app, text.inputEl);
      })
      .addButton((b) =>
        b.setButtonText(t("export.browse")).onClick(async () => {
          const chosen = await pickSystemFolder();
          if (!chosen) {
            new Notice(t("export.browseFail"));
            return;
          }
          this.dir = this.toVaultRelative(chosen);
          dirText.setValue(this.dir);
        }),
      );

    new Setting(contentEl)
      .setName(t("export.fileName"))
      .setDesc(t("export.fileNameDesc"))
      .addText((text) =>
        text.setValue(this.fileName).onChange((v) => (this.fileName = v.trim())),
      );

    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t("export.doExport")).setCta().onClick(() => this.doExport()),
    );
  }

  // 格式相关条件设置（CSV 内容 / MD 模板 + 范围）
  private buildExtra(container: HTMLElement) {
    if (this.format === "csv") {
      new Setting(container).setName(t("export.content")).addDropdown((dd) =>
        dd
          .addOption("files", t("export.contentFiles"))
          .addOption("all", t("export.contentAll"))
          .setValue(this.csvContent)
          .onChange((v) => (this.csvContent = v as "files" | "all")),
      );
    } else if (this.format === "md") {
      new Setting(container).setName(t("export.template")).addDropdown((dd) =>
        dd
          .addOption("full", t("export.templateFull"))
          .addOption("brief", t("export.templateBrief"))
          .setValue(this.mdTemplate)
          .onChange((v) => (this.mdTemplate = v as ReportTemplate)),
      );
      new Setting(container).setName(t("export.range")).addDropdown((dd) =>
        dd
          .addOption("7", t("export.range7"))
          .addOption("30", t("export.range30"))
          .addOption("month", t("export.rangeMonth"))
          .setValue(String(this.mdRange))
          .onChange((v) => (this.mdRange = (v === "month" ? "month" : parseInt(v, 10)) as ReportRange)),
      );
    }
  }

  private doExport() {
    void this.plugin.exportStats(this.format, this.dir, this.fileName, {
      csvContent: this.format === "csv" ? this.csvContent : undefined,
      mdTemplate: this.format === "md" ? this.mdTemplate : undefined,
      mdRange: this.format === "md" ? this.mdRange : undefined,
    });
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
