// UI 控制器：状态栏/侧边栏面板/悬浮窗/设置页装配
import type TypeLogPlugin from "../main";
import { StatusBarController } from "./statusBar";
import { DashboardView, VIEW_TYPE_TYPELOG } from "./dashboardView";
import { TypeLogSettingTab } from "./settingsTab";
import { Notice, Platform } from "obsidian";

export class UiController {
  private statusBar: StatusBarController;

  constructor(private plugin: TypeLogPlugin) {
    this.statusBar = new StatusBarController(plugin);
  }

  // 注册视图与设置页，按设置应用显示方式
  init() {
    this.plugin.registerView(VIEW_TYPE_TYPELOG, (leaf) => new DashboardView(leaf, this.plugin));
    this.plugin.addSettingTab(new TypeLogSettingTab(this.plugin.app, this.plugin));
    this.applyDisplayModes();
  }

  // 按设置开关状态栏
  applyDisplayModes() {
    const s = this.plugin.settings;
    if (s.showStatusBar) {
      this.statusBar.build();
    } else {
      this.statusBar.destroy();
    }
  }

  refresh() {
    this.statusBar.refresh();
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYPELOG);
    for (const leaf of leaves) {
      (leaf.view as DashboardView).refresh();
    }
  }

  // 按设置的窗口模式打开统计窗口
  openStatsWindow() {
    const mode = this.plugin.settings.windowMode;
    if (mode === "floating") {
      // 悬浮窗暂时隐藏（开发中），降级为侧边栏
      this.openDashboard();
    } else if (mode === "sidebar") {
      this.openDashboard();
    } else {
      new Notice("TypeLog：当前未启用统计窗口，可在设置中开启（侧边栏面板）");
    }
  }

  // 打开侧边栏面板（聚焦已有，否则新建）
  openDashboard() {
    const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYPELOG)[0];
    if (existing) {
      this.plugin.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.plugin.app.workspace.getRightLeaf(false);
    if (leaf) {
      void leaf.setViewState({ type: VIEW_TYPE_TYPELOG, active: true });
    }
  }

  // 悬浮窗（桌面端专用，移动端降级侧边栏）；仅今日三数据 + 小窗口 + 置顶
  openFloating() {
    if (Platform.isDesktopApp) {
      try {
        const leaf = this.plugin.app.workspace.openPopoutLeaf({
          size: { width: 120, height: 160 },
        });
        if (leaf) {
          void (async () => {
            await leaf.setViewState({ type: VIEW_TYPE_TYPELOG, active: true });
            const view = leaf.view;
            if (view instanceof DashboardView) {
              view.setCompact(true);
              view.setPopout(true);
              // 渲染完成后按内容高度调整窗口尺寸
              setTimeout(() => {
                try {
                  const win = view.getOwnWindow();
                  if (win) {
                    const h = Math.min(260, view.contentEl.scrollHeight + 36);
                    win.resizeTo(120, h);
                  }
                } catch {
                  // 窗口已关闭等场景忽略
                }
              }, 300);
            }
            this.plugin.app.workspace.revealLeaf(leaf);
          })();
          return;
        }
      } catch (e) {
        console.error("[TypeLog] 打开悬浮窗失败：", e);
      }
    }
    this.openDashboard();
  }

  destroy() {
    this.statusBar.destroy();
  }
}
