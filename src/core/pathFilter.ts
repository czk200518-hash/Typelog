// 排除文件/文件夹规则（.ignore 语法）：* ? ** 通配符、! 反向排除、# 注释
// 规范化路径：统一 / 分隔
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function globToRegex(glob: string): RegExp {
  let body = glob.trim();
  // 以 / 开头表示锚定 vault 根
  const anchoredRoot = body.startsWith("/");
  if (anchoredRoot) body = body.slice(1);
  body = body.replace(/^\/+|\/+$/g, "");
  const escaped = body.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = escaped
    .replace(/\*\*/g, "\uFFFF")
    .replace(/\*/g, "[^/]*")
    .replace(/\uFFFF/g, ".*")
    .replace(/\?/g, "[^/]");
  // 无斜杠规则匹配任意层级（gitignore 语义）；含斜杠规则默认也匹配任意层级，除非锚定根
  const prefix = anchoredRoot ? "^" : "(^|.*/)";
  const suffix = "($|/.*)";
  return new RegExp(prefix + re + suffix, "i");
}

export interface IgnoreMatcher {
  (path: string): boolean;
}

// 编译 .ignore 规则列表为匹配函数
export function compileIgnorePatterns(patterns: string[]): IgnoreMatcher {
  const rules = patterns
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#"))
    .map((p) => {
      const negate = p.startsWith("!");
      const body = negate ? p.slice(1) : p;
      let re: RegExp | null = null;
      try {
        re = globToRegex(body);
      } catch {
        re = null;
      }
      return { negate, re };
    })
    .filter((r) => r.re);

  return (rawPath: string) => {
    const path = normalizePath(rawPath);
    let ignored = false;
    for (const r of rules) {
      if (r.re!.test(path)) ignored = !r.negate;
    }
    return ignored;
  };
}
