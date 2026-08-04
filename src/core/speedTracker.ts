// 打字速度：CPM=60s 滑动窗口字符数/分钟；WPM=CPM/5；峰值=10s 窗口最高
// 采用双窗口累计计数器：查询/峰值均为 O(1)，不再每次全量扫描事件队列
export class SpeedTracker {
  // 滑动窗口 ms
  private windowMs = 60_000;
  // 峰值窗口 ms
  private peakWindowMs = 10_000;
  // 击键事件队列（60s 与 10s 窗口共享同一事件对象，各自独立淘汰）
  private windowEvents: { t: number; chars: number }[] = [];
  private peakEvents: { t: number; chars: number }[] = [];
  // 各窗口内字符累计
  private windowChars = 0;
  private peakChars = 0;
  // 历史峰值 CPM
  private peak = 0;

  // 记录一次键入（逐字键盘字符数，粘贴默认不计入）
  addChars(count: number, now: number) {
    if (count <= 0) return;
    const evt = { t: now, chars: count };
    this.windowEvents.push(evt);
    this.peakEvents.push(evt);
    this.windowChars += count;
    this.peakChars += count;
    this.prune(now);
    // 更新 10s 峰值
    if (this.peakChars > this.peak) this.peak = this.peakChars;
  }

  // 会话重置时清空
  reset() {
    this.windowEvents = [];
    this.peakEvents = [];
    this.windowChars = 0;
    this.peakChars = 0;
    this.peak = 0;
  }

  // 惰性淘汰：查询时按当前时间移除两个窗口外的旧事件（保证时间流逝后窗口正确衰减）
  private prune(now: number) {
    const cutoff60 = now - this.windowMs;
    while (this.windowEvents.length > 0 && this.windowEvents[0].t < cutoff60) {
      this.windowChars -= this.windowEvents.shift()!.chars;
    }
    const cutoff10 = now - this.peakWindowMs;
    while (this.peakEvents.length > 0 && this.peakEvents[0].t < cutoff10) {
      this.peakChars -= this.peakEvents.shift()!.chars;
    }
  }

  cpm(now: number): number {
    this.prune(now);
    return this.windowChars;
  }

  wpm(now: number): number {
    return this.cpm(now) / 5;
  }

  getPeak(): number {
    return this.peak;
  }
}
