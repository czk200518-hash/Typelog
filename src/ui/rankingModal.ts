// 活跃文件排行弹窗（功能 2）：基于文件级统计按维度排序展示 Top N，点击条目跳转到对应笔记。
// 复用「构建一次结构 + 定时刷新数值」模式（同 StatusBarDetailModal）；排序逻辑与报告共用 topActiveFiles。
import { App, Modal } from "obsidian";
import type TypeLogPlugin from "../main";
import { formatDuration, formatNumber } from "../core/format";
import { topActiveFiles } from "../core/reportBuilder";
import { t } from "../core/i18n";

export type RankingSortKey = "active" | "gross" | "net";

export class RankingModal extends Modal {
  private sortBy: RankingSortKey = "active";
  private limit = 10;
  private timer: number | null = null;
  private sortBtns: Partial<Record<RankingSortKey, HTMLElement>> = {};
  private listEl!: HTMLElement;

  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app);
    this.titleEl.setText(t("ranking.title"));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("typelog-ranking");

    // 排序维度切换（点击后仅更新激活态与列表内容，不重建整体结构）
    const controls = contentEl.createDiv({ cls: "typelog-ranking-controls" });
    const mkBtn = (key: RankingSortKey, label: string) => {
      const btn = controls.createEl("button", { cls: `typelog-ranking-btn${this.sortBy === key ? " is-active" : ""}` });
      btn.setText(label);
      btn.addEventListener("click", () => {
        this.sortBy = key;
        for (const [k, el] of Object.entries(this.sortBtns)) el?.toggleClass("is-active", k === key);
        this.renderList();
      });
      this.sortBtns[key] = btn;
    };
    mkBtn("active", t("ranking.sortActive"));
    mkBtn("gross", t("ranking.sortGross"));
    mkBtn("net", t("ranking.sortNet"));

    this.listEl = contentEl.createDiv({ cls: "typelog-ranking-list" });
    this.renderList();
    // 低频刷新即可（文件统计分钟级变化）
    this.timer = window.setInterval(() => this.renderList(), 5000);
  }

  private renderList() {
    const top = topActiveFiles(this.plugin.getExistingFileStats(), this.sortBy, this.limit);
    const list = this.listEl;
    list.empty();
    if (top.length === 0) {
      list.createDiv({ cls: "typelog-empty" }).setText(t("ranking.empty"));
      return;
    }
    top.forEach((f, i) => {
      const row = list.createDiv({ cls: "typelog-ranking-row" });
      row.createDiv({ cls: `typelog-ranking-rank rank-${Math.min(i + 1, 3)}` }).setText(String(i + 1));
      const body = row.createDiv({ cls: "typelog-ranking-body" });
      body.createDiv({ cls: "typelog-ranking-name" }).setText(f.path.split("/").pop() ?? f.path);
      body.createDiv({ cls: "typelog-ranking-sub" }).setText(f.path);
      const val =
        this.sortBy === "gross"
          ? formatNumber(f.grossTyped)
          : this.sortBy === "active"
            ? formatDuration(f.activeTimeMs)
            : formatNumber(Math.max(0, f.grossTyped - f.deletedChars));
      row.createDiv({ cls: "typelog-ranking-value" }).setText(val);
      row.title = f.path;
      // 点击跳转到对应笔记
      row.addEventListener("click", () => {
        void this.app.workspace.openLinkText(f.path, "", false);
      });
    });
  }

  onClose() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.contentEl.empty();
  }
}
