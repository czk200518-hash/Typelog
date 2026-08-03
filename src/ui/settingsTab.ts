// TypeLog 设置页
import { App, PluginSettingTab, Setting, setIcon, type SettingDefinitionItem, type SliderComponent, type TextComponent } from "obsidian";
import type TypeLogPlugin from "../main";
import { CountMode, PomodoroMode, WindowMode } from "../core/settings";
import { formatMinutesSeconds, parseMinutesSeconds } from "../core/format";
import { ExportStatsModal } from "./exportModal";

export class TypeLogSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TypeLogPlugin) {
    super(app, plugin);
  }

  // 使用自定义渲染display，此处保持空实现以兼容1.13.0+的设置搜索索引
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
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
    titles.createDiv({ cls: "typelog-settings-about-version" }).setText("v1.0.3");

    const features = about.createDiv({ cls: "typelog-settings-features" });
    const feature = (icon: string, title: string, desc: string) => {
      const f = features.createDiv({ cls: "typelog-settings-feature" });
      const ic = f.createDiv({ cls: "typelog-settings-feature-icon" });
      setIcon(ic, icon);
      const t = f.createDiv({ cls: "typelog-settings-feature-text" });
      t.createDiv({ cls: "typelog-settings-feature-title" }).setText(title);
      t.createDiv({ cls: "typelog-settings-feature-desc" }).setText(desc);
    };

    const tips = about.createDiv({ cls: "typelog-settings-tips" });
    tips.createDiv({ cls: "typelog-settings-tips-title" }).setText("tips");
    const tip = (t: string) => {
      const row = tips.createDiv({ cls: "typelog-settings-tip" });
//      setIcon(row.createSpan(), "arrow-right");
      row.createSpan().setText(t);
    };
    tip("点击左侧功能区图表图标，或命令面板执行「TypeLog: 打开统计窗口」");
    tip("点击状态栏任信息，查看当前文件详细统计情况");
    tip("统计数据存储在 vault 的 .typelog 目录与系统用户目录");

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

//    new Setting(containerEl)
//      .setName("统计窗口模式")
//      .setDesc("选择功能区图标与「打开统计窗口」命令打开的窗口类型")
//      .addDropdown((dd) =>
//        dd
//          .addOption("none", "不显示窗口（仅状态栏）")
//          .addOption("sidebar", "侧边栏面板")
//          .setValue(this.plugin.settings.windowMode === "floating" ? "sidebar" : this.plugin.settings.windowMode)
//          .onChange(async (v) => {
//            this.plugin.settings.windowMode = v as WindowMode;
//            await this.plugin.saveSettings();
//          }),
//      );

    // 悬浮窗
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
    let idleSlider: SliderComponent | undefined;
    let idleText: TextComponent | undefined;
    new Setting(containerEl)
      .setName("闲置判定时间（秒）")
      .setDesc("连续无编辑操作超过该时间，停止活跃计时，范围 1-120秒")
      .setClass("typelog-idle-threshold-setting")
      .addSlider((sl) => {
        idleSlider = sl;
        sl
          .setLimits(1, 120, 1)
          .setValue(this.plugin.settings.idleThresholdSec)
          .onChange(async (v) => {
            this.plugin.settings.idleThresholdSec = v;
            this.plugin.engine.updateIdleThreshold(v * 1000);
            await this.plugin.saveSettings();
            idleText?.setValue(String(v));
          });
      })
      .addText((text) => {
        idleText = text;
        text.inputEl.inputMode = "numeric";
        text.inputEl.addClass("typelog-idle-threshold");
        text
          .setValue(String(this.plugin.settings.idleThresholdSec))
          .setPlaceholder("秒")
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 1 && n <= 120) {
              this.plugin.settings.idleThresholdSec = n;
              this.plugin.engine.updateIdleThreshold(n * 1000);
              await this.plugin.saveSettings();
              idleSlider?.setValue(n);
            }
          });
      });

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
      .setDesc("手动启动，连续活跃编辑达到设定时长即发出提醒\n状态栏点击或命令“开始/停止番茄钟”触发")
      .setClass("typelog-desc-preline")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.pomodoroEnabled).onChange(async (v) => {
          this.plugin.settings.pomodoroEnabled = v;
          if (!v) this.plugin.engine.stopPomodoro();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("番茄钟时长")
      .setDesc("默认25分钟；输入格式：xx分xx秒，或直接输入分钟数；修改时长会重置当前番茄钟")
      .addText((text) =>
        text.setValue(formatMinutesSeconds(this.plugin.settings.pomodoroMinutes)).onChange(async (v) => {
          const n = parseMinutesSeconds(v);
          if (n !== null && n > 0) {
            this.plugin.settings.pomodoroMinutes = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("番茄钟计时方式")
      .setDesc("纯计时：启动后按真实时间计时，不依赖是否打字；\n活跃计时：仅在连续编辑活跃时计时，中途停顿超过闲置阈值则重新累计。")
      .setClass("typelog-desc-preline")
      .addDropdown((dd) =>
        dd
          .addOption("real", "纯计时")
          .addOption("active", "活跃计时")
          .setValue(this.plugin.settings.pomodoroMode)
          .onChange(async (v) => {
            this.plugin.settings.pomodoroMode = v as PomodoroMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("番茄钟控制")
      .setDesc("由你决定何时开始计时")
      .addButton((b) => {
        const updateText = () => {
          const e = this.plugin.engine;
          if (e.isPomodoroPaused()) {
            b.setButtonText("继续番茄钟");
          } else if (e.isPomodoroRunning()) {
            b.setButtonText("停止番茄钟");
          } else {
            b.setButtonText("开始番茄钟");
          }
        };
        updateText();
        b.onClick(() => {
          this.plugin.togglePomodoro();
          // 刷新按钮文案
          updateText();
        });
      });

    // ---- 数据管理 ----
    new Setting(containerEl)
      .setName("导出统计报表")
      .setDesc("可自定义导出格式、vault 内导出目录与文件名")
      .addButton((b) =>
        b.setButtonText("导出报表").setCta().onClick(() => new ExportStatsModal(this.app, this.plugin).open()),
      );

    new Setting(containerEl)
      .setName("重置当前文件会话统计")
      .setDesc("仅重置本次打开会话的统计，不影响历史累计数据（需两步确认）")
      .addButton((b) => {
        b.setButtonText("重置会话");
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.confirmResetSession());
      });

    new Setting(containerEl)
      .setName("硬重置（清除所有历史）")
      .setDesc("删除全部文件层/工程层/全局层统计历史，此操作不可撤销（需两步确认）")
      .addButton((b) => {
        b.setButtonText("清除所有历史");
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.confirmHardReset());
      });
  }
}
