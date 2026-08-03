// TypeLog 设置页
import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type TypeLogPlugin from "../main";
import { CountMode, WindowMode } from "../core/settings";
import { HardResetModal } from "./hardResetModal";

export class TypeLogSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ---- 关于 / 功能描述 ----
    const about = containerEl.createDiv({ cls: "typelog-settings-about" });
    const head = about.createDiv({ cls: "typelog-settings-about-head" });
    const logo = head.createDiv({ cls: "typelog-settings-about-logo" });
    setIcon(logo, "bar-chart-2");
    const titles = head.createDiv({ cls: "typelog-settings-about-titles" });
    titles.createDiv({ text: "TypeLog 字迹", cls: "typelog-settings-about-name" });
    titles.createDiv({ cls: "typelog-settings-about-version" }).setText("v1.0.0 · 双轨统计制打字统计插件");

    about.createEl("p", {
      text: "精准记录你的每一次敲击。区分「净产出」与「总劳动量」，自动识别编辑态与挂机态，所有数据仅存本地。",
      cls: "typelog-settings-about-desc",
    });

    const features = about.createDiv({ cls: "typelog-settings-features" });
    const feature = (icon: string, title: string, desc: string) => {
      const f = features.createDiv({ cls: "typelog-settings-feature" });
      const ic = f.createDiv({ cls: "typelog-settings-feature-icon" });
      setIcon(ic, icon);
      const t = f.createDiv({ cls: "typelog-settings-feature-text" });
      t.createDiv({ cls: "typelog-settings-feature-title" }).setText(title);
      t.createDiv({ cls: "typelog-settings-feature-desc" }).setText(desc);
    };
    feature("git-compare", "双轨统计", "净字数衡量产出，累计字数记录键盘真实劳动量（含删除/替换）");
    feature("activity", "时间状态", "5 秒无操作自动暂停计时，精准统计活跃编辑时长与闲置时间");
    feature("chart-line", "速度与热力图", "60 秒滑动窗口实时速度、峰值速度、分钟级增长曲线与 24 小时打字热力图");
    feature("database", "三层本地存储", "文件层 / 工程层 / 全局层三级，支持 JSON / CSV 导出，数据仅保存在本地");

    const tips = about.createDiv({ cls: "typelog-settings-tips" });
    tips.createDiv({ cls: "typelog-settings-tips-title" }).setText("快速上手");
    const tip = (t: string) => {
      const row = tips.createDiv({ cls: "typelog-settings-tip" });
      setIcon(row.createSpan(), "arrow-right");
      row.createSpan().setText(t);
    };
    tip("点击左侧功能区图表图标，或命令面板执行「TypeLog: 打开统计窗口」");
    tip("点击状态栏任意数值，查看当前文件详细统计卡片");
    tip("统计数据存储在 vault 的 .typelog 目录与系统用户目录（全局数据）");

    // ---- 显示设置 ----
    new Setting(containerEl).setName("显示设置").setHeading();

    new Setting(containerEl)
      .setName("状态栏显示统计")
      .setDesc("在左下角状态栏显示实时统计（当前速度 | 净字数 | 今日总输入）")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showStatusBar).onChange(async (v) => {
          this.plugin.settings.showStatusBar = v;
          this.plugin.ui.applyDisplayModes();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("统计窗口模式")
      .setDesc("选择功能区图标与「打开统计窗口」命令打开的窗口类型")
      .addDropdown((dd) =>
        dd
          .addOption("none", "不显示窗口（仅状态栏）")
          .addOption("sidebar", "侧边栏面板")
          .setValue(this.plugin.settings.windowMode === "floating" ? "sidebar" : this.plugin.settings.windowMode)
          .onChange(async (v) => {
            this.plugin.settings.windowMode = v as WindowMode;
            await this.plugin.saveSettings();
          }),
      );

    // 悬浮窗暂时隐藏（开发中）
    // new Setting(containerEl)
    //   .setName("悬浮窗保持最前")
    //   .setDesc("开启后悬浮窗失焦时自动拉回最前（仅悬浮窗模式生效）；如干扰其他操作可关闭")
    //   .addToggle((tg) =>
    //     tg.setValue(this.plugin.settings.popoutAlwaysOnTop).onChange(async (v) => {
    //       this.plugin.settings.popoutAlwaysOnTop = v;
    //       await this.plugin.saveSettings();
    //     }),
    //   );

    // 统计设置
    new Setting(containerEl).setName("统计设置").setHeading();

    // 计数
    new Setting(containerEl)
      .setName("字数计数模式")
      .setDesc("严格：仅统计汉字与英文单词；宽松：统计所有可见字符（含符号）")
      .addDropdown((dd) =>
        dd
          .addOption("strict", "严格模式")
          .addOption("loose", "宽松模式")
          .setValue(this.plugin.settings.countMode)
          .onChange(async (v) => {
            this.plugin.settings.countMode = v as CountMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("粘贴计入打字速度")
      .setDesc("开启后，粘贴/拖拽导入的大段文本将计入当前打字速度（建议关闭，避免速度虚高）")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.includePasteInSpeed).onChange(async (v) => {
          this.plugin.settings.includePasteInSpeed = v;
          await this.plugin.saveSettings();
        }),
      );

    // ---- 时间 ----
    new Setting(containerEl)
      .setName("闲置判定时间（秒）")
      .setDesc("连续无编辑操作超过该时间，停止活跃计时（默认 5 秒）")
      .addSlider((sl) =>
        sl
          .setLimits(1, 120, 1)
          .setValue(this.plugin.settings.idleThresholdSec)
          .onChange(async (v) => {
            this.plugin.settings.idleThresholdSec = v;
            this.plugin.engine.updateIdleThreshold(v * 1000);
            await this.plugin.saveSettings();
          }),
      );

    // ---- 排除规则 ----
    new Setting(containerEl)
      .setName("排除文件/文件夹")
      .setDesc("支持 .ignore 语法：* ? ** 通配符，! 反向排除，每行一条（如 node_modules、*.min.js）")
      .addTextArea((text) => {
        text.inputEl.addClass("typelog-settings-exclude");
        text.setValue(this.plugin.settings.excludePatterns.join("\n"));
        text.onChange(async (v) => {
          this.plugin.settings.excludePatterns = v
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s);
          await this.plugin.saveSettings();
        });
      });

    // ---- 每日目标 ----
    new Setting(containerEl)
      .setName("今日目标字数")
      .setDesc("面板中以环形进度条显示（0 表示不启用）")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.dailyWordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.dailyWordGoal = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("今日目标时长（分钟）")
      .setDesc("0 表示不启用")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.dailyTimeGoalMin)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.dailyTimeGoalMin = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    // ---- 番茄钟 ----
    new Setting(containerEl)
      .setName("番茄钟提醒")
      .setDesc("连续活跃编辑达到设定时长后，状态栏弹窗提醒休息")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.pomodoroEnabled).onChange(async (v) => {
          this.plugin.settings.pomodoroEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("番茄钟时长（分钟）")
      .setDesc("默认 25 分钟")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.pomodoroMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.pomodoroMinutes = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    // ---- 数据管理 ----
    new Setting(containerEl)
      .setName("导出统计报表")
      .setDesc("导出 JSON 或 CSV 格式的统计数据文件到当前 vault")
      .addButton((b) =>
        b.setButtonText("导出 JSON").onClick(() => this.plugin.exportStats("json")),
      )
      .addButton((b) =>
        b.setButtonText("导出 CSV").onClick(() => this.plugin.exportStats("csv")),
      );

    new Setting(containerEl)
      .setName("重置当前文件会话统计")
      .setDesc("仅重置本次打开会话的统计，不影响历史累计数据")
      .addButton((b) => {
        b.setButtonText("重置会话");
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.resetSession());
      });

    new Setting(containerEl)
      .setName("硬重置（清除所有历史）")
      .setDesc("删除全部文件层/工程层/全局层统计历史，此操作不可撤销")
      .addButton((b) => {
        b.setButtonText("清除所有历史");
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.confirmHardReset());
      });
  }

  private confirmHardReset() {
    new HardResetModal(this.app, this.plugin).open();
  }
}
