import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    // obsidian 无运行时入口，测试环境统一走桩实现
    alias: {
      obsidian: path.resolve(__dirname, "tests/obsidian-stub.ts"),
    },
  },
});
