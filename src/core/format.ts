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

// 千分位格式化
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("zh-CN");
}
