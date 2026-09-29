// Real-time headless capture via the Chrome DevTools Protocol (no dependencies).
// usage: node capture.mjs <outDir> <lang> <page> [<page> ...]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [outDir, lang, ...pages] = process.argv.slice(2);
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const profile = join(outDir, `profile-cdp-${lang}`);
mkdirSync(outDir, { recursive: true });

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1920,1080",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === "page");
  } catch { /* not up yet */ }
}
if (!target) { edge.kill(); throw new Error("no CDP target"); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});

await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
// Pages the app can't be deep-linked to are reached by an action after load.
const clickText = (texts) => `(() => { const want = ${JSON.stringify(texts)};
  const el = [...document.querySelectorAll("button, a, [role=button], .nav-item, li")]
    .find(e => want.some(t => (e.textContent || "").trim() === t || (e.textContent || "").includes(t)));
  if (el) el.click(); return !!el; })()`;
const ACTIONS = {
  settings: { base: "dashboard", js: clickText(lang === "ko" ? ["설정"] : ["Settings"]) },
  events: { base: "events", js: clickText(lang === "ko" ? ["Hyper-V 이벤트 로드"] : ["Load Hyper-V events", "Hyper-V events"]) },
  palette: { base: "dashboard", js: `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })); true`,
    // 검색 결과가 보이게 입력까지 한다(React 제어 입력이라 네이티브 setter + input 이벤트)
    js2: `(() => { const i = document.querySelector("input"); if (!i) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "prod");
      i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()` },
};
for (const page of pages) {
  const act = ACTIONS[page];
  await send("Page.navigate", { url: `http://localhost:1420/_shot.html?page=${act ? act.base : page}&lang=${lang}` });
  await sleep(6000); // real time: loading screen + first data poll + chart animation
  if (act) {
    const r = await send("Runtime.evaluate", { expression: act.js, returnByValue: true });
    console.log(page, "action ->", r.result?.result?.value);
    await sleep(1500);
    if (act.js2) {
      const r2 = await send("Runtime.evaluate", { expression: act.js2, returnByValue: true });
      console.log(page, "action2 ->", r2.result?.result?.value);
      await sleep(1200);
    }
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${lang}-${page}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log("wrote", file);
}
ws.close();
edge.kill();
