import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: {
      NOVEL_WORKBENCH_DATA_DIR: fileURLToPath(new URL("./output/test-data/vitest", import.meta.url)),
    },
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.ts"],
  },
});
