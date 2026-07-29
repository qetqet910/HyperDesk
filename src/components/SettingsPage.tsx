import { useEffect, useState } from "react";
import { User, Bell, Sun, Moon, Monitor, Palette, Shield, RefreshCw, MonitorPlay, Keyboard, Database, FolderOpen, EyeOff, Trash2, Package, Languages } from "lucide-react";
import { useSettings } from "@/contexts/SettingsContext";
import { applyTheme } from "@/lib/theme";
import { useT, LANGS, LANG_LABEL, type Key } from "@/lib/i18n";
import { api } from "@/lib/tauri-api";
import type { ToastType } from "@/hooks/useToast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LicenseModal } from "@/components/LicenseModal";

type UpdateState = "idle" | "checking" | "upToDate" | "available" | "error";

const MS_STORE_URL = "https://apps.microsoft.com/detail/9NPVXL622ZQQ";

// Store-distributed (MSIX) installs can't write to their own install
// directory, so an in-app self-updater (tauri-plugin-updater's
// downloadAndInstall) can't work — this only checks the latest GitHub release
// tag against the running version and, if newer, sends the user to the Store
// listing (MS handles the actual update from there).
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const a = l[i] ?? 0, b = c[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

const HOTKEYS: { keys: string; descKey: Key }[] = [
  { keys: "Alt + 1 ~ 4", descKey: "set.hotkey.slots" },
  { keys: "Ctrl + B", descKey: "set.hotkey.sidebar" },
  { keys: "Ctrl + K", descKey: "set.hotkey.search" },
];

interface SettingsPageProps {
  addToast: (message: string, type?: ToastType) => void;
}

export function SettingsPage({ addToast }: SettingsPageProps) {
  const { settings, updateSettings } = useSettings();
  const t = useT();
  const [confirmAction, setConfirmAction] = useState<"resetHidden" | "clearData" | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);

  const openDataDir = async () => {
    try {
      const path = await api.getDataDirPath();
      await navigator.clipboard.writeText(path);
      addToast(t("set.toast.pathCopied"), "info");
    } catch {
      addToast(t("set.toast.pathFailed"), "error");
    }
  };

  const resetHiddenHosts = async () => {
    try {
      await api.resetHiddenHosts();
      addToast(t("set.toast.hiddenReset"), "success");
    } catch {
      addToast(t("set.toast.resetFailed"), "error");
    } finally {
      setConfirmAction(null);
    }
  };

  const clearAppData = async () => {
    try {
      await api.clearAppData();
      addToast(t("set.toast.dataCleared"), "success");
    } catch {
      addToast(t("set.toast.clearFailed"), "error");
    } finally {
      setConfirmAction(null);
    }
  };

  const [appVersion, setAppVersion] = useState<string>("");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateVersion, setUpdateVersion] = useState<string>("");

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateState("checking");
    try {
      const res = await fetch("https://api.github.com/repos/qetqet910/HyperDesk/releases/latest");
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name ?? "").replace(/^v/, "");
      if (latest && isNewerVersion(latest, appVersion)) {
        setUpdateVersion(latest);
        setUpdateState("available");
      } else {
        setUpdateState("upToDate");
      }
    } catch {
      setUpdateState("error");
    }
  };

  return (
    <div className="settings-page">
      {/* Single flat surface — no cards, no tabs. Each group is a labelled block
          separated by a hairline, so everything reads as one continuous list. */}
      <div className="settings-sheet">

        {/* ── 외관 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Palette size={15} /><h3>{t("set.appearance")}</h3></div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t("set.theme")}</div>
              <div className="settings-row-desc">{t("set.themeDesc")}</div>
            </div>
            <div className="settings-theme-strip">
              <button
                className={`settings-theme-btn ${settings.theme ==="dark" ? "active" : ""}`}
                onClick={() => { applyTheme("dark"); updateSettings({ theme: "dark" }); }}
              >
                <Moon size={13} /> {t("set.theme.dark")}
              </button>
              <button
                className={`settings-theme-btn ${settings.theme ==="light" ? "active" : ""}`}
                onClick={() => { applyTheme("light"); updateSettings({ theme: "light" }); }}
              >
                <Sun size={13} /> {t("set.theme.light")}
              </button>
              <button
                className={`settings-theme-btn ${settings.theme ==="retro" ? "active" : ""}`}
                onClick={() => { applyTheme("retro"); updateSettings({ theme: "retro" }); }}
                title={t("set.theme.retroHint")}
              >
                <Monitor size={13} /> {t("set.theme.retro")}
              </button>
            </div>
          </div>
          {/* 언어. 테마와 같은 pill 스트립을 재사용한다 — 새 컨트롤을 만들 이유가
              없고, 항목이 2개뿐이라 select보다 클릭 한 번이 빠르다. */}
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t("settings.language")}</div>
              <div className="settings-row-desc">{t("settings.languageHint")}</div>
            </div>
            <div className="settings-theme-strip">
              {LANGS.map((l) => (
                <button
                  key={l}
                  className={`settings-theme-btn ${settings.lang === l ? "active" : ""}`}
                  onClick={() => updateSettings({ lang: l })}
                >
                  <Languages size={13} /> {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 모니터링 & 자동화 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Bell size={15} /><h3>{t("set.monitoring")}</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.liveSync")}</div>
              <div className="settings-row-desc">{t("set.liveSyncDesc")}</div>
              <div
                className={`toggle-switch ${settings.autoRefresh ? "active" : ""}`}
                onClick={() => updateSettings({ autoRefresh: !settings.autoRefresh })}
              >
                <div className="toggle-knob" />
              </div>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.interval")}</div>
              <div className="settings-row-desc">{t("set.intervalDesc")}</div>
              <div className="settings-number-input">
                <input
                  type="number"
                  min="2"
                  max="300"
                  value={settings.pollingInterval / 1000}
                  onChange={(e) => updateSettings({ pollingInterval: Number(e.target.value) * 1000 })}
                />
                <span>SEC</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 연결 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><MonitorPlay size={15} /><h3>{t("set.connection")}</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.defaultAccount")}</div>
              <div className="settings-text-input">
                <input
                  type="text"
                  placeholder="Administrator"
                  value={settings.defaultUsername}
                  onChange={(e) => updateSettings({ defaultUsername: e.target.value })}
                />
                <User size={15} className="input-icon" />
              </div>
              <div className="settings-row-desc">{t("set.defaultAccountDesc")}</div>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.colorDepth")}</div>
              <div className="settings-row-desc">{t("set.colorDepthDesc")}</div>
              <div className="settings-seg-row">
                {([16, 32] as const).map((d) => (
                  <button
                    key={d}
                    className={`hd-segment-btn ${settings.rdpColorDepth === d ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => updateSettings({ rdpColorDepth: d })}
                  >
                    {d}bit
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.perfMode")}</div>
              <div className="settings-row-desc">{t("set.perfModeDesc")}</div>
              <div className="settings-seg-row">
                {([
                  { id: "low", label: t("set.perf.low") },
                  { id: "balanced", label: t("set.perf.balanced") },
                  { id: "high", label: t("set.perf.high") },
                ] as const).map((q) => (
                  <button
                    key={q.id}
                    className={`hd-segment-btn ${settings.rdpQuality === q.id ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => updateSettings({ rdpQuality: q.id })}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── 단축키 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Keyboard size={15} /><h3>{t("set.hotkeys")}</h3></div>
          <div className="settings-fields">
            {HOTKEYS.map((h) => (
              <div className="settings-row col" key={h.keys}>
                <div className="settings-row-desc">{t(h.descKey)}</div>
                <kbd className="settings-kbd" style={{ alignSelf: "flex-start" }}>{h.keys}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* ── 데이터 관리 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Database size={15} /><h3>{t("set.data")}</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.dataPath")}</div>
              <div className="settings-row-desc">{t("set.dataPathDesc")}</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={openDataDir}>
                <FolderOpen size={13} /> {t("set.copyPath")}
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.resetHidden")}</div>
              <div className="settings-row-desc">{t("set.resetHiddenDesc")}</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmAction("resetHidden")}>
                <EyeOff size={13} /> {t("set.reset")}
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.clearData")}</div>
              <div className="settings-row-desc">{t("set.clearDataDesc")}</div>
              <button className="hd-segment-btn hd-segment-btn--danger" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmAction("clearData")}>
                <Trash2 size={13} /> {t("set.delete")}
              </button>
            </div>
          </div>
        </div>

        {/* ── 정보 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Shield size={15} /><h3>{t("set.about")}</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">HyperDesk</div>
              <div className="settings-row-desc">Tauri v2 · React 19 · Win32 SwallowGrid™</div>
              <span className="hd-sidebar__version" style={{ fontSize: "11px", alignSelf: "flex-start" }}>
                {appVersion ? `v${appVersion}` : "—"}
              </span>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.licenses")}</div>
              <div className="settings-row-desc">{t("set.licensesDesc")}</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowLicenses(true)}>
                <Package size={13} /> {t("set.viewLicenses")}
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.update")}</div>
              <div className="settings-row-desc">
                {updateState === "idle" && t("set.update.idle")}
                {updateState === "checking" && t("set.update.checking")}
                {updateState === "upToDate" && t("set.update.upToDate")}
                {updateState === "available" && t("set.update.available", { version: updateVersion })}
                {updateState === "error" && t("set.update.error")}
              </div>
              {updateState === "available" ? (
                <a
                  className="hd-btn"
                  style={{ alignSelf: "flex-start" }}
                  href={MS_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <RefreshCw size={13} /> {t("set.update.store")}
                </a>
              ) : (
                <button
                  className="hd-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={handleCheckUpdate}
                  disabled={updateState === "checking"}
                >
                  <RefreshCw size={13} /> {t("set.update.check")}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {confirmAction === "resetHidden" && (
        <ConfirmModal
          title={t("set.confirm.resetHidden.title")}
          message={t("set.confirm.resetHidden.body")}
          type="info"
          confirmText={t("set.reset")}
          onConfirm={resetHiddenHosts}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "clearData" && (
        <ConfirmModal
          title={t("set.confirm.clearData.title")}
          message={t("set.confirm.clearData.body")}
          type="danger"
          confirmText={t("set.delete")}
          onConfirm={clearAppData}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {showLicenses && <LicenseModal onClose={() => setShowLicenses(false)} />}
    </div>
  );
}
