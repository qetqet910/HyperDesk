import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/tauri-api";
import { useT, type Key } from "@/lib/i18n";
import type { HyperVEvent } from "@/types";

interface EventsPageProps {
  logs: { id: string; msg: string; type: string; time: string }[];
  onClear: () => void;
}

// 로그 종류 태그. 표에 없는 값은 원문을 대문자로 찍는다.
const LEVEL_KEY: Record<string, Key> = {
  info: "level.info", success: "level.success", error: "level.error", warn: "level.warn",
};

export function EventsPage({ logs, onClear }: EventsPageProps) {
  const t = useT();
  const levelTag = (level: string) => `[${LEVEL_KEY[level] ? t(LEVEL_KEY[level]) : level.toUpperCase()}]`;
  const [hyperVEvents, setHyperVEvents] = useState<HyperVEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  const loadHyperVEvents = async () => {
    setLoadingEvents(true);
    setEventError(null);
    try {
      const events = await api.getHyperVEvents(50);
      setHyperVEvents(events);
    } catch (e) {
      setEventError(String(e));
    } finally {
      setLoadingEvents(false);
    }
  };

  // 페이지를 열면 바로 불러온다 — 예전엔 빈 칸에 "버튼을 누르라"는 안내만 있었다.
  useEffect(() => { loadHyperVEvents(); }, []);

  return (
    <div className="dashboard-grid">
      <div className="section-label" style={{ gridColumn: "1 / -1" }}>
        <h3>{t("events.heading")}</h3>
        <div className="section-line" />
      </div>

      {/* Hyper-V 시스템 이벤트 섹션 */}
      <div className="bento-cell cell-4x2" style={{ gridColumn: "1 / -1", padding: "0", display: "flex", flexDirection: "column", marginBottom: "8px" }}>
        <div className="terminal-header" style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)" }}>{t("events.hyperv")}</span>
          <button
            className="hd-btn hd-btn--small"
            onClick={loadHyperVEvents}
            disabled={loadingEvents}
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <RefreshCw size={11} className={loadingEvents ? "spinning" : ""} />
            {t("events.load")}
          </button>
        </div>
        <div style={{ padding: "16px", minHeight: "80px" }}>
          {loadingEvents && (
            <div style={{ textAlign: "center", opacity: 0.5, fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <RefreshCw size={13} className="spinning" /> {t("events.loading")}
            </div>
          )}
          {eventError && (
            <div style={{ fontSize: "11px", color: "var(--accent-red)", opacity: 0.8 }}>{eventError}</div>
          )}
          {!loadingEvents && !eventError && hyperVEvents.length === 0 && (
            <div style={{ textAlign: "center", opacity: 0.5, fontSize: "11px" }}>
              {t("events.empty")}
            </div>
          )}
          {hyperVEvents.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "200px", overflowY: "auto" }}>
              {hyperVEvents.map((evt, i) => (
                <div key={i} style={{ display: "flex", gap: "12px", fontSize: "11px", fontFamily: "monospace", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0, width: "140px" }}>{evt.time_created}</span>
                  <span className={`log-tag ${evt.level}`} style={{ width: "60px", textAlign: "center", flexShrink: 0 }}>{levelTag(evt.level)}</span>
                  {/* 한 줄로 자르되 전체 문장은 마우스를 올리면 보인다. */}
                  <span title={evt.message} style={{ color: evt.level === "error" ? "var(--accent-red)" : evt.level === "warn" ? "var(--accent-orange)" : "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    [{evt.event_id}] {evt.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 앱 내부 로그 */}
      <div className="bento-cell cell-4x2" style={{ gridColumn: "1 / -1", padding: "0", display: "flex", flexDirection: "column", height: "400px" }}>
        <div className="terminal-header" style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)" }}>{t("events.app")}</span>
          <button className="hd-btn hd-btn--small" onClick={onClear} disabled={logs.length === 0}>{t("events.clear")}</button>
        </div>
        <div className="terminal-logs" style={{ flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          {logs.length > 0 ? logs.map(log => (
            <div key={log.id} style={{ display: "flex", gap: "12px", fontSize: "12px", fontFamily: "monospace" }}>
              <span style={{ color: "var(--text-muted)", width: "70px", flexShrink: 0 }}>{log.time}</span>
              <span className={`log-tag ${log.type}`} style={{ width: "80px", textAlign: "center", flexShrink: 0 }}>{levelTag(log.type)}</span>
              <span style={{ color: log.type === "error" ? "var(--accent-red)" : "var(--text-main)" }}>{log.msg}</span>
            </div>
          )) : (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.5 }}>{t("events.noLogs")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
