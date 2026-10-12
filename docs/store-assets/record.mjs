// README 데모 GIF용 프레임 녹화 — 브라우저 목업 모드(npm run dev)를 CDP로 조작하며 연속 캡처한다.
// usage: node record.mjs <outDir> <lang>   → <outDir>/<lang>/NNNN.jpg + frames.json, 이어서 make_gif.py
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [outDir, lang = "en"] = process.argv.slice(2);
const W = 1280, H = 720, PORT = 9334;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const dir = join(outDir, lang);
mkdirSync(dir, { recursive: true });

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(outDir, "profile-rec")}`, `--window-size=${W},${H}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
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
const run = (expression) => send("Runtime.evaluate", { expression, returnByValue: true });

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// 언어·테마·시작 페이지를 심고 다시 로드한다(임시 페이지를 public/에 두지 않으려고).
await send("Page.navigate", { url: "http://localhost:1420/" });
await sleep(1500);
await run(`localStorage.setItem("hd_page","dashboard");
  localStorage.setItem("hyperdesk_settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("hyperdesk_settings")||"{}"), lang: "${lang}", theme: "dark" }))`);
await send("Page.navigate", { url: "http://localhost:1420/" });
await sleep(6000); // 로딩 화면 + 첫 폴링 + 차트 애니메이션

const L = lang === "ko"
  ? { vms: "가상 머신", remote: "원격 자산", snaps: "스냅샷", dash: "대시보드" }
  : { vms: "Virtual Machines", remote: "Remote Assets", snaps: "Snapshots", dash: "Dashboard" };
const nav = (label) => run(`(() => { const el = [...document.querySelectorAll(".hd-nav-item")]
  .find(e => e.querySelector(".hd-nav-item__label")?.textContent.trim() === ${JSON.stringify(label)});
  if (el) el.click(); return !!el; })()`);
const type = (text) => run(`(() => { const i = document.querySelector("input"); if (!i) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)});
  i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const key = (k, ctrl = false) => run(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", ctrlKey: ${ctrl}, bubbles: true }))`);

// 녹화: 액션과 병렬로 ~10fps 캡처, 실제 경과 시간을 같이 기록한다(GIF 프레임 길이로 씀).
const frames = [];
let recording = true;
const t0 = Date.now();
const recorder = (async () => {
  while (recording) {
    const t = Date.now();
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
    const name = String(frames.length).padStart(4, "0") + ".jpg";
    writeFileSync(join(dir, name), Buffer.from(shot.result.data, "base64"));
    frames.push({ name, t: t - t0 });
    await sleep(Math.max(0, 100 - (Date.now() - t)));
  }
})();

await sleep(1800);                      // 대시보드
await nav(L.vms); await sleep(2200);    // 가상 머신
await nav(L.remote); await sleep(1800); // 원격 자산
await nav(L.snaps); await sleep(1800);  // 스냅샷
await nav(L.dash); await sleep(900);
await key("k", true); await sleep(700); // Ctrl+K 팔레트
for (const s of ["p", "pr", "pro", "prod"]) { await type(s); await sleep(260); }
await sleep(2000);
await key("Escape"); await sleep(900);

recording = false;
await recorder;
writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
console.log(lang, frames.length, "frames");
ws.close();
edge.kill();
