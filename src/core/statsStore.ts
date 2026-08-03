// 三层数据存储：文件层/工程层/全局层，500ms 防抖写盘，原子写（tmp+rename）
import type { FileStats, GlobalStats, FileStatsStoreData, ProjectStatsData } from "../types";
import { dateKey } from "./format";

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

export class StatsStore {
  private files: Record<string, FileStats> = {};
  private globalStats: GlobalStats = emptyGlobal();
  private project: ProjectStatsData = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
  private dirty = false;
  private flushTimer: number | null = null;
  private flushing = false;

  constructor(
    private storage: StatsStorageAdapter,
    private paths: StatsStorePaths,
  ) {}

  // 加载全部数据（损坏则重建）
  async load() {
    try {
      const raw = await this.storage.read(this.paths.fileStats);
      if (raw) {
        const data = JSON.parse(raw) as FileStatsStoreData;
        if (data && data.files && typeof data.files === "object") this.files = data.files;
      }
    } catch {
      this.files = {};
    }
    try {
      const raw = await this.storage.read(this.paths.project);
      if (raw) this.project = { ...this.project, ...(JSON.parse(raw) as Partial<ProjectStatsData>) };
    } catch {
      this.project = { version: 1, grossTyped: 0, deletedChars: 0, activeTimeMs: 0, updatedAt: 0 };
    }
    try {
      const raw = await this.storage.read(this.paths.globalStats);
      if (raw) this.globalStats = { ...emptyGlobal(), ...(JSON.parse(raw) as Partial<GlobalStats>) };
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
    this.markDirty();
  }

  // 记录活跃时长（含热力图）
  recordActiveTime(path: string, ms: number, hour: number) {
    const now = new Date();
    const key = dateKey(now);
    const file = this.ensureFile(path, now.getTime());
    file.activeTimeMs += ms;
    this.globalStats.dailyActiveByDate[key] = (this.globalStats.dailyActiveByDate[key] || 0) + ms;
    if (!this.globalStats.heatmap[key]) this.globalStats.heatmap[key] = new Array<number>(24).fill(0);
    this.globalStats.heatmap[key][hour] = (this.globalStats.heatmap[key][hour] || 0) + ms;
    this.project.activeTimeMs += ms;
    this.project.updatedAt = now.getTime();
    this.markDirty();
  }

  // 记录每日峰值速度（取当日最大值）
  recordPeak(cpm: number) {
    const key = dateKey(new Date());
    const cur = this.globalStats.dailyPeakByDate[key] || 0;
    if (cpm > cur) {
      this.globalStats.dailyPeakByDate[key] = cpm;
      this.markDirty();
    }
  }

  // 文件打开时登记
  touchOpen(path: string, now: number) {
    const file = this.ensureFile(path, now);
    file.lastOpened = now;
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
  private markDirty() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 200);
  }

  // 立即写盘（onunload/导出前调用）
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.dirty = false;
      const fileData: FileStatsStoreData = { version: 1, files: this.files };
      await this.storage.write(this.paths.fileStats, JSON.stringify(fileData));
      await this.storage.write(this.paths.project, JSON.stringify(this.project));
      await this.storage.write(this.paths.globalStats, JSON.stringify(this.globalStats));
    } catch (err) {
      this.dirty = true; // 写盘失败回置，下次重试
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
    this.markDirty();
  }
}
