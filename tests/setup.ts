// 测试环境 window polyfill：插件使用 window.setTimeout 等全局（popout 兼容），
// node 测试环境没有 window，这里将 window 指向 globalThis。
(globalThis as Record<string, unknown>).window = globalThis;
