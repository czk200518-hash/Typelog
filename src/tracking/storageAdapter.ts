// 自适应存储：系统绝对路径走 Node fs，vault 相对路径走 Vault.adapter
import { Vault } from "obsidian";
import type { StatsStorageAdapter } from "../core/statsStore";

// 显式声明用到的 Node 模块接口，避免依赖 @types/node 的类型解析（评审 lint 会将其视为 any）
interface FsPromisesApi {
  readFile(path: string, encoding: string): Promise<string>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, content: string, encoding: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

interface FsModuleApi {
  promises: FsPromisesApi;
}

interface OsModuleApi {
  homedir(): string;
}

interface PathModuleApi {
  join(...parts: string[]): string;
}

interface NodeRequire {
  (m: "fs"): FsModuleApi;
  (m: "os"): OsModuleApi;
  (m: "path"): PathModuleApi;
  (m: string): unknown;
}

// 桌面端 Electron 环境才有 Node require
export function getNodeRequire(): NodeRequire | null {
  const w = window as unknown as {
    require?: NodeRequire;
    process?: { versions?: { electron?: string } };
  };
  if (typeof w.require === "function" && w.process && w.process.versions && w.process.versions.electron) {
    return w.require;
  }
  return null;
}

// 系统绝对路径（盘符:/、/ 开头、\\ 开头）
export function isSystemPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

export class AdaptiveStorageAdapter implements StatsStorageAdapter {
  private nodeRequire: NodeRequire | null;

  constructor(private vault: Vault) {
    this.nodeRequire = getNodeRequire();
  }

  async read(path: string): Promise<string | null> {
    if (isSystemPath(path)) {
      const fs = this.nodeRequire?.("fs");
      if (fs) {
        try {
          return await fs.promises.readFile(path, "utf8");
        } catch {
          return null;
        }
      }
      return null;
    }
    try {
      return await this.vault.adapter.read(path);
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    if (isSystemPath(path)) {
      const fs = this.nodeRequire?.("fs");
      if (fs) {
        const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
        await fs.promises.mkdir(dir, { recursive: true });
        // 原子写：先写临时文件再 rename
        const tmp = path + ".tmp";
        await fs.promises.writeFile(tmp, content, "utf8");
        await fs.promises.rename(tmp, path);
        return;
      }
      throw new Error("系统路径写入不可用");
    }
    // DataAdapter.write 不会自动建父目录，必须手动建，否则写盘静默失败
    const norm = path.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    if (idx > 0) {
      const dir = norm.slice(0, idx);
      if (!(await this.vault.adapter.exists(dir))) {
        await this.vault.adapter.mkdir(dir);
      }
    }
    await this.vault.adapter.write(norm, content);
  }
}
