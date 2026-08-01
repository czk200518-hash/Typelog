// 打字速度：CPM=60s 滑动窗口字符数/分钟；WPM=CPM/5；峰值=10s 窗口最高
export class SpeedTracker {
  // 滑动窗口 ms
  private windowMs = 60_000;
  // 峰值窗口 ms
  private peakWindowMs = 10_000;
  // 击键事件队列 [{t, chars}]
  private events: { t: number; chars: number }[] = [];
  // 历史峰值 CPM
  private peak = 0;

  // 记录一次键入（逐字键盘字符数，粘贴默认不计入）
  addChars(count: number, now: number) {
    if (count <= 0) return;
    this.events.push({ t: now, chars: count });
    this.prune(now, this.windowMs);
    // 更新 10s 峰值
    const peakCpm = this.cpmOfWindow(now, this.peakWindowMs);
    if (peakCpm > this.peak) this.peak = peakCpm;
  }

  // 会话重置时清空
  reset() {
    this.events = [];
    this.peak = 0;
  }

  private prune(now: number, windowMs: number) {
    const cutoff = now - windowMs;
    while (this.events.length > 0 && this.events[0].t < cutoff) {
      this.events.shift();
    }
  }

  private cpmOfWindow(now: number, windowMs: number): number {
    const cutoff = now - windowMs;
    let chars = 0;
    for (const e of this.events) {
      if (e.t >= cutoff) chars += e.chars;
    }
    return chars;
  }

  cpm(now: number): number {
    return this.cpmOfWindow(now, this.windowMs);
  }

  wpm(now: number): number {
    return this.cpm(now) / 5;
  }

  getPeak(): number {
    return this.peak;
  }
}
