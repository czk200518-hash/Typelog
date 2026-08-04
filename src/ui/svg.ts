// SVG 图表工具（零依赖）：折线图 + 热力图 + 进度环
// 全部通过 DOM API 构建，不使用 innerHTML
import { t } from "../core/i18n";

const SVG_NS = "http://www.w3.org/2000/svg";

let gradientSeq = 0;

// 创建 SVG 元素并附加属性（text 可选）
function svgEl(tag: string, attrs: Record<string, string> = {}, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  label?: string;
}

// 折线图：带刻度/网格线/峰值标注；svg 节点追加到 container
export function renderLineChart(container: HTMLElement, points: ChartPoint[], opts: LineChartOptions = {}): void {
  const width = opts.width ?? 320;
  const height = opts.height ?? 120;
  const padL = 36;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, xmlns: SVG_NS });

  if (points.length === 0) {
    svg.appendChild(svgEl("text", { x: String(width / 2), y: String(height / 2), "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "11" }, t("svg.noData")));
    container.appendChild(svg);
    return;
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

  // 渐变 defs（唯一 id，避免多图表冲突）
  gradientSeq += 1;
  const gradId = `typelog-area-${gradientSeq}`;
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "var(--interactive-accent)", "stop-opacity": "0.35" }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "var(--interactive-accent)", "stop-opacity": "0.02" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Y 轴网格线与刻度（4 档）
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round(minY + (rangeY * i) / yTicks);
    const y = mapY(minY + (rangeY * i) / yTicks);
    svg.appendChild(svgEl("line", { x1: String(padL), y1: y.toFixed(1), x2: String(width - padR), y2: y.toFixed(1), stroke: "var(--background-modifier-border)", "stroke-width": "1", "stroke-dasharray": "3,3" }));
    svg.appendChild(svgEl("text", { x: String(padL - 4), y: (y + 3).toFixed(1), "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" }, String(val)));
  }
  // Y 轴轴线
  svg.appendChild(svgEl("line", { x1: String(padL), y1: String(padT), x2: String(padL), y2: String(height - padB), stroke: "var(--background-modifier-border)", "stroke-width": "1" }));

  // X 轴刻度（分钟，4 档）
  const xTicks = 4;
  const maxIdx = points.length - 1;
  for (let i = 0; i <= xTicks; i++) {
    const idx = Math.round((maxIdx * i) / xTicks);
    const x = mapX(points[idx].x);
    svg.appendChild(svgEl("line", { x1: x.toFixed(1), y1: String(padT), x2: x.toFixed(1), y2: String(height - padB), stroke: "var(--background-modifier-border)", "stroke-width": "1", "stroke-dasharray": "3,3" }));
    svg.appendChild(svgEl("text", { x: x.toFixed(1), y: String(height - padB + 12), "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "8" }, t("svg.xMinute", { n: idx })));
  }
  // X 轴轴线
  svg.appendChild(svgEl("line", { x1: String(padL), y1: String(height - padB), x2: String(width - padR), y2: String(height - padB), stroke: "var(--background-modifier-border)", "stroke-width": "1" }));

  // 折线 / 面积 / 数据点 / 峰值标注
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${mapX(points[maxIdx].x).toFixed(1)},${height - padB} L${mapX(points[0].x).toFixed(1)},${height - padB} Z`;
  svg.appendChild(svgEl("path", { d: area, fill: `url(#${gradId})` }));
  svg.appendChild(svgEl("path", { d: line, fill: "none", stroke: "var(--interactive-accent)", "stroke-width": "1.8", "stroke-linejoin": "round", "stroke-linecap": "round" }));
  for (const p of points) {
    svg.appendChild(svgEl("circle", { cx: mapX(p.x).toFixed(1), cy: mapY(p.y).toFixed(1), r: "2", fill: "var(--interactive-accent)" }));
  }

  let maxVal = -Infinity;
  let maxAt = 0;
  points.forEach((p, i) => {
    if (p.y > maxVal) {
      maxVal = p.y;
      maxAt = i;
    }
  });
  svg.appendChild(svgEl("text", { x: mapX(points[maxAt].x).toFixed(1), y: (mapY(maxVal) - 6).toFixed(1), "text-anchor": "middle", fill: "var(--interactive-accent)", "font-size": "9", "font-weight": "700" }, String(Math.round(maxVal))));

  if (opts.label) svg.appendChild(svgEl("text", { x: String(padL), y: String(padT - 2), fill: "var(--text-muted)", "font-size": "9" }, opts.label));

  container.appendChild(svg);
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
  cellSize?: number;
  gap?: number;
}

// GitHub 贡献图风格热力图：列=星期（周一~周日），行=周，颜色深浅=活跃分钟数
export function renderHeatmap(container: HTMLElement, opts: HeatmapOptions): void {
  const cell = opts.cellSize ?? 10;
  const gap = opts.gap ?? 2;
  const rows = opts.cols.length; // 行数 = 周数
  const cols = 7; // 列数 = 星期数
  const padL = 10; // 左侧边距
  const padT = 16; // 顶部星期标签
  const width = padL + cols * (cell + gap) + gap;
  const height = padT + rows * (cell + gap) + gap;
  // 格子变大时同步放大标签字号
  const labelFont = cell >= 16 ? 11 : 8;

  // 固定 5 级绿色阶，任意主题下均有层次
  const color = (minutes: number): string => {
    if (minutes <= 0) return "var(--background-modifier-border)";
    if (minutes < 5) return "#d7f0e0";
    if (minutes < 15) return "#a6e2ba";
    if (minutes < 30) return "#5cc786";
    if (minutes < 45) return "#2ea85f";
    return "#1d8a49";
  };

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: String(width), height: String(height), xmlns: SVG_NS });

  // 顶部星期标签，与各列对齐
  const weekLabels = [t("svg.week1"), t("svg.week2"), t("svg.week3"), t("svg.week4"), t("svg.week5"), t("svg.week6"), t("svg.week7")];
  weekLabels.forEach((w, c) => {
    const x = padL + gap + c * (cell + gap) + cell / 2;
    svg.appendChild(svgEl("text", { x: String(x), y: String(padT - 4), "text-anchor": "middle", fill: "var(--text-muted)", "font-size": String(labelFont) }, w));
  });

  for (let r = 0; r < rows; r++) {
    const week = opts.cols[r];
    for (let c = 0; c < cols; c++) {
      const day = week?.[c];
      const x = padL + gap + c * (cell + gap);
      const y = padT + gap + r * (cell + gap);
      if (!day || !day.isCurrent) {
        svg.appendChild(svgEl("rect", { x: String(x), y: String(y), width: String(cell), height: String(cell), rx: "2", fill: "var(--background-modifier-border)", opacity: "0.25" }));
      } else {
        svg.appendChild(svgEl("rect", { x: String(x), y: String(y), width: String(cell), height: String(cell), rx: "2", fill: color(day.minutes) }));
      }
    }
  }

  container.appendChild(svg);
}

// 进度环增量更新句柄：仅更新进度弧/百分比文字/超 100% 配色，不重建节点
export interface RingProgressHandle {
  setProgress(ratio: number): void;
}

// 每日目标环形进度条（可超过 100%，文字显示实际百分比）
// 返回句柄供增量更新（不传则忽略，向后兼容）
export function renderRingProgress(container: HTMLElement, ratio: number, label: string, size = 72): RingProgressHandle {
  // 进度环画满即止，文字显示真实百分比（可超过 100%）
  const clamped = Math.max(0, Math.min(1, ratio));
  const over = ratio > 1;
  const r = (size - 10) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped);
  const pct = Math.round(ratio * 100);
  const stroke = over ? "var(--color-green)" : "var(--interactive-accent)";

  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, xmlns: SVG_NS });
  svg.appendChild(svgEl("circle", { cx: String(c), cy: String(c), r: String(r), fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": "6" }));
  const progressEl = svgEl("circle", { cx: String(c), cy: String(c), r: String(r), fill: "none", stroke, "stroke-width": "6", "stroke-linecap": "round", "stroke-dasharray": circumference.toFixed(1), "stroke-dashoffset": offset.toFixed(1), transform: `rotate(-90 ${c} ${c})` });
  svg.appendChild(progressEl);
  const pctEl = svgEl("text", { x: String(c), y: String(c - 2), "text-anchor": "middle", fill: "var(--text-normal)", "font-size": "14", "font-weight": "600" }, `${pct}%`);
  svg.appendChild(pctEl);
  svg.appendChild(svgEl("text", { x: String(c), y: String(c + 12), "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "8" }, label));

  container.appendChild(svg);

  return {
    setProgress(nextRatio: number) {
      const nextClamped = Math.max(0, Math.min(1, nextRatio));
      progressEl.setAttribute("stroke", nextRatio > 1 ? "var(--color-green)" : "var(--interactive-accent)");
      progressEl.setAttribute("stroke-dashoffset", (circumference * (1 - nextClamped)).toFixed(1));
      pctEl.textContent = `${Math.round(nextRatio * 100)}%`;
    },
  };
}
