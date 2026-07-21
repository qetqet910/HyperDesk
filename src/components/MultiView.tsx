import { useSettings } from "@/contexts/SettingsContext";
import { SwallowSlot } from "@/components/SwallowSlot";
import { VmInfo, RemoteHost } from "@/types";
import { Expand, Shrink, Maximize } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri-api";

const SLOT_COUNT = 4;

interface MultiViewProps {
  data: { vms: VmInfo[]; remoteHosts: RemoteHost[] };
  isOverlayActive: boolean;
  onError: (msg: string) => void;
}

// Single-slot view: all 4 slots stay mounted so their swallowed sessions persist,
// but only the active one is visible. Alt+1~4 pages between them (handled in Rust,
// arrives as the "hotkey-focus" event). There is no grid / theater / focus mode.
export function MultiView({ data, isOverlayActive, onError }: MultiViewProps) {
  const { settings, updateSettings } = useSettings();
  const [activeSlot, setActiveSlot] = useState(0);
  // Immersive: VM view fills the ENTIRE screen (OS fullscreen + container overlays
  // the app chrome; the slot header floats absolute UNDER the VM surface → the
  // remote gets the native resolution). Pushing the cursor to the top screen edge
  // makes the Rust cursor poller crop the VM's top band (SetWindowRgn), letting
  // the header show through and take clicks — the VM never moves or resizes.
  const [isImmersive, setIsImmersive] = useState(false);
  // Whether the top-edge reveal is active (Rust cursor poller emits "immersive-edge").
  // Drives the header's slide-in animation; the native crop itself is instant.
  const [edgeRevealed, setEdgeRevealed] = useState(false);
  // Briefly freeze bounds sync right after a slot switch or immersive toggle so the
  // swallowed window isn't moved against a half-reflowed container.
  const [isSwitching, setIsSwitching] = useState(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Connect-lock: while any slot has a connect in flight, slot switching is
  // frozen (Alt+1~4 + header buttons + immersive). Switching mid-swallow made
  // the embed stutter or break — bounds sync ran against a hidden slot while
  // mstsc/vmconnect was still being captured. The slot's own "연결 취소" button
  // stays available as the escape hatch.
  const [connectingSlots, setConnectingSlots] = useState<Record<string, boolean>>({});
  const anyConnecting = Object.values(connectingSlots).some(Boolean);
  const anyConnectingRef = useRef(false);
  useEffect(() => { anyConnectingRef.current = anyConnecting; }, [anyConnecting]);
  const handleConnectingChange = useCallback((slotId: string, connecting: boolean) => {
    setConnectingSlots(prev => (prev[slotId] === connecting ? prev : { ...prev, [slotId]: connecting }));
  }, []);
  // Mirrors `anyConnecting` into Rust (lib.rs's Alt+1~4 handler has no visibility
  // into React state otherwise, so it kept force-focusing a mid-connect slot's
  // native window regardless of this lock). Cleared unconditionally on unmount
  // so navigating away mid-connect can never leave the native side stuck locked.
  useEffect(() => { api.setConnectLock(anyConnecting).catch(console.error); }, [anyConnecting]);
  useEffect(() => {
    return () => { api.setConnectLock(false).catch(console.error); };
  }, []);

  useEffect(() => {
    const unlisten = listen<boolean>("immersive-edge", (e) => setEdgeRevealed(e.payload));
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    setIsSwitching(true);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => {
      setIsSwitching(false);
      lockTimerRef.current = null;
    }, 150);
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [activeSlot, isImmersive]);

  // On slot switch while immersive, pop the header for ~1s so the user can see
  // which slot is now active (the header's 1~4 highlight) — otherwise the switch
  // is invisible (VM fills the screen, header hidden).
  useEffect(() => {
    if (isImmersive) api.flashImmersiveHeader(1000).catch(console.error);
  }, [activeSlot]);

  // Leaving the multiview (unmount) while immersive must restore the OS window —
  // but only then; an F11 fullscreen the user chose themselves is left alone.
  const immersiveRef = useRef(false);
  // Tracks plain OS fullscreen (F11, not immersive) so ESC knows to exit it.
  const fullscreenRef = useRef(false);
  useEffect(() => { immersiveRef.current = isImmersive; }, [isImmersive]);
  useEffect(() => {
    return () => {
      if (immersiveRef.current) {
        api.setImmersive(false).catch(console.error);
        api.setFullscreen(false).catch(console.error);
      }
    };
  }, []);

  // Both handlers read immersiveRef.current (not the isImmersive closure) so the
  // F11 keydown effect — registered once with [] deps — never acts on a stale
  // value. Immersive and OS-fullscreen must stay in sync: immersive IS OS
  // fullscreen (+ overlay + auto-hide header), so a second independent fullscreen
  // toggle desyncs them and leaves the fixed overlay floating over a non-
  // fullscreen window. apply_fullscreen (commands.rs) now compensates for the
  // invisible DWM resize-border margin around the borderless window, so this no
  // longer shifts the app off the monitor edge the way it used to.
  const handleToggleImmersive = () => {
    const next = !immersiveRef.current;
    immersiveRef.current = next;
    setIsImmersive(next);
    api.setImmersive(next).catch(console.error);
    api.setFullscreen(next).catch(console.error);
  };

  // F11 toggles OS fullscreen — but while immersive, it exits immersive (which
  // already owns the fullscreen state) instead of toggling OS fullscreen under it.
  // ESC always exits fullscreen/immersive (both read the current state via refs).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        handleToggleOSFullscreen();
      } else if (e.key === "Escape") {
        if (anyConnectingRef.current) return; // connect-lock: no state changes mid-swallow
        if (immersiveRef.current) {
          handleToggleImmersive(); // exits immersive + fullscreen
        } else if (fullscreenRef.current) {
          handleToggleOSFullscreen(); // plain OS fullscreen off
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Alt+1~4 from Rust → switch the visible slot and forward Win32 focus to it.
  useEffect(() => {
    const unlisten = listen<string>("hotkey-focus", (event) => {
      const m = /^slot-(\d+)$/.exec(event.payload);
      if (!m) return;
      const idx = Number(m[1]);
      if (anyConnectingRef.current) return; // connect-lock: no switching mid-swallow
      if (idx >= 0 && idx < SLOT_COUNT) {
        setActiveSlot(idx);
        api.focusSlotWindow(event.payload).catch(console.error);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleToggleOSFullscreen = async () => {
    // While immersive, the window is already fullscreen and the overlay owns the
    // layout — a raw toggle_fullscreen here would flip the OS state out from under
    // it and desync. So treat it as "exit immersive" instead.
    if (immersiveRef.current) {
      handleToggleImmersive();
      return;
    }
    try {
      await invoke("toggle_fullscreen");
      fullscreenRef.current = !fullscreenRef.current;
    } catch (e) {
      onError(`전체화면 전환 실패: ${e}`);
    }
  };

  const handleUpdateSlot = (index: number, connectionId: string | null) => {
    const newAssignments = { ...settings.slotAssignments };
    if (connectionId) newAssignments[index] = connectionId;
    else delete newAssignments[index];
    updateSettings({ slotAssignments: newAssignments });
  };

  // Slot switcher + fullscreen toggle, rendered INSIDE the active slot's 36px
  // header bar. Deliberately NOT a separate header: a second bar floating over
  // the slot's own header was the "duplicated header" bug, and any HTML below
  // the 36px band is physically covered by the swallowed Win32 window anyway.
  const headerControls = (
    <>
      <div className="control-group">
        {Array.from({ length: SLOT_COUNT }).map((_, i) => (
          <button
            key={i}
            className={activeSlot === i ? "active" : ""}
            disabled={anyConnecting && activeSlot !== i}
            onClick={() => setActiveSlot(i)}
            title={anyConnecting && activeSlot !== i ? "연결 중에는 슬롯을 전환할 수 없습니다" : `슬롯 ${i + 1} (Alt+${i + 1})`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="control-divider" />
      <div className="control-group">
        <button
          className={isImmersive ? "active" : ""}
          disabled={anyConnecting}
          onClick={handleToggleImmersive}
          title={anyConnecting ? "연결 중에는 전환할 수 없습니다" : isImmersive ? "VM 전체화면 해제" : "VM 전체화면 (앱 UI 숨김)"}
        >
          {isImmersive ? <Shrink size={14} /> : <Expand size={14} />}
        </button>
        {/* OS-fullscreen toggle is hidden while immersive — immersive already IS
            fullscreen, and a second toggle desyncs the two (Shrink exits). */}
        {!isImmersive && (
          <button onClick={handleToggleOSFullscreen} title="창 전체화면 전환 (F11)">
            <Maximize size={14} />
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className={`multiview-container ${isImmersive ? "immersive" : ""} ${isImmersive && edgeRevealed ? "edge-revealed" : ""}`}>
      <div className="multiview-grid" style={{ gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }}>
        {Array.from({ length: SLOT_COUNT }).map((_, i) => {
          const slotId = `slot-${i}`;
          return (
            <SwallowSlot
              key={slotId}
              id={slotId}
              assignedId={settings.slotAssignments[i] || null}
              data={data}
              onAssign={(id) => handleUpdateSlot(i, id)}
              onError={onError}
              isVisible={activeSlot === i}
              isOverlayActive={isOverlayActive}
              isSyncLocked={isSwitching}
              headerControls={headerControls}
              onConnectingChange={handleConnectingChange}
            />
          );
        })}
      </div>
    </div>
  );
}
