// 三层数据存储：文件层/工程层/全局层，防抖 + 最小间隔写盘，原子写（tmp+rename）
import type { FileStats, GlobalStats, FileStatsStoreData, ProjectStatsData } from "../types";
import { dateKey } from "./format";

// 防抖窗口：合并连续高频事件（击键等）
const FLUSH_DEBOUNCE_MS = 200;
// 最小落盘间隔：慢速打字（击键间隔 >200ms）时也封顶写盘频率，避免每次击键全量写盘；
// 数据安全由 onunload/导出前的强制 flush 兜底
const MIN_FLUSH_INTERVAL = 5000;

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
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = finiteNum(val);
  return out;
}

function sanitizeHeatmap(v: unknown): Record<string, number[]> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number[]> = {};
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    // 快速路径：24 槽且全部为有限数时直接复用原数组，避免启动时数千次数组分配
    if (arr.length === 24 && arr.every((x) => typeof x === "number" && Number.isFinite(x))) {
      out[k] = arr as number[];
      continue;
    }
    // 固定 24 小时槽位，越界/缺失补 0
    out[k] = Array.from({ length: 24 }, (_, i) => finiteNum(arr[i]));
  }
  return out;
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

export class StatsStore {
  private files: Record<string, FileStats> = {};
  private globalStats: GlobalStats = emptyGlobal();
  private project: ProjectStatsData = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
  private dirty = false;
  // 分层脏标记：只写有变化的层，避免 recordPeak（仅 global）/touchOpen（仅 files）触发时全量重写
  private dirtyFiles = false;
  private dirtyProject = false;
  private dirtyGlobal = false;
  private flushTimer: number | null = null;
  private flushing = false;
  // 最近一次实际写盘时间（用于最小落盘间隔合并）
  private lastFlushAt = 0;

  constructor(
    private storage: StatsStorageAdapter,
    private paths: StatsStorePaths,
  ) {}

  // 加载全部数据（损坏则重建，字段级消毒）
  async load() {
    try {
      const raw = await this.storage.read(this.paths.fileStats);
      if (raw) {
        const data = JSON.parse(raw) as { files?: unknown } | null;
        if (data && typeof data.files === "object" && data.files !== null) {
          const cleaned: Record<string, FileStats> = {};
          for (const [k, v] of Object.entries(data.files as Record<string, unknown>)) {
            const f = sanitizeFileStats(v);
            if (f) cleaned[k] = f;
          }
          this.files = cleaned;
        }
      }
    } catch {
      this.files = {};
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
    if (!this.globalStats.heatmap[key]) this.globalStats.heatmap[key] = new Array<number>(24).fill(0);
    this.globalStats.heatmap[key][hour] = (this.globalStats.heatmap[key][hour] || 0) + ms;
    this.project.activeTimeMs += ms;
    this.project.updatedAt = now;
    this.markDirty(7); // 三层都变
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

  private ensureFile(path: string, now: number): FileStats {
    let f = this.files[path];
    if (!f) {
      f = { path, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, firstSeen: now, lastOpened: now };
      this.files[path] = f;
    }
    return f;
  }

  // ---- 查询 ----
  getFileStats(path: string): FileStats | undefined {
    return this.files[path];
  }

  getAllFileStats(): FileStats[] {
    return Object.values(this.files);
  }

  getGlobalStats(): GlobalStats {
    return this.globalStats;
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
        const fileData: FileStatsStoreData = { version: 1, files: this.files };
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
      if (wrote) this.lastFlushAt = Date.now();
    } catch (err) {
      // 写盘失败：不确定哪层失败，全部回置为待写，下次重试
      this.dirty = true;
      this.dirtyFiles = true;
      this.dirtyProject = true;
      this.dirtyGlobal = true;
      console.error("[TypeLog] 数据写盘失败：", err);
    } finally {
      this.flushing = false;
    }
  }

  // 硬重置：清空全部历史（UI 需二次确认）
  hardReset() {
    this.files = {};
    this.globalStats = emptyGlobal();
    this.project = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
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
    if (removed > 0) this.markDirty(4);
    return removed;
  }
}
