// obsidian 运行时桩：官方包仅有类型声明（obsidian.d.ts）、无运行时入口，
// 测试环境（node）下所有从 "obsidian" 导入的符号由此文件提供最小实现。
export class FileSystemAdapter {
  getBasePath(): string {
    return "/vault";
  }
}
export class MarkdownView {}
export class Workspace {}
export class Vault {}
export class TFile {}
export class EventRef {}
export class Notice {}
export class Plugin {}
export class Modal {}
export class Setting {}
export class WorkspaceLeaf {}
export class ItemView {
  contentEl!: HTMLElement;
  constructor(public leaf: unknown) {
    // DOM 环境（happy-dom/jsdom）下提供视图内容容器，node 环境留空
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      this.contentEl = document.createElement("div");
    }
  }
}
