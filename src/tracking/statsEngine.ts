// 统计引擎：编辑器事件→解析→存储/速度/状态机→UI 刷新
import { MarkdownView, Vault, Workspace, TFile, EventRef } from "obsidian";
import type { TypeLogSettings } from "../core/settings";
import type { ChangeStats } from "../types";
import { StatsStore } from "../core/statsStore";
import { SessionStatsStore } from "../core/sessionStore";
import { ActiveStateMachine } from "../core/activeMachine";
import { SpeedTracker } from "../core/speedTracker";
import { EditorTracker } from "./editorTracker";
import { dateKey } from "../core/format";

// 统计 key 规范化：统一为 vault 相对路径（/ 分隔、去首尾 /）。
// 相对路径在 vault 内部唯一且稳定，vault 迁移/换机后文件统计仍可跨设备一致；
// 绝对路径只用于导出时展示（见 main.ts exportStats）
export function toStatsKey(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export interface StatsEngineDeps {
  workspace: Workspace;
  vault: Vault;
  getSettings: () => TypeLogSettings;
  store: StatsStore;
  session: SessionStatsStore;
  // 是否被排除（不计入统计）
  isExcluded: (path: string) => boolean;
  // UI 刷新回调（UI 端自行节流）
  onUiUpdate: () => void;
  // 番茄钟到期回调
  onPomodoroDue: () => void;
  // 每日目标达成回调（功能 5）
  onGoalDue: () => void;
}

export class StatsEngine {
  private editorTracker: EditorTracker;
  private activeMachine: ActiveStateMachine;
  private speedTracker = new SpeedTracker();
  private currentPath: string | null = null;
  private tickTimer: number | null = null;
  private pomodoroStartedAt = 0;
  private pomodoroNotified = false;
  // 番茄钟是否由用户手动启动（未启动时不计时）
  private pomodoroRunning = false;
  // 用户是否暂停（暂停期间不计时，已累计时长保留）
  private pomodoroPaused = false;
  // 已累计的计时时长（毫秒），暂停/继续时跨段累计
  private pomodoroElapsedMs = 0;
  private fileOpenRef: EventRef | null = null;
  private lastMinute = -1;
  // 目标达成通知：已通知的日期（功能 5，跨天重置，每天最多一次）
  private goalNotifiedDate = "";

  constructor(private deps: StatsEngineDeps) {
    const s = deps.getSettings();
    this.activeMachine = new ActiveStateMachine(s.idleThresholdSec * 1000);
    this.editorTracker = new EditorTracker(
      deps.workspace,
      deps.vault,
      () => ({
        includePasteInSpeed: this.deps.getSettings().includePasteInSpeed,
      }),
      {
        onChanges: this.handleChanges,
        onActivity: () => this.activeMachine.notifyActivity(Date.now()),
      },
    );
  }

  start() {
    this.activeMachine.start(Date.now());
    this.editorTracker.attach();
    this.fileOpenRef = this.deps.workspace.on("file-open", this.handleFileOpen, this);
    // 键盘/鼠标交互（非滚动）刷新活跃状态
    document.addEventListener("keydown", this.handleKeydown);
    document.addEventListener("mousedown", this.handleKeydown);
    this.tickTimer = window.setInterval(this.tick, 1000);
  }

  stop() {
    this.editorTracker.detach();
    if (this.fileOpenRef) this.deps.workspace.offref(this.fileOpenRef);
    this.fileOpenRef = null;
    document.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("mousedown", this.handleKeydown);
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // 前台文件是否为会话文件
  isForeground(): boolean {
    if (!this.currentPath) return false;
    const view = this.deps.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return false;
    return toStatsKey(view.file.path) === this.currentPath;
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }

  // 当前 CPM（60s 滑动窗口）
  getCpm(): number {
    return this.speedTracker.cpm(Date.now());
  }

  getWpm(): number {
    return this.speedTracker.wpm(Date.now());
  }

  getPeak(): number {
    return this.speedTracker.getPeak();
  }

  // 设置变更时更新阈值
  updateIdleThreshold(ms: number) {
    this.activeMachine.setIdleThresholdMs(ms);
  }

  // ---- 番茄钟手动控制 ----
  // 用户手动开始计时（返回是否成功启动）
  startPomodoro(now = Date.now()): boolean {
    if (!this.deps.getSettings().pomodoroEnabled) return false;
    this.pomodoroRunning = true;
    this.pomodoroPaused = false;
    this.pomodoroElapsedMs = 0;
    this.pomodoroStartedAt = now;
    this.pomodoroNotified = false;
    return true;
  }

  // 用户手动停止计时（完全复位）
  stopPomodoro() {
    this.pomodoroRunning = false;
    this.pomodoroPaused = false;
    this.pomodoroElapsedMs = 0;
    this.pomodoroStartedAt = 0;
    this.pomodoroNotified = false;
  }

  // 暂停：冻结计时，已累计时长保留（暂停期间即使闲置也不重置）
  pausePomodoro() {
    if (!this.pomodoroRunning || this.pomodoroPaused) return;
    if (this.pomodoroStartedAt > 0) {
      this.pomodoroElapsedMs += Date.now() - this.pomodoroStartedAt;
    }
    this.pomodoroStartedAt = 0;
    this.pomodoroPaused = true;
  }

  // 继续：恢复计时（基准时间在下一次计时 tick 时重新起算）
  resumePomodoro() {
    if (!this.pomodoroRunning || !this.pomodoroPaused) return;
    this.pomodoroPaused = false;
    this.pomodoroStartedAt = 0;
    this.pomodoroNotified = false;
  }

  isPomodoroRunning(): boolean {
    return this.pomodoroRunning;
  }

  isPomodoroPaused(): boolean {
    return this.pomodoroRunning && this.pomodoroPaused;
  }

  // 剩余毫秒（未启动返回 0；已启动但尚未进入计时阶段返回未计满部分）
  getPomodoroRemainingMs(now = Date.now()): number {
    if (!this.pomodoroRunning) return 0;
    const s = this.deps.getSettings();
    const total = s.pomodoroMinutes * 60_000;
    const elapsed = this.pomodoroElapsedMs + (this.pomodoroStartedAt > 0 ? now - this.pomodoroStartedAt : 0);
    return Math.max(0, total - elapsed);
  }

  // ---- 事件处理 ----
  private handleFileOpen = (file: TFile | null) => {
    if (!file) {
      this.currentPath = null;
      return;
    }
    if (this.deps.isExcluded(file.path)) {
      this.currentPath = null;
      return;
    }
    const key = toStatsKey(file.path);
    this.currentPath = key;
    const now = Date.now();
    // 重置状态机基准，避免上一文件残留状态污染新文件计时
    this.activeMachine.start(now);
    this.deps.store.touchOpen(key, now);
    const mode = this.deps.getSettings().countMode;
    // 优先同步取当前编辑器文本作为会话起点，避免“空文本 begin + 异步校准”与
    // 打开瞬间的编辑事件竞态导致净字数重复/漏计；编辑器未就绪时退回异步 cachedRead 兜底
    let initialText = "";
    let calibrated = false;
    try {
      const view = this.deps.workspace.getActiveViewOfType(MarkdownView);
      if (view && view.file === file) {
        initialText = view.editor.getValue();
        calibrated = true;
      }
    } catch {
      // 测试桩/极端环境无 workspace 能力，走异步兜底
      calibrated = false;
    }
    this.deps.session.begin(key, initialText, mode, now, {
      // 恢复当天该文件的历史分钟采样，曲线跨会话延续（关闭 Obsidian 前当天的数据不丢失）
      minuteSeries: this.deps.store.getDaySeries(key, dateKey(new Date(now))),
    });
    if (!calibrated) {
      // 捕获目标路径，回调时校验当前文件未切换，防止旧文件的校准结果覆盖新会话起点
      const target = key;
      void this.deps.vault.cachedRead(file).then((text) => {
        if (this.currentPath === target) {
          this.deps.session.setNetStartWords(text, mode);
        }
      });
    }
    // 重置分钟采样基准，避免切换文件后首分钟内无采样点
    this.lastMinute = Math.floor(now / 60_000);
    this.deps.onUiUpdate();
  };

  private handleKeydown = () => {
    // 任意键盘交互都刷新活跃状态
    this.activeMachine.notifyActivity(Date.now());
  };

  private handleChanges = (stats: ChangeStats) => {
    if (!this.currentPath) return;
    const now = Date.now();
    this.deps.session.applyChange(stats);
    this.deps.store.recordChange(this.currentPath, stats.typed, stats.deleted);
    this.speedTracker.addChars(stats.typedManual, now);
    this.deps.session.setPeak(this.speedTracker.getPeak());
    this.deps.store.recordPeak(this.speedTracker.getPeak(), now);
    this.activeMachine.notifyActivity(now);
    this.deps.onUiUpdate();
  };

  private tick = () => {
    const now = Date.now();
    // 有统计文件即视为前台（有交互就活跃）
    const res = this.activeMachine.tick(now, this.currentPath !== null);
    if (res.activeMs > 0 && this.currentPath) {
      this.deps.session.addActiveMs(res.activeMs);
      this.deps.store.recordActiveTime(this.currentPath, res.activeMs, new Date(now).getHours(), now);
    }
    // 分钟级采样（字数增长曲线）
    if (this.currentPath) {
      const minute = Math.floor(now / 60_000);
      if (minute !== this.lastMinute) {
        this.lastMinute = minute;
        this.deps.session.pushMinuteSample(now);
        // 持久化当天采样（每分钟一次，走防抖写盘），关闭 Obsidian 后重开可恢复曲线
        const s = this.deps.session.get();
        if (s) {
          const last = s.minuteSeries[s.minuteSeries.length - 1];
          if (last) this.deps.store.recordDaySample(this.currentPath, dateKey(new Date(now)), last);
        }
      }
    }
    // 番茄钟（用户手动启动后计时；real=纯计时，active=仅连续活跃时计时）
    if (this.pomodoroRunning) {
      const s = this.deps.getSettings();
      if (s.pomodoroEnabled) {
        // 暂停期间不计时，也不受闲置中断影响
        if (!this.pomodoroPaused) {
          const isReal = s.pomodoroMode === "real";
          // 纯计时不依赖活跃状态；活跃计时需前台文件且当前处于活跃
          const counting = isReal || (res.active && this.currentPath);
          if (counting) {
            // 基准时间缺失（初次计时，继续后，或曾被闲置中断重置）时重新起算
            if (this.pomodoroStartedAt === 0) {
              this.pomodoroStartedAt = now;
            }
            const elapsed = this.pomodoroElapsedMs + (now - this.pomodoroStartedAt);
            if (!this.pomodoroNotified && elapsed >= s.pomodoroMinutes * 60_000) {
              this.pomodoroNotified = true;
              this.deps.onPomodoroDue();
            }
          } else if (!res.active) {
            // 活跃模式下中断则重新累计
            this.pomodoroNotified = false;
            this.pomodoroElapsedMs = 0;
            this.pomodoroStartedAt = 0;
          }
        }
      }
    }
    // 每日目标达成通知（功能 5）：字数或时长目标首次达成且当天未通知过 → 触发回调（跨天重置）
    if (this.deps.getSettings().goalNotify) {
      const todayKey = dateKey(new Date());
      if (this.goalNotifiedDate !== todayKey) {
        const s = this.deps.getSettings();
        const g = this.deps.store.getGlobalStats();
        const wordDone = s.dailyWordGoal > 0 && (g.dailyGrossByDate[todayKey] ?? 0) >= s.dailyWordGoal;
        const timeDone = s.dailyTimeGoalMin > 0 && (g.dailyActiveByDate[todayKey] ?? 0) >= s.dailyTimeGoalMin * 60_000;
        if (wordDone || timeDone) {
          this.goalNotifiedDate = todayKey;
          this.deps.onGoalDue();
        }
      }
    }
    if (res.activeMs > 0 || this.currentPath || this.pomodoroRunning) {
      this.deps.onUiUpdate();
    }
  };
}
