// 硬重置确认对话框
import { App, Modal, Notice } from "obsidian";
import type TypeLogPlugin from "../main";

export class HardResetModal extends Modal {
  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app);
    this.titleEl.setText("确认硬重置所有历史统计？");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: "将永久删除全部文件层、工程层、全局层统计数据（含终身累计与热力图）。此操作不可撤销，建议先导出备份。",
    });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = row.createEl("button", { text: "取消", cls: "mod-cta" });
    const okBtn = row.createEl("button", { text: "确认清除", cls: "mod-warning" });
    cancelBtn.addEventListener("click", () => this.close());
    okBtn.addEventListener("click", () => {
      this.plugin.store.hardReset();
      void this.plugin.store.flush();
      new Notice("TypeLog：所有历史统计已清除");
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
