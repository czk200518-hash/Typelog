// SVG 图表工具（零依赖）：折线图 + 热力图 + 进度环

export interface ChartPoint {
  x: number;
  y: number;
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  label?: string;
}

// 折线图：带刻度/网格线/峰值标注
export function renderLineChart(points: ChartPoint[], opts: LineChartOptions = {}): string {
  const width = opts.width ?? 320;
  const height = opts.height ?? 120;
  const padL = 36;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  if (points.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="11">暂无数据</text></svg>`;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX === minX) maxX = minX + 1;
  if (maxY === minY) maxY = minY + 1;
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const mapX = (x: number) => padL + ((x - minX) / rangeX) * plotW;
  const mapY = (y: number) => padT + (1 - (y - minY) / rangeY) * plotH;

  // ---- Y 轴网格线与刻度（4 档） ----
  const yTicks = 4;
  let grid = "";
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round(minY + (rangeY * i) / yTicks);
    const y = mapY(minY + (rangeY * i) / yTicks);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
    grid += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="8">${val}</text>`;
  }
  // Y 轴轴线
  grid += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

  // ---- X 轴刻度（分钟，4 档） ----
  const xTicks = 4;
  const maxIdx = points.length - 1;
  for (let i = 0; i <= xTicks; i++) {
    const idx = Math.round((maxIdx * i) / xTicks);
    const x = mapX(points[idx].x);
    grid += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${height - padB}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
    grid += `<text x="${x.toFixed(1)}" y="${height - padB + 12}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${idx}分</text>`;
  }
  // X 轴轴线
  grid += `<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

  // ---- 折线 / 面积 / 数据点 / 峰值标注 ----
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${mapX(points[maxIdx].x).toFixed(1)},${height - padB} L${mapX(points[0].x).toFixed(1)},${height - padB} Z`;
  const dots = points
    .map((p) => `<circle cx="${mapX(p.x).toFixed(1)}" cy="${mapY(p.y).toFixed(1)}" r="2" fill="var(--interactive-accent)"/>`)
    .join("");

  let maxVal = -Infinity;
  let maxAt = 0;
  points.forEach((p, i) => {
    if (p.y > maxVal) {
      maxVal = p.y;
      maxAt = i;
    }
  });
  const peakLabel = `<text x="${mapX(points[maxAt].x).toFixed(1)}" y="${(mapY(maxVal) - 6).toFixed(1)}" text-anchor="middle" fill="var(--interactive-accent)" font-size="9" font-weight="700">${Math.round(maxVal)}</text>`;

  const label = opts.label ? `<text x="${padL}" y="${padT - 2}" fill="var(--text-muted)" font-size="9">${opts.label}</text>` : "";
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="typelog-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--interactive-accent)" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="var(--interactive-accent)" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${label}
  ${grid}
  <path d="${area}" fill="url(#typelog-area)"/>
  <path d="${line}" fill="none" stroke="var(--interactive-accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${peakLabel}
</svg>`;
}

// 热力图单元：某天的活跃分钟数
export interface HeatmapDay {
  minutes: number;
  // 是否当月（跨月空白格灰显）
  isCurrent: boolean;
}

export interface HeatmapOptions {
  // 每列（周）7 个单元，行序：周一 ~ 周日
  cols: HeatmapDay[][];
  // 月份标签，如 "2026年8月"
  monthLabel: string;
  cellSize?: number;
  gap?: number;
}

// GitHub 贡献图风格热力图：列=周，行=星期，颜色深浅=活跃分钟数
export function renderHeatmap(opts: HeatmapOptions): string {
  const cell = opts.cellSize ?? 10;
  const gap = opts.gap ?? 2;
  const rows = 7;
  const cols = opts.cols.length;
  const padL = 26; // 左侧星期标签
  const padT = 16; // 顶部月份
  const width = padL + cols * (cell + gap) + gap;
  const height = padT + rows * (cell + gap) + gap;
  // 格子变大时同步放大标签字号
  const labelFont = cell >= 16 ? 11 : 8;
  const monthFont = cell >= 16 ? 12 : 9;

  // 固定 5 级绿色阶，任意主题下均有层次
  const color = (minutes: number): string => {
    if (minutes <= 0) return "var(--background-modifier-border)";
    if (minutes < 5) return "#d7f0e0";
    if (minutes < 15) return "#a6e2ba";
    if (minutes < 30) return "#5cc786";
    if (minutes < 45) return "#2ea85f";
    return "#1d8a49";
  };

  let cells = "";
  for (let c = 0; c < cols; c++) {
    const col = opts.cols[c];
    for (let r = 0; r < rows; r++) {
      const day = col[r];
      const x = padL + gap + c * (cell + gap);
      const y = padT + gap + r * (cell + gap);
      if (!day || !day.isCurrent) {
        cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="var(--background-modifier-border)" opacity="0.25"/>`;
        continue;
      }
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${color(day.minutes)}"/>`;
    }
  }

  // 左侧星期标签（周一 / 周三 / 周五）
  const weekLabels = ["一", "", "三", "", "五", "", ""];
  let labels = "";
  weekLabels.forEach((w, r) => {
    if (!w) return;
    const y = padT + gap + r * (cell + gap) + cell / 2 + 4;
    labels += `<text x="${padL - 6}" y="${y}" text-anchor="end" fill="var(--text-muted)" font-size="${labelFont}">${w}</text>`;
  });

  // 顶部月份标签
  const monthLabel = `<text x="${padL}" y="${padT - 4}" fill="var(--text-muted)" font-size="${monthFont}">${opts.monthLabel}</text>`;

  // 显式固定尺寸
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${monthLabel}${labels}${cells}</svg>`;
}

// 每日目标环形进度条（可超过 100%，文字显示实际百分比）
export function renderRingProgress(ratio: number, label: string, size = 72): string {
  // 进度环画满即止，文字显示真实百分比（可超过 100%）
  const clamped = Math.max(0, Math.min(1, ratio));
  const over = ratio > 1;
  const r = (size - 10) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped);
  const pct = Math.round(ratio * 100);
  const stroke = over ? "var(--color-green)" : "var(--interactive-accent)";
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--background-modifier-border)" stroke-width="6"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stroke}" stroke-width="6"
    stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
    transform="rotate(-90 ${c} ${c})"/>
  <text x="${c}" y="${c - 2}" text-anchor="middle" fill="var(--text-normal)" font-size="14" font-weight="600">${pct}%</text>
  <text x="${c}" y="${c + 12}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${label}</text>
</svg>`;
}
