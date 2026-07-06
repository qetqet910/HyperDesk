import { useSettings } from "@/contexts/SettingsContext";
import { SwallowSlot } from "@/components/SwallowSlot";
import { VmInfo, RemoteHost } from "@/types";
import { Maximize, Expand, Shrink } from "lucide-react";
import { useState, useEffect, useRef } from "react";
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
  // toggle desyncs them and the fixed overlay is left floating over a non-
  // fullscreen window (the "화면 고장" bug).
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
            onClick={() => setActiveSlot(i)}
            title={`슬롯 ${i + 1} (Alt+${i + 1})`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="control-divider" />
      <div className="control-group">
        <button
          className={isImmersive ? "active" : ""}
          onClick={handleToggleImmersive}
          title={isImmersive ? "VM 전체화면 해제" : "VM 전체화면 (앱 UI 숨김)"}
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
            />
          );
        })}
      </div>
    </div>
  );
}
