import { useSettings } from "../contexts/SettingsContext";
import { SwallowSlot } from "./SwallowSlot";
import { VmInfo, RemoteHost } from "../types";
import { Grid, Monitor, Maximize, Tv, Minimize2, Info, X } from "lucide-react";
import { getSlotCount } from "../lib/layout-utils";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/tauri-api";

const ONBOARDING_1X1_KEY = "hyperdesk-onboarding-1x1-seen";

interface MultiViewProps {
  data: { vms: VmInfo[]; remoteHosts: RemoteHost[] };
  isOverlayActive: boolean;
  onError: (msg: string) => void;
}

export function MultiView({ data, isOverlayActive, onError }: MultiViewProps) {
  const { settings, updateSettings } = useSettings();
  const [theaterMode, setTheaterMode] = useState(false);
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);
  const [showF11Hint, setShowF11Hint] = useState(false);
  const [isLayoutChanging, setIsLayoutChanging] = useState(false);
  const [show1x1Onboarding, setShow1x1Onboarding] = useState(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First time a user switches to the 1x1 layout, explain that the other 3
  // slot assignments aren't lost — Alt+1~4 still pages between them, Alt+0 returns to grid.
  useEffect(() => {
    if (settings.layout === "1x1" && !localStorage.getItem(ONBOARDING_1X1_KEY)) {
      setShow1x1Onboarding(true);
    }
  }, [settings.layout]);

  const dismiss1x1Onboarding = () => {
    localStorage.setItem(ONBOARDING_1X1_KEY, "1");
    setShow1x1Onboarding(false);
  };

  // Layout lock: when the grid layout, theater mode, or focused slot changes,
  // briefly freeze bounds sync so the swallowed window isn't moved against a
  // half-reflowed grid. The grid track change is now INSTANT (no CSS transition —
  // a Win32 child can't follow an animated track anyway), so we only need to span
  // the reflow + a couple frames, not a 0.4s animation. 60ms covers that; the
  // lock-release effect in SwallowSlot then does one sync to the final bounds.
  useEffect(() => {
    setIsLayoutChanging(true);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => {
      setIsLayoutChanging(false);
      lockTimerRef.current = null;
      // 150ms, not 60: the grid reflow + WebView2 recompute + mstsc smart-sizing WM_SIZE
      // round trip isn't done at 60ms, so the lock released mid-reflow and a half-
      // reflowed size (e.g. 957x1042 — half width, full height) got applied, pushing
      // mstsc partly off-slot (showing desktop). 150ms spans the settle.
    }, 150);
    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, [settings.layout, theaterMode, focusedSlotId]);

  // Handle F11 for OS fullscreen and Esc for theater mode cleanup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        handleToggleOSFullscreen();
      } else if (e.key === "Escape" && theaterMode) {
        setTheaterMode(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [theaterMode]);

  useEffect(() => {
    // Notify parent/body about theater mode for CSS hiding
    if (theaterMode) {
      document.body.classList.add("theater-active");
      setShowF11Hint(true);
    } else {
      document.body.classList.remove("theater-active");
    }

    const timer = theaterMode ? setTimeout(() => setShowF11Hint(false), 5000) : null;

    return () => {
      if (timer) clearTimeout(timer);
      document.body.classList.remove("theater-active");
    };
  }, [theaterMode]);

  // Listen for global hotkeys from Rust
  useEffect(() => {
    const unlisten = listen<string>("hotkey-focus", (event) => {
      const payload = event.payload;
      if (payload === "grid") {
        setFocusedSlotId(null);
      } else if (payload.startsWith("slot-")) {
        setFocusedSlotId(payload);
        // Forward Win32 keyboard focus to the swallowed window in the target slot
        api.focusSlotWindow(payload).catch(console.error);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleToggleOSFullscreen = async () => {
    try {
      await invoke("toggle_fullscreen");
    } catch (e) {
      onError(`전체화면 전환 실패: ${e}`);
    }
  };

  const handleUpdateSlot = (index: number, connectionId: string | null) => {
    const newAssignments = { ...settings.slotAssignments };
    if (connectionId) {
      newAssignments[index] = connectionId;
    } else {
      delete newAssignments[index];
    }
    updateSettings({ slotAssignments: newAssignments });
  };

  const slotCount = getSlotCount(settings.layout);

  // Explicit grid tracks, computed from layout/focus — NOT from the .layout-* CSS
  // class. The CSS class defines a fixed 2-col track even when fewer slots are
  // visible, so a display:none sibling settling in/out made the visible slot's
  // measured width oscillate full↔half (1856↔923) and the swallowed window juddered.
  // Driving the tracks inline from the known visible-slot geometry makes each slot's
  // size deterministic regardless of when siblings flip display:none.
  const gridStyle: React.CSSProperties = focusedSlotId || settings.layout === "1x1"
    ? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }
    : { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" };

  const renderLayoutControls = () => (
    <div className="layout-controls">
      <div className="control-group">
        <button
          className={settings.layout === "1x1" ? "active" : ""}
          onClick={() => { updateSettings({ layout: "1x1" }); setFocusedSlotId(null); }} title="1×1 (단일)"
        >
          <Maximize size={14} />
        </button>
        <button
          className={settings.layout === "2x2" ? "active" : ""}
          onClick={() => { updateSettings({ layout: "2x2" }); setFocusedSlotId(null); }} title="2×2 (쿼드 뷰)"
        >
          <Grid size={14} />
        </button>
      </div>

      <div className="control-divider" />

      <div className="control-group">
        {(theaterMode || focusedSlotId) && (
          <button
            className="grid-return-btn"
            onClick={() => { setTheaterMode(false); setFocusedSlotId(null); }}
            title="그리드로 돌아가기 (Alt+0)"
          >
            <Grid size={14} />
          </button>
        )}
        <button 
          className={theaterMode ? "active theater-btn" : "theater-btn"} 
          onClick={() => setTheaterMode(!theaterMode)}
          title={theaterMode ? "극장 모드 해제 (Esc)" : "극장 모드 활성화"}
        >
          {theaterMode ? <Minimize2 size={14} /> : <Tv size={14} />}
        </button>
        <button 
          className="fullscreen-btn"
          onClick={handleToggleOSFullscreen}
          title="OS 전체화면 전환 (F11)"
        >
          <Maximize size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`multiview-container ${theaterMode ? "theater-mode" : ""} ${focusedSlotId ? "has-focus" : ""}`}>
      {/* Hit zone: always rendered so hovering near top always reveals the header */}
      <div className="theater-hit-zone" />
      <div className="multiview-header">
        <h3>
          <Monitor size={16} /> 
          {theaterMode ? "전체화면 관제 시스템" : "멀티 뷰 관제 모드"}
          {focusedSlotId && <span className="focus-badge">FOCUS: {focusedSlotId}</span>}
        </h3>
        {renderLayoutControls()}
      </div>

      {showF11Hint && (
        <div className="f11-hint-overlay">
          <Info size={14} /> F11을 누르면 OS 전체화면으로 전환하여 더 넓게 볼 수 있습니다.
        </div>
      )}

      {show1x1Onboarding && (
        <div className="onboarding-hint-overlay">
          <Info size={14} />
          <span>1×1 모드에서도 다른 슬롯에 할당된 세션은 그대로 유지돼요. <kbd>Alt+1</kbd>~<kbd>4</kbd>로 전환, <kbd>Alt+0</kbd>으로 그리드 복귀할 수 있습니다.</span>
          <button onClick={dismiss1x1Onboarding} title="닫기"><X size={13} /></button>
        </div>
      )}

      <div
        className={`multiview-grid layout-${settings.layout} ${focusedSlotId ? "focus-grid" : ""}`}
        style={gridStyle}
      >
        {Array.from({ length: 4 }).map((_, i) => {
          const slotId = `slot-${i}`;
          const isFocused = focusedSlotId === slotId;
          
          // Determine if slot should be visible in current layout/focus mode
          const isVisible = focusedSlotId
            ? isFocused
            : i < slotCount;

          return (
            <SwallowSlot
              key={slotId}
              id={slotId}
              assignedId={settings.slotAssignments[i] || null}
              data={data}
              onAssign={(id) => handleUpdateSlot(i, id)}
              onError={onError}
              isFocused={isFocused}
              isVisible={isVisible}
              isOverlayActive={isOverlayActive}
              isSyncLocked={isLayoutChanging}
              onToggleFocus={() => setFocusedSlotId(isFocused ? null : slotId)}
            />
          );
        })}
      </div>
    </div>
  );
}
