import { useEffect, useState } from "react";
import { User, Bell, Sun, Moon, Monitor, Palette, Shield, MonitorPlay, Keyboard, Database, Copy, Eye, Trash2, Package, Languages, Link2 } from "lucide-react";
import { useSettings, POLL_MIN_SEC, POLL_MAX_SEC } from "@/contexts/SettingsContext";
import { applyTheme } from "@/lib/theme";
import { useT, LANGS, LANG_LABEL, type Key } from "@/lib/i18n";
import { api } from "@/lib/tauri-api";
import type { ToastType } from "@/hooks/useToast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LicenseModal } from "@/components/LicenseModal";

const HOTKEYS: { keys: string; descKey: Key }[] = [
  { keys: "Alt + 1 ~ 4", descKey: "set.hotkey.slots" },
  { keys: "Ctrl + B", descKey: "set.hotkey.sidebar" },
  { keys: "Ctrl + K", descKey: "set.hotkey.search" },
  { keys: "F11", descKey: "set.hotkey.fullscreen" },
  { keys: "Esc", descKey: "set.hotkey.escape" },
];

interface SettingsPageProps {
  addToast: (message: string, type?: ToastType) => void;
}

export function SettingsPage({ addToast }: SettingsPageProps) {
  const { settings, updateSettings } = useSettings();
  const t = useT();
  const [confirmAction, setConfirmAction] = useState<"resetHidden" | "clearData" | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);

  // 입력 중엔 문자열 그대로 두고(지우고 다시 쓰는 중간 상태가 있다) 칸을 벗어날 때 범위로
  // 맞춰 저장한다. 예전엔 입력마다 바로 저장해서, 칸을 비우면 0(= 갱신이 조용히 멈춤),
  // 1을 치면 1초마다 Hyper-V를 조회했다.
  const [intervalDraft, setIntervalDraft] = useState(String(settings.pollingInterval / 1000));
  useEffect(() => { setIntervalDraft(String(settings.pollingInterval / 1000)); }, [settings.pollingInterval]);
  const commitInterval = () => {
    const n = intervalDraft.trim() === "" ? NaN : Math.round(Number(intervalDraft));
    const sec = Number.isFinite(n)
      ? Math.min(POLL_MAX_SEC, Math.max(POLL_MIN_SEC, n))
      : settings.pollingInterval / 1000;
    setIntervalDraft(String(sec));
    updateSettings({ pollingInterval: sec * 1000 });
  };

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

  // null = 아직 모름(조회 전) — 그동안은 행을 그리지 않는다.
  const [rdpLinked, setRdpLinked] = useState<boolean | null>(null);
  useEffect(() => {
    api.rdpLinkRegistered().then(setRdpLinked).catch(() => setRdpLinked(null));
  }, []);
  const toggleRdpLink = async (enable: boolean) => {
    try {
      await api.setRdpLink(enable);
      setRdpLinked(await api.rdpLinkRegistered());
      addToast(t(enable ? "set.toast.rdpLinkAdded" : "set.toast.rdpLinkRemoved"), "success");
    } catch (e) {
      addToast(t("set.toast.rdpLinkFailed", { err: String(e) }), "error");
    }
  };

  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

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
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoRefresh}
                aria-label={t("set.liveSync")}
                className={`toggle-switch ${settings.autoRefresh ? "active" : ""}`}
                onClick={() => updateSettings({ autoRefresh: !settings.autoRefresh })}
              >
                <div className="toggle-knob" />
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.interval")}</div>
              <div className="settings-row-desc">{t("set.intervalDesc")}</div>
              {/* 자동 새로고침이 꺼져 있으면 간격은 아무 의미가 없다 — 바꿀 수 있어 보이면 안 된다. */}
              <div className={`settings-number-input${settings.autoRefresh ? "" : " is-disabled"}`}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={POLL_MIN_SEC}
                  max={POLL_MAX_SEC}
                  aria-label={t("set.interval")}
                  disabled={!settings.autoRefresh}
                  value={intervalDraft}
                  onChange={(e) => setIntervalDraft(e.target.value)}
                  onBlur={commitInterval}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
                <span>{t("set.seconds")}</span>
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
              {/* 설명이 입력칸보다 먼저 온다 — 다른 칸과 순서가 같아야
                  (라벨 → 설명 → 컨트롤) 컨트롤 줄이 가로로 정렬된다. */}
              <div className="settings-row-desc">{t("set.defaultAccountDesc")}</div>
              <div className="settings-text-input">
                <input
                  type="text"
                  placeholder="Administrator"
                  value={settings.defaultUsername}
                  onChange={(e) => updateSettings({ defaultUsername: e.target.value })}
                />
                <User size={15} className="input-icon" />
              </div>
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
            {/* `rdp:` 링크 선택지 등록. 해제하면 다음 실행에도 다시 등록하지 않는다.
                Store 설치본은 패키지 선언으로 등록돼 여기서 끌 수 없다(앱 제거 시 정리). */}
            {rdpLinked !== null && (
              <div className="settings-row col">
                <div className="settings-row-label">{t("set.rdpLink")}</div>
                <div className="settings-row-desc">{t(rdpLinked ? "set.rdpLinkDescOn" : "set.rdpLinkDescOff")}</div>
                <button
                  className={`hd-segment-btn ${rdpLinked ? "hd-segment-btn--danger" : ""}`}
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => toggleRdpLink(!rdpLinked)}
                >
                  {rdpLinked ? <><Trash2 size={13} /> {t("set.rdpLink.remove")}</> : <><Link2 size={13} /> {t("set.rdpLink.add")}</>}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── 단축키 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Keyboard size={15} /><h3>{t("set.hotkeys")}</h3></div>
          <div className="settings-fields">
            {HOTKEYS.map((h) => (
              <div className="settings-row col" key={h.keys}>
                {/* 다른 그룹과 같은 굵기의 라벨 — 여긴 설명이 곧 항목 이름이다. */}
                <div className="settings-row-label">{t(h.descKey)}</div>
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
                <Copy size={13} /> {t("set.copyPath")}
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">{t("set.resetHidden")}</div>
              <div className="settings-row-desc">{t("set.resetHiddenDesc")}</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmAction("resetHidden")}>
                <Eye size={13} /> {t("set.reset")}
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
