import { useEffect, useState } from "react";
import { User, Bell, Sun, Moon, Monitor, Palette, Shield, RefreshCw, MonitorPlay, Keyboard, Database, FolderOpen, EyeOff, Trash2, Package } from "lucide-react";
import { useSettings } from "@/contexts/SettingsContext";
import { applyTheme } from "@/lib/theme";
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

const HOTKEYS: { keys: string; desc: string }[] = [
  { keys: "Alt + 1 ~ 4", desc: "멀티뷰 슬롯 전환" },
  { keys: "Ctrl + B", desc: "사이드 바 축소/확대" },
  { keys: "Ctrl + K", desc: "검색 모달 열기" },
];

interface SettingsPageProps {
  addToast: (message: string, type?: ToastType) => void;
}

export function SettingsPage({ addToast }: SettingsPageProps) {
  const { settings, updateSettings } = useSettings();
  const [confirmAction, setConfirmAction] = useState<"resetHidden" | "clearData" | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);

  const openDataDir = async () => {
    try {
      const path = await api.getDataDirPath();
      await navigator.clipboard.writeText(path);
      addToast("데이터 폴더 경로를 클립보드에 복사했습니다.", "info");
    } catch {
      addToast("경로를 가져오지 못했습니다.", "error");
    }
  };

  const resetHiddenHosts = async () => {
    try {
      await api.resetHiddenHosts();
      addToast("숨긴 자산을 모두 복원했습니다.", "success");
    } catch {
      addToast("초기화에 실패했습니다.", "error");
    } finally {
      setConfirmAction(null);
    }
  };

  const clearAppData = async () => {
    try {
      await api.clearAppData();
      addToast("저장된 자산/메모/태그 데이터를 모두 삭제했습니다. 앱을 재시작하세요.", "success");
    } catch {
      addToast("데이터 삭제에 실패했습니다.", "error");
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
          <div className="settings-group__head"><Palette size={15} /><h3>외관</h3></div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">테마</div>
              <div className="settings-row-desc">앱 전체 색상 모드</div>
            </div>
            <div className="settings-theme-strip">
              <button
                className={`settings-theme-btn ${settings.theme ==="dark" ? "active" : ""}`}
                onClick={() => { applyTheme("dark"); updateSettings({ theme: "dark" }); }}
              >
                <Moon size={13} /> 다크
              </button>
              <button
                className={`settings-theme-btn ${settings.theme ==="light" ? "active" : ""}`}
                onClick={() => { applyTheme("light"); updateSettings({ theme: "light" }); }}
              >
                <Sun size={13} /> 라이트
              </button>
              <button
                className={`settings-theme-btn ${settings.theme ==="retro" ? "active" : ""}`}
                onClick={() => { applyTheme("retro"); updateSettings({ theme: "retro" }); }}
                title="Windows 9x 레트로 (랜딩 페이지와 동일 결)"
              >
                <Monitor size={13} /> 레트로
              </button>
            </div>
          </div>
        </div>

        {/* ── 모니터링 & 자동화 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Bell size={15} /><h3>모니터링 &amp; 자동화</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">실시간 인벤토리 동기화</div>
              <div className="settings-row-desc">백그라운드에서 자산 상태를 추적합니다</div>
              <div
                className={`toggle-switch ${settings.autoRefresh ? "active" : ""}`}
                onClick={() => updateSettings({ autoRefresh: !settings.autoRefresh })}
              >
                <div className="toggle-knob" />
              </div>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">업데이트 주기</div>
              <div className="settings-row-desc">데이터 갱신 간격</div>
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
          <div className="settings-group__head"><MonitorPlay size={15} /><h3>연결</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">기본 접속 계정</div>
              <div className="settings-text-input">
                <input
                  type="text"
                  placeholder="Administrator"
                  value={settings.defaultUsername}
                  onChange={(e) => updateSettings({ defaultUsername: e.target.value })}
                />
                <User size={15} className="input-icon" />
              </div>
              <div className="settings-row-desc">신규 RDP 세션 생성 시 기본값으로 사용됩니다</div>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">RDP 색상 심도</div>
              <div className="settings-row-desc">높을수록 화질이 좋지만 대역폭을 더 사용합니다</div>
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
              <div className="settings-row-label">RDP 성능 모드</div>
              <div className="settings-row-desc">배경화면 · 테마 · 애니메이션 등 시각 효과를 조절해 응답성을 최적화합니다</div>
              <div className="settings-seg-row">
                {([
                  { id: "low", label: "저용량" },
                  { id: "balanced", label: "균형" },
                  { id: "high", label: "고화질" },
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
          <div className="settings-group__head"><Keyboard size={15} /><h3>단축키</h3></div>
          <div className="settings-fields">
            {HOTKEYS.map((h) => (
              <div className="settings-row col" key={h.keys}>
                <div className="settings-row-desc">{h.desc}</div>
                <kbd className="settings-kbd" style={{ alignSelf: "flex-start" }}>{h.keys}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* ── 데이터 관리 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Database size={15} /><h3>데이터 관리</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">데이터 저장 위치</div>
              <div className="settings-row-desc"><p>자산 · 메모 · 태그가 저장되는</p> 폴더 경로를 복사합니다</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={openDataDir}>
                <FolderOpen size={13} /> 경로 복사
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">숨긴 자산 초기화</div>
              <div className="settings-row-desc">목록에서 숨긴 모든 자산을 다시 표시합니다</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmAction("resetHidden")}>
                <EyeOff size={13} /> 초기화
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">저장 데이터 삭제</div>
              <div className="settings-row-desc"><p>수동 등록 자산, 메모, 태그를 모두</p> 삭제합니다 (되돌릴 수 없음)</div>
              <button className="hd-segment-btn hd-segment-btn--danger" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmAction("clearData")}>
                <Trash2 size={13} /> 삭제
              </button>
            </div>
          </div>
        </div>

        {/* ── 정보 ── */}
        <div className="settings-group">
          <div className="settings-group__head"><Shield size={15} /><h3>정보</h3></div>
          <div className="settings-fields">
            <div className="settings-row col">
              <div className="settings-row-label">HyperDesk</div>
              <div className="settings-row-desc">Tauri v2 · React 19 · Win32 SwallowGrid™</div>
              <span className="hd-sidebar__version" style={{ fontSize: "11px", alignSelf: "flex-start" }}>
                {appVersion ? `v${appVersion}` : "—"}
              </span>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">오픈소스 라이선스</div>
              <div className="settings-row-desc">HyperDesk가 사용하는 오픈소스 구성요소와 라이선스 고지</div>
              <button className="hd-segment-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowLicenses(true)}>
                <Package size={13} /> 라이선스 보기
              </button>
            </div>
            <div className="settings-row col">
              <div className="settings-row-label">업데이트</div>
              <div className="settings-row-desc">
                {updateState === "idle" && "최신 버전인지 확인합니다"}
                {updateState === "checking" && "확인 중..."}
                {updateState === "upToDate" && "최신 버전을 사용하고 있습니다"}
                {updateState === "available" && `새 버전 v${updateVersion} 사용 가능 — Microsoft Store에서 업데이트해주세요`}
                {updateState === "error" && "확인할 수 없습니다 (네트워크 오류)"}
              </div>
              {updateState === "available" ? (
                <a
                  className="hd-btn"
                  style={{ alignSelf: "flex-start" }}
                  href={MS_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <RefreshCw size={13} /> Store에서 업데이트
                </a>
              ) : (
                <button
                  className="hd-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={handleCheckUpdate}
                  disabled={updateState === "checking"}
                >
                  <RefreshCw size={13} /> 업데이트 확인
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {confirmAction === "resetHidden" && (
        <ConfirmModal
          title="숨긴 자산 초기화"
          message="숨겨둔 모든 자산이 목록에 다시 표시됩니다. 계속할까요?"
          type="info"
          confirmText="초기화"
          onConfirm={resetHiddenHosts}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "clearData" && (
        <ConfirmModal
          title="저장 데이터 삭제"
          message="수동 등록한 자산, VM 메모, 태그 데이터가 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
          type="danger"
          confirmText="삭제"
          onConfirm={clearAppData}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {showLicenses && <LicenseModal onClose={() => setShowLicenses(false)} />}
    </div>
  );
}
