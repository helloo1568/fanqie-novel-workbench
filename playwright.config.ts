import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

// 本地开发时可指定 PLAYWRIGHT_CHROMIUM_PATH；否则使用 Playwright 默认安装的 Chromium
const localChromium = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(localChromium) ? localChromium : undefined);
const e2eDataDir = path.resolve("test-results", `e2e-data-${process.pid}`);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3211",
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-e2e.mjs",
    url: "http://127.0.0.1:3211/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: "3211",
      NOVEL_WORKBENCH_DATA_DIR: e2eDataDir,
    },
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
