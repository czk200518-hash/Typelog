// TypeLog 设置页
import { App, Notice, PluginSettingTab, Setting, setIcon, type SettingDefinitionItem, type SliderComponent, type TextComponent } from "obsidian";
import type TypeLogPlugin from "../main";
import { CountMode, PomodoroMode, STATUS_BAR_ITEM_IDS, UiLang, reorderStatusBarItems } from "../core/settings";
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

  // 渲染逻辑统一放入公开 refresh()；display() 仅由框架调用（实现抽象方法），
  // 语言切换等主动重渲染走 refresh()，避免直接调用被标记废弃的 display()
  display(): void {
    this.refresh();
  }

  refresh(): void {
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

    // 状态栏显示项（功能 8）：勾选启停 + 拖拽/按钮调整顺序
    new Setting(containerEl).setName(t("st.statusBarItems")).setHeading();
    containerEl.createDiv({ cls: "setting-item-description" }).setText(t("st.statusBarItemsDesc"));
    const sbList = containerEl.createDiv({ cls: "typelog-sb-items" });
    this.renderSbItemList(sbList);

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

    // ---- 周目标（功能 7）----
    new Setting(containerEl)
      .setName(t("st.weeklyWordGoal"))
      .setDesc(t("st.weeklyWordGoalDesc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.weeklyWordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.weeklyWordGoal = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("st.weeklyTimeGoal"))
      .setDesc(t("st.weeklyTimeGoalDesc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.weeklyTimeGoalMin)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.weeklyTimeGoalMin = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("st.goalNotify"))
      .setDesc(t("st.goalNotifyDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.goalNotify).onChange(async (v) => {
          this.plugin.settings.goalNotify = v;
          await this.plugin.saveSettings();
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

    new Setting(containerEl)
      .setName(t("st.backup"))
      .setDesc(t("st.backupDesc"))
      .addButton((b) =>
        b.setButtonText(t("st.backupBtn")).onClick(() => {
          void this.plugin
            .exportBackup()
            .then((p) => new Notice(t("notice.exportDone", { path: p })))
            .catch((e) => new Notice(t("notice.exportFail", { err: String(e) })));
        }),
      );

    new Setting(containerEl)
      .setName(t("st.import"))
      .setDesc(t("st.importDesc"))
      .addButton((b) =>
        b.setButtonText(t("st.importBtn")).onClick(() => this.plugin.openImportModal()),
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

  // ---- 状态栏显示项列表（功能 8）：开关 + 拖拽排序 + 上移/下移按钮兜底 ----
  // 遍历全量白名单 8 项：已配置项按数组顺序在前，未配置项自动补齐到数组末尾（默认禁用），保证全部可选
  private renderSbItemList(listEl: HTMLElement) {
    listEl.empty();
    let dragIdx = -1;
    const items = this.plugin.settings.statusBarItems;
    for (const id of STATUS_BAR_ITEM_IDS) {
      if (!items.some((i) => i.id === id)) items.push({ id, enabled: false });
    }
    items.forEach((item, idx) => {
      const row = new Setting(listEl);
      row.setName(t(`sbItem.${item.id}`));
      row.settingEl.addClass("typelog-sb-item");
      // 行容器可拖拽（HTML5 原生拖放 API，零依赖）
      row.settingEl.draggable = true;
      row.settingEl.addEventListener("dragstart", (e) => {
        dragIdx = idx;
        e.dataTransfer?.setData("text/plain", String(idx));
        row.settingEl.addClass("typelog-sb-item-dragging");
      });
      row.settingEl.addEventListener("dragend", () => {
        dragIdx = -1;
        row.settingEl.removeClass("typelog-sb-item-dragging");
      });
      row.settingEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.settingEl.addClass("typelog-sb-item-over");
      });
      row.settingEl.addEventListener("dragleave", () => row.settingEl.removeClass("typelog-sb-item-over"));
      row.settingEl.addEventListener("drop", (e) => {
        e.preventDefault();
        row.settingEl.removeClass("typelog-sb-item-over");
        const from = dragIdx >= 0 ? dragIdx : parseInt(e.dataTransfer?.getData("text/plain") ?? "-1", 10);
        if (from >= 0 && from !== idx) {
          this.reorderSbItem(from, idx);
          this.renderSbItemList(listEl);
        }
      });
      // 上移/下移兜底按钮（首项禁上移、末项禁下移）
      row.addExtraButton((b) => {
        b.setIcon("arrow-up").setTooltip(t("st.statusBarMoveUp")).setDisabled(idx === 0);
        b.onClick(() => {
          if (idx > 0) {
            this.reorderSbItem(idx, idx - 1);
            this.renderSbItemList(listEl);
          }
        });
      });
      row.addExtraButton((b) => {
        b.setIcon("arrow-down").setTooltip(t("st.statusBarMoveDown")).setDisabled(idx === items.length - 1);
        b.onClick(() => {
          if (idx < items.length - 1) {
            this.reorderSbItem(idx, idx + 1);
            this.renderSbItemList(listEl);
          }
        });
      });
      // 启停开关
      row.addToggle((tg) =>
        tg.setValue(item.enabled).onChange((v) => {
          item.enabled = v;
          void this.onSbItemsChanged();
        }),
      );
    });
  }

  // 重排显示项数组（拖拽/按钮共用纯函数），边界外忽略
  private reorderSbItem(from: number, to: number) {
    this.plugin.settings.statusBarItems = reorderStatusBarItems(this.plugin.settings.statusBarItems, from, to);
  }

  // 显示项变更后：保存设置 + 重建状态栏
  private async onSbItemsChanged() {
    await this.plugin.saveSettings();
    this.plugin.ui.rebuildStatusBar();
  }
}
