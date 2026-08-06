// TypeLog 共享统计类型

// 一次编辑变更的统计结果
export interface ChangeStats {
  // 新增字符数（累计，含粘贴）
  typed: number;
  // 删除字符数（含被替换掉的旧文本）
  deleted: number;
  // 净变化 = typed - deleted
  net: number;
  // 粘贴/拖拽批量导入
  isPaste: boolean;
  // 逐字键入数（粘贴按开关计入）
  typedManual: number;
}

// 会话级统计（当前打开文件，内存态）
export interface SessionStats {
  // 文件 vault 相对路径（与存储 key 口径一致）
  path: string;
  // 打开时间戳（ms）
  openedAt: number;
  // 打开时的净字数
  netStartWords: number;
  // 会话净增减（字符级：新增-删除）
  deltaWords: number;
  // 会话累计输入
  grossTyped: number;
  // 会话删除字符数
  deletedChars: number;
  // 会话活跃毫秒
  activeTimeMs: number;
  // 峰值速度（CPM）
  peakSpeed: number;
  // 分钟级采样（字数增长曲线）
  minuteSeries: { t: number; delta: number; gross: number }[];
}

// 文件层持久化统计
export interface FileStats {
  // 文件 vault 相对路径（Key，稳定，vault 迁移后仍一致）
  path: string;
  // 累计输入（永不回退）
  grossTyped: number;
  // 累计删除字符数
  deletedChars: number;
  // 累计活跃时长（ms）
  activeTimeMs: number;
  // 首次统计时间戳
  firstSeen: number;
  // 最近打开时间戳
  lastOpened: number;
}

// 热力图某日 24 小时槽位：活跃毫秒 + 累计输入字数（优化 3 引入字数维度）
export interface HeatmapDaySlots {
  // 各小时活跃毫秒
  activeMs: number[];
  // 各小时累计输入字符数（含删除/替换的键入量）
  grossByHour: number[];
}

// 全局层持久化统计（跨 vault）
export interface GlobalStats {
  // 终身累计累计输入
  grossTypedTotal: number;
  // 终身累计删除字符数
  deletedCharsTotal: number;
  // 每日活跃时长 ms：YYYY-MM-DD -> ms
  dailyActiveByDate: Record<string, number>;
  // 每日累计输入：YYYY-MM-DD -> chars
  dailyGrossByDate: Record<string, number>;
  // 每日峰值速度 CPM：YYYY-MM-DD -> cpm
  dailyPeakByDate: Record<string, number>;
  // 打字热力图：YYYY-MM-DD -> 当日 24 小时数据（活跃毫秒 + 字数）
  heatmap: Record<string, HeatmapDaySlots>;
}

// 分钟级采样点（字数增长曲线）：t=采样时间戳，delta=当天累计净变化，gross=当天累计输入
export interface MinuteSample {
  t: number;
  delta: number;
  gross: number;
}

// 文件层存储文件结构
export interface FileStatsStoreData {
  version: number;
  files: Record<string, FileStats>;
  // 当天分钟级采样（曲线跨会话恢复）：YYYY-MM-DD -> vault相对路径 -> 采样点数组
  daySeries?: Record<string, Record<string, MinuteSample[]>>;
}

// 工程层存储文件结构（当前 vault 汇总）
export interface ProjectStatsData {
  version: number;
  grossTyped: number;
  deletedChars: number;
  activeTimeMs: number;
  updatedAt: number;
}

// 每秒心跳结果
export interface TickResult {
  // 本秒是否计为活跃
  active: boolean;
  // 活跃增量 ms
  activeMs: number;
  // 闲置增量 ms
  idleMs: number;
}
