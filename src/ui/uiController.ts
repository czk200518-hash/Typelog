// UI 控制器：状态栏/侧边栏面板/悬浮窗/设置页装配
import type TypeLogPlugin from "../main";
import { StatusBarController } from "./statusBar";
import { DashboardView, VIEW_TYPE_TYPELOG } from "./dashboardView";
import { TypeLogSettingTab } from "./settingsTab";
import { Notice } from "obsidian";
import { t } from "../core/i18n";

export class UiController {
  private statusBar: StatusBarController;

  constructor(private plugin: TypeLogPlugin) {
    this.statusBar = new StatusBarController(plugin);
  }

  // 注册视图与设置页，按设置应用显示方式
  init() {
    this.plugin.registerView(VIEW_TYPE_TYPELOG, (leaf) => new DashboardView(leaf, this.plugin));
    // 保存设置页引用，语言切换时重新渲染
    this.plugin.settingTab = new TypeLogSettingTab(this.plugin.app, this.plugin);
    this.plugin.addSettingTab(this.plugin.settingTab);
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

  // 状态栏显示项变更后重建（功能 8）：先销毁再构建，避免 build() 防重入跳过
  rebuildStatusBar() {
    if (!this.plugin.settings.showStatusBar) return;
    this.statusBar.destroy();
    this.statusBar.build();
  }

  // 语言切换后立即生效：重建状态栏、统计面板，使文本按新语言显示
  applyLanguage() {
    // build() 有防重入保护，语言切换需先销毁再重建以更新文本
    if (this.plugin.settings.showStatusBar) {
      this.statusBar.destroy();
      this.statusBar.build();
    }
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYPELOG);
    for (const leaf of leaves) {
      (leaf.view as DashboardView).applyLanguage();
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
      new Notice(t("notice.windowDisabled"));
    }
  }

  // 打开侧边栏面板（聚焦已有，否则新建）
  openDashboard() {
    const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYPELOG)[0];
    if (existing) {
      this.plugin.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    const leaf = this.plugin.app.workspace.getRightLeaf(false);
    if (leaf) {
      void leaf.setViewState({ type: VIEW_TYPE_TYPELOG, active: true });
    }
  }

  destroy() {
    this.statusBar.destroy();
  }
}
