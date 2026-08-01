// 统计引擎：编辑器事件→解析→存储/速度/状态机→UI 刷新
import { MarkdownView, Vault, Workspace, FileSystemAdapter, TFile, EventRef } from "obsidian";
import type { TypeLogSettings } from "../core/settings";
import type { ChangeStats } from "../types";
import { StatsStore } from "../core/statsStore";
import { SessionStatsStore } from "../core/sessionStore";
import { ActiveStateMachine } from "../core/activeMachine";
import { SpeedTracker } from "../core/speedTracker";
import { EditorTracker } from "./editorTracker";

// 相对路径转绝对路径（无 FileSystemAdapter 时退回相对路径）
export function toAbsolutePath(vault: Vault, relativePath: string): string {
  const adapter = vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const base = adapter.getBasePath();
    if (base) return `${base.replace(/\\/g, "/")}/${relativePath.replace(/\\/g, "/")}`;
  }
  return relativePath.replace(/\\/g, "/");
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
}

export class StatsEngine {
  private editorTracker: EditorTracker;
  private activeMachine: ActiveStateMachine;
  private speedTracker = new SpeedTracker();
  private currentPath: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pomodoroStartedAt = 0;
  private pomodoroNotified = false;
  private fileOpenRef: EventRef | null = null;
  private lastMinute = -1;

  constructor(private deps: StatsEngineDeps) {
    const s = deps.getSettings();
    this.activeMachine = new ActiveStateMachine(s.idleThresholdSec * 1000);
    this.editorTracker = new EditorTracker(
      deps.workspace,
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
    this.tickTimer = setInterval(this.tick, 1000);
  }

  stop() {
    this.editorTracker.detach();
    if (this.fileOpenRef) this.deps.workspace.offref(this.fileOpenRef);
    this.fileOpenRef = null;
    document.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("mousedown", this.handleKeydown);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // 前台文件是否为会话文件
  isForeground(): boolean {
    if (!this.currentPath) return false;
    const view = this.deps.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return false;
    return toAbsolutePath(this.deps.vault, view.file.path) === this.currentPath;
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
    const abs = toAbsolutePath(this.deps.vault, file.path);
    this.currentPath = abs;
    const now = Date.now();
    // 重置状态机基准，避免上一文件残留状态污染新文件计时
    this.activeMachine.start(now);
    this.deps.store.touchOpen(abs, now);
    const mode = this.deps.getSettings().countMode;
    this.deps.session.begin(abs, "", mode, now);
    // 异步读文本校准起点净字数
    void this.deps.vault.cachedRead(file).then((text) => {
      this.deps.session.setNetStartWords(text, mode);
    });
    this.pomodoroStartedAt = now;
    this.pomodoroNotified = false;
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
    this.deps.store.recordPeak(this.speedTracker.getPeak());
    this.activeMachine.notifyActivity(now);
    this.deps.onUiUpdate();
  };

  private tick = () => {
    const now = Date.now();
    // 有统计文件即视为前台（有交互就活跃）
    const res = this.activeMachine.tick(now, this.currentPath !== null);
    if (res.activeMs > 0 && this.currentPath) {
      this.deps.session.addActiveMs(res.activeMs);
      this.deps.store.recordActiveTime(this.currentPath, res.activeMs, new Date().getHours());
    }
    // 分钟级采样（字数增长曲线）
    if (this.currentPath) {
      const minute = Math.floor(now / 60_000);
      if (minute !== this.lastMinute) {
        this.lastMinute = minute;
        this.deps.session.pushMinuteSample(now);
      }
    }
    // 番茄钟（连续活跃）
    if (res.active && this.currentPath) {
      const s = this.deps.getSettings();
      if (s.pomodoroEnabled && !this.pomodoroNotified) {
        const since = now - (this.pomodoroStartedAt || now);
        if (since >= s.pomodoroMinutes * 60_000) {
          this.pomodoroNotified = true;
          this.deps.onPomodoroDue();
        }
      }
    } else if (!res.active) {
      // 中断则重新累计
      this.pomodoroNotified = false;
      this.pomodoroStartedAt = 0;
    }
    if (res.activeMs > 0 || this.currentPath) {
      this.deps.onUiUpdate();
    }
  };
}
