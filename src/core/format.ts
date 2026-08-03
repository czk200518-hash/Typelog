// 本地日期工具（本机时区）

export function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

// 日期键：YYYY-MM-DD
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 毫秒格式化，如 2小时 05分 或 45秒
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}小时${pad2(m)}分`;
  return `${m}分${pad2(totalSec % 60)}秒`;
}

// 分钟（可为小数）固定格式化为 "X分Y秒"，如 1分10秒、5分0秒、0分3秒
export function formatMinutesSeconds(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}分${s}秒`;
}

// 解析时长输入为分钟数（失败返回 null）：
// "25" / "1.5"（纯数字=分钟）、"1分30秒"、"1:30"、"5秒"
export function parseMinutesSeconds(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  // X分Y秒 / X:Y / X分
  const ms = s.match(/^(\d+)\s*(?:分|:)\s*(\d{1,2})?\s*秒?$/);
  if (ms) {
    const mm = parseInt(ms[1], 10);
    const ss = ms[2] !== undefined ? parseInt(ms[2], 10) : 0;
    if (ss > 59) return null;
    return mm + ss / 60;
  }
  // Y秒
  const sec = s.match(/^(\d{1,2})\s*秒$/);
  if (sec) return parseInt(sec[1], 10) / 60;
  return null;
}

// 千分位格式化
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("zh-CN");
}

// 默认导出文件名：typelog-YYYY-MM-DD-HHMMSS
export function defaultExportName(d = new Date()): string {
  return `typelog-${dateKey(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// 清洗为安全的文件名（去除路径分隔符与非法字符；可能返回空串，由调用方兜底）
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}
