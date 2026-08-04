// TypeLog 设置页
import { App, PluginSettingTab, Setting, setIcon, type SettingDefinitionItem, type SliderComponent, type TextComponent } from "obsidian";
import type TypeLogPlugin from "../main";
import { CountMode, PomodoroMode, UiLang } from "../core/settings";
import { formatMinutesSeconds, parseMinutesSeconds } from "../core/format";
import { t } from "../core/i18n";
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
    titles.createDiv({ text: t("brand.name"), cls: "typelog-settings-about-name" });
    titles.createDiv({ cls: "typelog-settings-about-version" }).setText(`v${this.plugin.manifest.version}`);

    const tips = about.createDiv({ cls: "typelog-settings-tips" });
    tips.createDiv({ cls: "typelog-settings-tips-title" }).setText("tips");
    const tip = (tText: string) => {
      const row = tips.createDiv({ cls: "typelog-settings-tip" });
//      setIcon(row.createSpan(), "arrow-right");
      row.createSpan().setText(tText);
    };
    tip(t("st.tip1"));
    tip(t("st.tip2"));
    tip(t("st.tip3"));

    // ---- 语言 ----
    new Setting(containerEl)
      .setName(t("st.language"))
      .setDesc(t("st.languageDesc"))
      .addDropdown((dd) =>
        dd
          .addOption("zh", t("st.langZh"))
          .addOption("en", t("st.langEn"))
          .setValue(this.plugin.settings.language)
          .onChange((v) => void this.plugin.setLanguage(v as UiLang)),
      );

    // ---- 显示设置 ----
    new Setting(containerEl).setName(t("st.displayHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("st.showStatusBar"))
      .setDesc(t("st.showStatusBarDesc"))
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
    new Setting(containerEl).setName(t("st.statsHeading")).setHeading();

    // 计数
    new Setting(containerEl)
      .setName(t("st.countMode"))
      .setDesc(t("st.countModeDesc"))
      .addDropdown((dd) =>
        dd
          .addOption("strict", t("st.countStrict"))
          .addOption("loose", t("st.countLoose"))
          .setValue(this.plugin.settings.countMode)
          .onChange(async (v) => {
            this.plugin.settings.countMode = v as CountMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("st.includePaste"))
      .setDesc(t("st.includePasteDesc"))
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
      .setName(t("st.idleThreshold"))
      .setDesc(t("st.idleThresholdDesc"))
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
          .setPlaceholder("s")
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
      .setName(t("st.exclude"))
      .setDesc(t("st.excludeDesc"))
      .addTextArea((text) => {
        text.inputEl.addClass("typelog-settings-exclude");
        text.setValue(this.plugin.settings.excludePatterns.join("\n"));
        text.onChange(async (v) => {
          this.plugin.settings.excludePatterns = v
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s);
          this.plugin.refreshExcludePatterns();
          await this.plugin.saveSettings();
        });
      });

    // ---- 每日目标 ----
    new Setting(containerEl)
      .setName(t("st.dailyWordGoal"))
      .setDesc(t("st.dailyWordGoalDesc"))
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
      .setName(t("st.dailyTimeGoal"))
      .setDesc(t("st.dailyTimeGoalDesc"))
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
      .setName(t("st.pomodoroEnabled"))
      .setDesc(t("st.pomodoroEnabledDesc"))
      .setClass("typelog-desc-preline")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.pomodoroEnabled).onChange(async (v) => {
          this.plugin.settings.pomodoroEnabled = v;
          if (!v) this.plugin.engine.stopPomodoro();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("st.pomodoroMinutes"))
      .setDesc(t("st.pomodoroMinutesDesc"))
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
      .setName(t("st.pomodoroMode"))
      .setDesc(t("st.pomodoroModeDesc"))
      .setClass("typelog-desc-preline")
      .addDropdown((dd) =>
        dd
          .addOption("real", t("st.pomoModeReal"))
          .addOption("active", t("st.pomoModeActive"))
          .setValue(this.plugin.settings.pomodoroMode)
          .onChange(async (v) => {
            this.plugin.settings.pomodoroMode = v as PomodoroMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("st.pomodoroControl"))
      .setDesc(t("st.pomodoroControlDesc"))
      .addButton((b) => {
        const updateText = () => {
          const e = this.plugin.engine;
          if (e.isPomodoroPaused()) {
            b.setButtonText(t("st.pomoResume"));
          } else if (e.isPomodoroRunning()) {
            b.setButtonText(t("st.pomoStop"));
          } else {
            b.setButtonText(t("st.pomoStart"));
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
      .setName(t("st.export"))
      .setDesc(t("st.exportDesc"))
      .addButton((b) =>
        b.setButtonText(t("st.exportBtn")).setCta().onClick(() => new ExportStatsModal(this.app, this.plugin).open()),
      );

    // ---- 数据老化清理 ----
    new Setting(containerEl)
      .setName(t("st.purgeHeading"))
      .setHeading()
      .setDesc(t("st.purgeHeadingDesc"));

    new Setting(containerEl)
      .setName(t("st.purgeInactive"))
      .setDesc(t("st.purgeInactiveDesc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.purgeInactiveDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.purgeInactiveDays = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("st.purgeDaily"))
      .setDesc(t("st.purgeDailyDesc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.dailyRetentionDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.dailyRetentionDays = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("st.purgeNow"))
      .setDesc(t("st.purgeNowDesc"))
      .addButton((b) => {
        b.setButtonText(t("st.purgeBtn"));
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.confirmPurgeData());
      });

    new Setting(containerEl)
      .setName(t("st.resetSession"))
      .setDesc(t("st.resetSessionDesc"))
      .addButton((b) => {
        b.setButtonText(t("st.resetSessionBtn"));
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.confirmResetSession());
      });

    new Setting(containerEl)
      .setName(t("st.hardReset"))
      .setDesc(t("st.hardResetDesc"))
      .addButton((b) => {
        b.setButtonText(t("st.hardResetBtn"));
        b.buttonEl.addClass("typelog-btn-danger");
        b.onClick(() => this.plugin.confirmHardReset());
      });
  }
}
