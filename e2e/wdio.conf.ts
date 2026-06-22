import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";

let tauriDriver: ChildProcess;

const exePath = path.resolve(
  __dirname,
  "..",
  "src-tauri",
  "target",
  "debug",
  "hyperdesk.exe",
);

export const config: WebdriverIO.Config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: exePath,
      },
    } as any,
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  // ponytail: builds the no-admin manifest variant so msedgedriver can launch
  // the app without a UAC prompt stalling the WebDriver session.
  onPrepare: () => {
    const result = spawnSync(
      "npm",
      ["run", "tauri", "--", "build", "--debug", "--no-bundle"],
      {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, HYPERDESK_E2E: "1" },
        stdio: "inherit",
        shell: true,
      },
    );
    if (result.status !== 0) {
      throw new Error("tauri build failed");
    }
  },

  beforeSession: () => {
    tauriDriver = spawn(
      path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver.exe"),
      [],
      { stdio: [null, process.stdout, process.stderr] },
    );
  },

  afterSession: () => {
    tauriDriver?.kill();
  },
};
