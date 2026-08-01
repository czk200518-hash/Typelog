// 会话级统计缓存：本次打开期间的净字数起点、净变化、累计输入、删除、活跃时长、峰值速度
import type { ChangeStats, SessionStats } from "../types";
import type { CountMode } from "./settings";
import { countText } from "./counter";

// 分钟级采样点（字数增长曲线）
export interface MinuteSample {
  t: number;
  // 累计净变化
  delta: number;
  // 累计累计输入
  gross: number;
}

export class SessionStatsStore {
  private current: SessionStats | null = null;

  // 开始一个文件会话
  begin(path: string, currentText: string, mode: CountMode, now: number) {
    this.current = {
      path,
      openedAt: now,
      netStartWords: countText(currentText, mode),
      deltaWords: 0,
      grossTyped: 0,
      deletedChars: 0,
      activeTimeMs: 0,
      peakSpeed: 0,
      minuteSeries: [],
    };
  }

  // 追加分钟级采样
  pushMinuteSample(t: number) {
    if (this.current) {
      this.current.minuteSeries.push({ t, delta: this.current.deltaWords, gross: this.current.grossTyped });
    }
  }

  // 校准起点净字数（异步读文件后调用）
  setNetStartWords(currentText: string, mode: CountMode) {
    if (this.current) this.current.netStartWords = countText(currentText, mode);
  }

  applyChange(change: ChangeStats) {
    if (!this.current) return;
    this.current.deltaWords += change.net;
    this.current.grossTyped += change.typed;
    this.current.deletedChars += change.deleted;
  }

  addActiveMs(ms: number) {
    if (this.current) this.current.activeTimeMs += ms;
  }

  // 峰值 CPM
  setPeak(cpm: number) {
    if (this.current && cpm > this.current.peakSpeed) this.current.peakSpeed = cpm;
  }

  get(): SessionStats | null {
    return this.current;
  }

  // 取出快照并结束会话
  end(): SessionStats | null {
    const s = this.current;
    this.current = null;
    return s;
  }
}
