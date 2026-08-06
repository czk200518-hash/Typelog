// 会话级统计缓存：本次打开期间的净字数起点、净变化、累计输入、删除、活跃时长、峰值速度
import type { ChangeStats, MinuteSample, SessionStats } from "../types";
import type { CountMode } from "./settings";
import { countText } from "./counter";

export type { MinuteSample };

// 分钟采样保留上限（24 小时），防止超长会话内存无界增长
const MAX_MINUTE_SAMPLES = 1440;

export class SessionStatsStore {
  private current: SessionStats | null = null;
  // 恢复当天历史曲线时的累计基准偏移（历史最后采样点），新会话采样在其上累加，曲线连续
  private deltaOffset = 0;
  private grossOffset = 0;

  // 开始一个文件会话；opts.minuteSeries 传入当天历史采样（曲线跨会话恢复）
  begin(path: string, currentText: string, mode: CountMode, now: number, opts: { minuteSeries?: MinuteSample[] } = {}) {
    const hist = opts.minuteSeries ?? [];
    const last = hist.length > 0 ? hist[hist.length - 1] : undefined;
    this.deltaOffset = last ? last.delta : 0;
    this.grossOffset = last ? last.gross : 0;
    this.current = {
      path,
      openedAt: now,
      netStartWords: countText(currentText, mode),
      deltaWords: 0,
      grossTyped: 0,
      deletedChars: 0,
      activeTimeMs: 0,
      peakSpeed: 0,
      minuteSeries: [...hist],
    };
  }

  // 追加分钟级采样（超上限时淘汰最旧，内存有界）；delta/gross 为当天累计口径（含历史偏移）
  pushMinuteSample(t: number) {
    if (this.current) {
      const series = this.current.minuteSeries;
      if (series.length >= MAX_MINUTE_SAMPLES) series.shift();
      series.push({ t, delta: this.deltaOffset + this.current.deltaWords, gross: this.grossOffset + this.current.grossTyped });
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
