// 两阶段二次确认弹窗：
// 第一阶段说明操作内容与后果，点击“继续”进入最终确认；
// 第二阶段同样说明后果，且确认按钮需等待倒计时结束才能点击。
import { App, Modal } from "obsidian";
import { t } from "../core/i18n";

// 单次确认弹窗：说明操作与后果，直接确认/取消（用于停止番茄钟等轻量操作）
export interface ConfirmOptions {
  title: string;
  // 说明段落（操作是什么、后果是什么）
  text: string[];
  // 确认按钮文案
  confirmText: string;
  // 确认后执行的操作
  onConfirm: () => void;
}

export class ConfirmModal extends Modal {
  constructor(app: App, private opts: ConfirmOptions) {
    super(app);
    this.titleEl.setText(opts.title);
  }

  onOpen() {
    const { contentEl } = this;
    for (const p of this.opts.text) {
      contentEl.createEl("p", { text: p });
    }
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = row.createEl("button", { text: t("confirm.cancel"), cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    const ok = row.createEl("button", { text: this.opts.confirmText, cls: "mod-warning" });
    ok.addEventListener("click", () => {
      this.opts.onConfirm();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface DoubleConfirmOptions {
  title: string;
  // 第一阶段说明段落（操作是什么、后果是什么）
  step1: string[];
  // 第二阶段说明段落（最终确认强调）
  step2: string[];
  // 最终确认按钮的倒计时（秒）
  countdownSec: number;
  // 最终确认按钮文案
  confirmText: string;
  // 确认后执行的操作
  onConfirm: () => void;
}

export class DoubleConfirmModal extends Modal {
  private timer: number | null = null;

  constructor(app: App, private opts: DoubleConfirmOptions) {
    super(app);
    this.titleEl.setText(opts.title);
  }

  onOpen() {
    this.renderStep1();
  }

  onClose() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.contentEl.empty();
  }

  // 第一步：说明操作与后果，仅提供“继续”
  private renderStep1() {
    const { contentEl } = this;
    contentEl.empty();
    for (const p of this.opts.step1) {
      contentEl.createEl("p", { text: p });
    }
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = row.createEl("button", { text: t("confirm.cancel"), cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    const next = row.createEl("button", { text: t("confirm.continue"), cls: "mod-warning" });
    next.addEventListener("click", () => this.renderStep2());
  }

  // 第二步：再次说明后果，确认按钮进入倒计时，结束后才可点击
  private renderStep2() {
    const { contentEl } = this;
    contentEl.empty();
    for (const p of this.opts.step2) {
      contentEl.createEl("p", { text: p });
    }
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = row.createEl("button", { text: t("confirm.cancel"), cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    const ok = row.createEl("button", { text: "", cls: "mod-warning" });
    ok.disabled = true;

    const start = Date.now();
    const tick = () => {
      const remain = Math.max(0, this.opts.countdownSec - Math.floor((Date.now() - start) / 1000));
      if (remain <= 0) {
        ok.disabled = false;
        ok.setText(this.opts.confirmText);
        if (this.timer !== null) {
          window.clearInterval(this.timer);
          this.timer = null;
        }
      } else {
        ok.setText(`${this.opts.confirmText}（${remain}s）`);
      }
    };
    tick();
    this.timer = window.setInterval(tick, 250);

    ok.addEventListener("click", () => {
      if (ok.disabled) return;
      this.opts.onConfirm();
      this.close();
    });
  }
}
