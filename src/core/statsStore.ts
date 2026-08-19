// 三层数据存储：文件层/工程层/全局层，防抖 + 最小间隔写盘，原子写（tmp+rename）
import type { FileStats, FileStatsStoreData, GlobalStats, HeatmapDaySlots, MinuteSample, ProjectStatsData } from "../types";
import { dateKey } from "./format";

// 防抖窗口：合并连续高频事件（击键等）
const FLUSH_DEBOUNCE_MS = 200;
// 最小落盘间隔：慢速打字（击键间隔 >200ms）时也封顶写盘频率，避免每次击键全量写盘；
// 数据安全由 onunload/导出前的强制 flush 兜底
const MIN_FLUSH_INTERVAL = 5000;
// 单日单文件分钟采样上限（24 小时），防止超长会话序列无界增长
const MAX_DAY_SAMPLES = 1440;

// 存储适配器（宿主注入，便于测试与跨环境）
export interface StatsStorageAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export interface StatsStorePaths {
  fileStats: string;
  project: string;
  globalStats: string;
}

// 构造可选项：写盘连续失败阈值回调（优化 5，UI 弹 Notice）
export interface StatsStoreOptions {
  // 连续写盘失败达到阈值（3 次）时通知；成功写盘后计数清零
  onFlushError?: () => void;
}

function emptyGlobal(): GlobalStats {
  return {
    grossTypedTotal: 0,
    deletedCharsTotal: 0,
    dailyActiveByDate: {},
    dailyGrossByDate: {},
    dailyPeakByDate: {},
    heatmap: {},
  };
}

// 反序列化危险键集合：若外部 JSON 数据携带 __proto__/constructor/prototype 键，
// 直接赋值会命中对象原型链（原型污染，甚至污染 Object.prototype），统一丢弃
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// 反序列化对象键是否安全（跳过危险键，防原型污染）
function isSafeKey(k: string): boolean {
  return !UNSAFE_KEYS.has(k);
}

// ---- 加载数据消毒：仅保留有限数值与合法结构，避免损坏/旧版本数据污染统计 ----

function finiteNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function sanitizeFileStats(f: unknown): FileStats | null {
  if (!f || typeof f !== "object") return null;
  const o = f as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return {
    path: o.path,
    grossTyped: finiteNum(o.grossTyped),
    deletedChars: finiteNum(o.deletedChars),
    activeTimeMs: finiteNum(o.activeTimeMs),
    firstSeen: finiteNum(o.firstSeen),
    lastOpened: finiteNum(o.lastOpened),
  };
}

function sanitizeNumMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!isSafeKey(k)) continue;
    out[k] = finiteNum(val);
  }
  return out;
}

function sanitizeHeatmap(v: unknown): Record<string, HeatmapDaySlots> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, HeatmapDaySlots> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!isSafeKey(k)) continue;
    if (Array.isArray(val)) {
      // 旧格式（优化 3 之前）：number[] 即活跃 ms，字数维度补 0
      out[k] = { activeMs: normalize24(val), grossByHour: new Array<number>(24).fill(0) };
    } else if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      out[k] = {
        activeMs: normalize24(o.activeMs),
        grossByHour: normalize24(o.grossByHour),
      };
    }
  }
  return out;
}

// 固定 24 小时槽位，越界/缺失补 0；快速路径复用原数组（合法 24 槽且全为有限数）
function normalize24(arr: unknown): number[] {
  if (Array.isArray(arr) && arr.length === 24 && arr.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return arr as number[];
  }
  return Array.from({ length: 24 }, (_, i) => finiteNum(Array.isArray(arr) ? arr[i] : undefined));
}

function sanitizeGlobal(g: unknown): GlobalStats {
  if (!g || typeof g !== "object") return emptyGlobal();
  const o = g as Record<string, unknown>;
  return {
    grossTypedTotal: finiteNum(o.grossTypedTotal),
    deletedCharsTotal: finiteNum(o.deletedCharsTotal),
    dailyActiveByDate: sanitizeNumMap(o.dailyActiveByDate),
    dailyGrossByDate: sanitizeNumMap(o.dailyGrossByDate),
    dailyPeakByDate: sanitizeNumMap(o.dailyPeakByDate),
    heatmap: sanitizeHeatmap(o.heatmap),
  };
}

function sanitizeProject(p: unknown): ProjectStatsData {
  if (!p || typeof p !== "object") return { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
  const o = p as Record<string, unknown>;
  return {
    version: typeof o.version === "number" ? o.version : 1,
    grossTyped: finiteNum(o.grossTyped),
    deletedChars: finiteNum(o.deletedChars),
    activeTimeMs: finiteNum(o.activeTimeMs),
    updatedAt: finiteNum(o.updatedAt),
  };
}

// 当天分钟采样消毒：仅保留合法采样点（数值有限），按天+文件组织，超上限裁最旧
function sanitizeDaySeries(v: unknown): Record<string, Record<string, MinuteSample[]>> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, Record<string, MinuteSample[]>> = {};
  for (const [dk, byPath] of Object.entries(v as Record<string, unknown>)) {
    if (!isSafeKey(dk)) continue;
    if (!byPath || typeof byPath !== "object") continue;
    const day: Record<string, MinuteSample[]> = {};
    for (const [p, arr] of Object.entries(byPath as Record<string, unknown>)) {
      if (!isSafeKey(p)) continue;
      if (!Array.isArray(arr)) continue;
      const cleaned: MinuteSample[] = [];
      for (const s of arr) {
        const o = s as Record<string, unknown> | null;
        if (!o || typeof o !== "object") continue;
        const t = typeof o.t === "number" && Number.isFinite(o.t) ? o.t : 0;
        cleaned.push({ t, delta: finiteNum(o.delta), gross: finiteNum(o.gross) });
      }
      if (cleaned.length > MAX_DAY_SAMPLES) cleaned.splice(0, cleaned.length - MAX_DAY_SAMPLES);
      if (cleaned.length > 0) day[p] = cleaned;
    }
    if (Object.keys(day).length > 0) out[dk] = day;
  }
  return out;
}

// 导入时 key 归一化：绝对路径 key → 相对路径（含重复合并）；非本库绝对路径丢弃。
// 兼容旧版本备份（优化 1 之前为绝对路径 key）
function normalizeImportedKeys(files: Record<string, FileStats>, basePath: string | null): Record<string, FileStats> {
  const out: Record<string, FileStats> = {};
  const addFile = (rel: string, f: FileStats) => {
    if (!isSafeKey(rel)) return; // 防原型污染：丢弃 __proto__/constructor/prototype 键
    const t = out[rel];
    if (t) {
      t.grossTyped += f.grossTyped;
      t.deletedChars += f.deletedChars;
      t.activeTimeMs += f.activeTimeMs;
      if (f.firstSeen > 0 && (t.firstSeen === 0 || f.firstSeen < t.firstSeen)) t.firstSeen = f.firstSeen;
      if (f.lastOpened > t.lastOpened) t.lastOpened = f.lastOpened;
    } else {
      out[rel] = { ...f, path: rel };
    }
  };
  const normBase = basePath ? basePath.replace(/\\/g, "/").replace(/\/+$/g, "") : null;
  const prefix = normBase ? normBase + "/" : null;
  for (const [k, f] of Object.entries(files)) {
    const norm = k.replace(/\\/g, "/");
    const isAbs = /^[A-Za-z]:\//.test(norm) || norm.startsWith("/");
    if (isAbs) {
      if (prefix && norm.startsWith(prefix)) {
        addFile(norm.slice(prefix.length).replace(/^\/+|\/+$/g, ""), f);
      }
      // 非本库绝对路径：无法匹配当前 vault，丢弃
    } else {
      addFile(norm.replace(/^\/+|\/+$/g, ""), f);
    }
  }
  return out;
}

export class StatsStore {
  private files: Record<string, FileStats> = {};
  private globalStats: GlobalStats = emptyGlobal();
  private project: ProjectStatsData = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
  // 当天分钟采样（曲线跨会话恢复）：YYYY-MM-DD -> 文件相对路径 -> 采样点数组
  private daySeries: Record<string, Record<string, MinuteSample[]>> = {};
  private dirty = false;
  // 分层脏标记：只写有变化的层，避免 recordPeak（仅 global）/touchOpen（仅 files）触发时全量重写
  private dirtyFiles = false;
  private dirtyProject = false;
  private dirtyGlobal = false;
  private flushTimer: number | null = null;
  private flushing = false;
  // 最近一次实际写盘时间（用于最小落盘间隔合并）
  private lastFlushAt = 0;
  // 连续写盘失败计数（优化 5：达到阈值通知用户）
  private flushErrorCount = 0;

  constructor(
    private storage: StatsStorageAdapter,
    private paths: StatsStorePaths,
    private opts: StatsStoreOptions = {},
  ) {}

  // 加载全部数据（损坏则重建，字段级消毒）
  async load() {
    try {
      const raw = await this.storage.read(this.paths.fileStats);
      if (raw) {
        const data = JSON.parse(raw) as { files?: unknown; daySeries?: unknown } | null;
        if (data && typeof data.files === "object" && data.files !== null) {
          const cleaned: Record<string, FileStats> = {};
          for (const [k, v] of Object.entries(data.files as Record<string, unknown>)) {
            if (!isSafeKey(k)) continue; // 防原型污染
            const f = sanitizeFileStats(v);
            if (f) cleaned[k] = f;
          }
          this.files = cleaned;
        }
        this.daySeries = sanitizeDaySeries(data?.daySeries);
      }
    } catch {
      this.files = {};
      this.daySeries = {};
    }
    try {
      const raw = await this.storage.read(this.paths.project);
      if (raw) this.project = sanitizeProject(JSON.parse(raw));
    } catch {
      this.project = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
    }
    try {
      const raw = await this.storage.read(this.paths.globalStats);
      if (raw) this.globalStats = sanitizeGlobal(JSON.parse(raw));
    } catch {
      this.globalStats = emptyGlobal();
    }
  }

  // 记录一次编辑变更（累计输入/删除）到三层
  recordChange(path: string, typed: number, deleted: number) {
    if (typed <= 0 && deleted <= 0) return;
    const now = new Date();
    const key = dateKey(now);
    const file = this.ensureFile(path, now.getTime());
    file.grossTyped += typed;
    file.deletedChars += deleted;
    this.globalStats.grossTypedTotal += typed;
    this.globalStats.deletedCharsTotal += deleted;
    this.globalStats.dailyGrossByDate[key] = (this.globalStats.dailyGrossByDate[key] || 0) + typed;
    // 热力图字数维度：按小时累加累计输入（优化 3）
    const day = this.ensureHeatmapDay(key);
    day.grossByHour[now.getHours()] = (day.grossByHour[now.getHours()] || 0) + typed;
    this.project.grossTyped += typed;
    this.project.deletedChars += deleted;
    this.project.updatedAt = now.getTime();
    this.markDirty(7); // 三层都变
  }

  // 记录活跃时长（含热力图）；now 由调用方下传复用（缺省取当前时间）
  recordActiveTime(path: string, ms: number, hour: number, now = Date.now()) {
    const key = dateKey(new Date(now));
    const file = this.ensureFile(path, now);
    file.activeTimeMs += ms;
    this.globalStats.dailyActiveByDate[key] = (this.globalStats.dailyActiveByDate[key] || 0) + ms;
    const day = this.ensureHeatmapDay(key);
    day.activeMs[hour] = (day.activeMs[hour] || 0) + ms;
    this.project.activeTimeMs += ms;
    this.project.updatedAt = now;
    this.markDirty(7); // 三层都变
  }

  // 确保某日热力图槽位存在
  private ensureHeatmapDay(key: string): HeatmapDaySlots {
    if (!this.globalStats.heatmap[key]) {
      this.globalStats.heatmap[key] = { activeMs: new Array<number>(24).fill(0), grossByHour: new Array<number>(24).fill(0) };
    }
    return this.globalStats.heatmap[key];
  }

  // 记录每日峰值速度（取当日最大值）；now 由调用方下传复用（缺省取当前时间）
  recordPeak(cpm: number, now = Date.now()) {
    const key = dateKey(new Date(now));
    const cur = this.globalStats.dailyPeakByDate[key] || 0;
    if (cpm > cur) {
      this.globalStats.dailyPeakByDate[key] = cpm;
      this.markDirty(4); // 仅全局层
    }
  }

  // 文件打开时登记（标 files 层脏，确保 lastOpened 持久化）
  touchOpen(path: string, now: number) {
    const file = this.ensureFile(path, now);
    file.lastOpened = now;
    this.markDirty(1);
  }

  // 记录当天某文件的一个分钟采样（曲线跨会话恢复用；按天+文件追加，同分钟覆盖）
  recordDaySample(path: string, dateKey: string, sample: MinuteSample) {
    const day = this.daySeries[dateKey] ?? (this.daySeries[dateKey] = {});
    const list = day[path] ?? (day[path] = []);
    const last = list[list.length - 1];
    if (last && last.t === sample.t) list[list.length - 1] = sample;
    else list.push(sample);
    if (list.length > MAX_DAY_SAMPLES) list.splice(0, list.length - MAX_DAY_SAMPLES);
    this.markDirty(1);
  }

  // 取当天某文件的历史分钟采样（曲线恢复；无则 undefined）
  getDaySeries(path: string, dateKey: string): MinuteSample[] | undefined {
    return this.daySeries[dateKey]?.[path];
  }

  private ensureFile(path: string, now: number): FileStats {
    // 防御纵深：危险键（__proto__ 等）读取会命中原型链，返回一次性临时对象而非写入存储
    if (!isSafeKey(path)) {
      return { path, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, firstSeen: now, lastOpened: now };
    }
    let f = this.files[path];
    if (!f) {
      f = { path, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, firstSeen: now, lastOpened: now };
      this.files[path] = f;
    }
    return f;
  }

  // ---- 查询 ----
  getFileStats(path: string): FileStats | undefined {
    // 防御纵深：普通对象对 __proto__ 键的读取会命中 Object.prototype，直接返回 undefined
    return isSafeKey(path) ? this.files[path] : undefined;
  }

  getAllFileStats(): FileStats[] {
    return Object.values(this.files);
  }

  // 启动一次性迁移：将旧版本「绝对路径 key」映射为 vault 相对路径（优化 1）。
  // 仅做「绝对路径 → 相对路径」映射：非本库路径原样保留，不删除任何数据；
  // 合并时数值相加、firstSeen 取较早、lastOpened 取较新。幂等，二次启动自动跳过。
  // 返回迁移条数（0 = 无需迁移）
  migratePaths(basePath: string | null): number {
    if (!basePath) return 0;
    // 仅去除尾部斜杠，保留首部斜杠（Unix 绝对路径 /vault/... 需完整前缀匹配）
    const normBase = basePath.replace(/\\/g, "/").replace(/\/+$/g, "");
    const prefix = normBase + "/";
    let migrated = 0;
    const merged: Record<string, FileStats> = {};
    // 统一合并入口：新旧 key 指向同一文件时数值累加，时间取更全的区间
    const addFile = (rel: string, f: FileStats) => {
      const target = merged[rel];
      if (target) {
        target.grossTyped += f.grossTyped;
        target.deletedChars += f.deletedChars;
        target.activeTimeMs += f.activeTimeMs;
        if (f.firstSeen > 0 && (target.firstSeen === 0 || f.firstSeen < target.firstSeen)) target.firstSeen = f.firstSeen;
        if (f.lastOpened > target.lastOpened) target.lastOpened = f.lastOpened;
      } else {
        merged[rel] = { ...f, path: rel };
      }
    };
    for (const [k, f] of Object.entries(this.files)) {
      const norm = k.replace(/\\/g, "/");
      const isAbs = /^[A-Za-z]:\//.test(norm) || norm.startsWith("/");
      if (isAbs && norm.startsWith(prefix)) {
        // 本库绝对路径 → 映射为相对路径
        addFile(norm.slice(prefix.length).replace(/^\/+|\/+$/g, ""), f);
        migrated++;
      } else {
        // 已是相对路径（或非本库路径）：原样保留，但可能与迁移结果合并
        addFile(k, f);
      }
    }
    if (migrated > 0) {
      this.files = merged;
      this.markDirty(1);
    }
    return migrated;
  }

  getGlobalStats(): GlobalStats {
    return this.globalStats;
  }

  // 导入统计（功能 4）：按模式合并/覆盖三层数据。
  // raw 为 .typelog 备份的 data 字段（fileStats/project/global），内部消毒 + key 归一化；
  // basePath 用于把旧备份中的绝对路径 key 映射为相对路径（非本库路径丢弃）。
  // 返回导入的文件统计条数
  applyImport(raw: { fileStats?: unknown; project?: unknown }, mode: "merge" | "overwrite", basePath: string | null): number {
    // 消毒文件级
    const rawFiles: Record<string, FileStats> = {};
    if (raw.fileStats && typeof raw.fileStats === "object") {
      for (const [k, v] of Object.entries(raw.fileStats as Record<string, unknown>)) {
        if (!isSafeKey(k)) continue; // 防原型污染
        const f = sanitizeFileStats(v);
        if (f) rawFiles[k] = f;
      }
    }
    const files = normalizeImportedKeys(rawFiles, basePath);
    const project = sanitizeProject(raw.project);
    // .typelog 备份格式的全局数据键为 "global"（历史兼容），用字符串索引读取避免裸标识符
    const globalStats = sanitizeGlobal((raw as unknown as Record<string, unknown>)["global"]);

    if (mode === "overwrite") {
      // 覆盖：整体替换（调用方已做双确认 + 导入前自动备份）
      this.files = {};
      for (const [k, f] of Object.entries(files)) this.files[k] = { ...f };
      this.project = { ...project, version: 1 };
      this.globalStats = globalStats;
      // 当天分钟采样为辅助曲线数据（不进备份），覆盖时一并清空避免串库
      this.daySeries = {};
      this.markDirty(7);
      return Object.keys(this.files).length;
    }

    // 合并：文件级按路径累加（时间取更全区间），每日键相加，峰值取 max，终身累计相加
    let imported = 0;
    for (const [k, f] of Object.entries(files)) {
      const t = this.files[k];
      if (t) {
        t.grossTyped += f.grossTyped;
        t.deletedChars += f.deletedChars;
        t.activeTimeMs += f.activeTimeMs;
        if (f.firstSeen > 0 && (t.firstSeen === 0 || f.firstSeen < t.firstSeen)) t.firstSeen = f.firstSeen;
        if (f.lastOpened > t.lastOpened) t.lastOpened = f.lastOpened;
      } else {
        this.files[k] = { ...f };
      }
      imported++;
    }
    // 全局：终身累计相加、每日键相加、峰值取 max、热力图逐小时相加
    const g = this.globalStats;
    g.grossTypedTotal += globalStats.grossTypedTotal;
    g.deletedCharsTotal += globalStats.deletedCharsTotal;
    for (const [k, v] of Object.entries(globalStats.dailyActiveByDate)) g.dailyActiveByDate[k] = (g.dailyActiveByDate[k] || 0) + v;
    for (const [k, v] of Object.entries(globalStats.dailyGrossByDate)) g.dailyGrossByDate[k] = (g.dailyGrossByDate[k] || 0) + v;
    for (const [k, v] of Object.entries(globalStats.dailyPeakByDate)) g.dailyPeakByDate[k] = Math.max(g.dailyPeakByDate[k] || 0, v);
    for (const [k, day] of Object.entries(globalStats.heatmap)) {
      const t = this.ensureHeatmapDay(k);
      for (let h = 0; h < 24; h++) {
        t.activeMs[h] = (t.activeMs[h] || 0) + (day.activeMs[h] || 0);
        t.grossByHour[h] = (t.grossByHour[h] || 0) + (day.grossByHour[h] || 0);
      }
    }
    // 工程级：数值相加
    this.project.grossTyped += project.grossTyped;
    this.project.deletedChars += project.deletedChars;
    this.project.activeTimeMs += project.activeTimeMs;
    this.project.updatedAt = Math.max(this.project.updatedAt, project.updatedAt);
    this.markDirty(7);
    return imported;
  }

  getProjectStats(): ProjectStatsData {
    return this.project;
  }

  // ---- 持久化 ----
  // 位掩码：1=files 层，2=project 层，4=global 层
  private markDirty(layers: number) {
    if (layers & 1) this.dirtyFiles = true;
    if (layers & 2) this.dirtyProject = true;
    if (layers & 4) this.dirtyGlobal = true;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushScheduled();
    }, FLUSH_DEBOUNCE_MS);
  }

  // 定时路径：受"最小落盘间隔"限制。未到间隔时顺延重排定时器，避免慢速打字每次击键全量写盘
  private async flushScheduled() {
    if (this.flushing) return;
    // lastFlushAt=0 表示从未写盘过，首次落盘不受间隔限制
    if (this.lastFlushAt > 0 && Date.now() - this.lastFlushAt < MIN_FLUSH_INTERVAL) {
      if (!this.flushTimer) {
        this.flushTimer = window.setTimeout(() => {
          this.flushTimer = null;
          void this.flushScheduled();
        }, FLUSH_DEBOUNCE_MS);
      }
      return;
    }
    await this.flush();
  }

  // 立即写盘（onunload/导出/硬重置调用；强制路径，不受最小间隔限制）
  // 仅序列化并写入有变化的层
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.dirty = false;
      let wrote = false;
      if (this.dirtyFiles) {
        const fileData: FileStatsStoreData = { version: 1, files: this.files, daySeries: this.daySeries };
        await this.storage.write(this.paths.fileStats, JSON.stringify(fileData));
        this.dirtyFiles = false;
        wrote = true;
      }
      if (this.dirtyProject) {
        await this.storage.write(this.paths.project, JSON.stringify(this.project));
        this.dirtyProject = false;
        wrote = true;
      }
      if (this.dirtyGlobal) {
        await this.storage.write(this.paths.globalStats, JSON.stringify(this.globalStats));
        this.dirtyGlobal = false;
        wrote = true;
      }
      if (wrote) {
        this.lastFlushAt = Date.now();
        // 成功写盘：失败计数清零（优化 5）
        this.flushErrorCount = 0;
      }
    } catch (err) {
      // 写盘失败：不确定哪层失败，全部回置为待写，下次重试
      this.dirty = true;
      this.dirtyFiles = true;
      this.dirtyProject = true;
      this.dirtyGlobal = true;
      console.error("[TypeLog] 数据写盘失败：", err);
      // 连续失败达到阈值时通知用户（首次失败静默重试，恢复后自动清零）
      this.flushErrorCount++;
      if (this.flushErrorCount >= 3) {
        this.flushErrorCount = 0;
        this.opts.onFlushError?.();
      }
    } finally {
      this.flushing = false;
    }
  }

  // 硬重置：清空全部历史（UI 需二次确认）
  hardReset() {
    this.files = {};
    this.globalStats = emptyGlobal();
    this.project = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
    this.daySeries = {};
    this.markDirty(7);
  }

  // ---- 数据老化清理（涉及删除，UI 必须二次确认；全局终身累计不受影响） ----

  // 清理 lastOpened < before 的文件统计；返回清理条数。
  // lastOpened=0 的旧数据无时间信息，保守跳过（文档约定）
  purgeInactiveFiles(before: number): number {
    let removed = 0;
    for (const [k, f] of Object.entries(this.files)) {
      if (f.lastOpened > 0 && f.lastOpened < before) {
        delete this.files[k];
        // 同步清理该文件在所有天的分钟采样（孤儿数据），避免清理后仍随写盘膨胀
        for (const [dk, day] of Object.entries(this.daySeries)) {
          if (Object.prototype.hasOwnProperty.call(day, k)) {
            delete day[k];
            if (Object.keys(day).length === 0) delete this.daySeries[dk];
          }
        }
        removed++;
      }
    }
    if (removed > 0) this.markDirty(1);
    return removed;
  }

  // 裁剪超过 maxDays 天的每日统计键（dailyActive/dailyGross/dailyPeak/heatmap）；返回清理键数。
  // 日期键为 YYYY-MM-DD，字典序即时间序
  pruneOldDailyKeys(maxDays: number): number {
    if (maxDays <= 0) return 0;
    const cutoffKey = dateKey(new Date(Date.now() - maxDays * 86_400_000));
    let removed = 0;
    for (const map of [
      this.globalStats.dailyActiveByDate,
      this.globalStats.dailyGrossByDate,
      this.globalStats.dailyPeakByDate,
    ]) {
      for (const key of Object.keys(map)) {
        if (key < cutoffKey) {
          delete map[key];
          removed++;
        }
      }
    }
    for (const key of Object.keys(this.globalStats.heatmap)) {
      if (key < cutoffKey) {
        delete this.globalStats.heatmap[key];
        removed++;
      }
    }
    // 当天分钟采样按天裁剪（曲线恢复数据为辅助数据，随保留天数一并清理；属 files 层）
    for (const key of Object.keys(this.daySeries)) {
      if (key < cutoffKey) {
        delete this.daySeries[key];
        removed++;
      }
    }
    // global 层（每日键/热力图）+ files 层（daySeries）都可能有删除
    if (removed > 0) this.markDirty(5);
    return removed;
  }
}
