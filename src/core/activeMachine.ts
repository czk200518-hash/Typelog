// 活跃/闲置状态机：编辑交互刷新最近活动时间，
// 每秒心跳判断该秒是活跃还是闲置
import type { TickResult } from "../types";

export class ActiveStateMachine {
  private lastActivityAt = 0;
  private startedAt = 0;
  private activeMs = 0;
  private idleThresholdMs: number;

  constructor(idleThresholdMs: number) {
    this.idleThresholdMs = idleThresholdMs;
  }

  // 设置变更时更新阈值
  setIdleThresholdMs(ms: number) {
    this.idleThresholdMs = ms;
  }

  start(now: number) {
    this.startedAt = now;
    this.lastActivityAt = now;
    this.activeMs = 0;
  }

  // 刷新最近活动时间
  notifyActivity(now: number) {
    this.lastActivityAt = now;
  }

  isActiveNow(now: number): boolean {
    return now - this.lastActivityAt <= this.idleThresholdMs;
  }

  // 每秒心跳；后台文件不计活跃
  tick(now: number, isForeground: boolean): TickResult {
    if (isForeground && this.isActiveNow(now)) {
      this.activeMs += 1000;
      return { active: true, activeMs: 1000, idleMs: 0 };
    }
    return { active: false, activeMs: 0, idleMs: 1000 };
  }

  getActiveMs(): number {
    return this.activeMs;
  }

  getSessionSpanMs(now: number): number {
    return now - this.startedAt;
  }

  // 闲置 = 会话跨度 - 活跃
  getIdleMs(now: number): number {
    return Math.max(0, this.getSessionSpanMs(now) - this.activeMs);
  }
}
