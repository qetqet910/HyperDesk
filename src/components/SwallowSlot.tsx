import { useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { Globe, Plus, X, RefreshCw, Terminal, AlertCircle, ZapOff, ChevronDown, Monitor } from "lucide-react";
import { api } from "../lib/tauri-api";
import { VmInfo, RemoteHost } from "../types";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../contexts/SettingsContext";

interface SwallowSlotProps {
  id: string;
  assignedId: string | null;
  data: { vms: VmInfo[]; remoteHosts: RemoteHost[] };
  onAssign: (connectionId: string | null) => void;
  onError: (msg: string) => void;
  isVisible: boolean;
  isOverlayActive: boolean;
  isSyncLocked?: boolean;
  /** MultiView's slot switcher/fullscreen controls, rendered inside the 36px
      header bar. Keeping them here (not in a second floating header) is what
      guarantees a single header over the VM — see .slot-header-bar in App.css. */
  headerControls?: ReactNode;
}

export function SwallowSlot({ id, assignedId, data, onAssign, onError, isVisible, isOverlayActive, isSyncLocked, headerControls }: SwallowSlotProps) {
  // contentRef points to slot-content-area (below the fixed 36px header bar).
  // syncBounds and handleConnect both measure this div so the Win32 window
  // is positioned to fill exactly the content area, never under the header.
  const contentRef = useRef<HTMLDivElement>(null);
  const [isSwallowed, setIsSwallowed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { settings } = useSettings();

  // Keep refs in sync so the integrity-poll interval closure always reads current values.
  useEffect(() => { assignedIdRef.current = assignedId; }, [assignedId]);
  useEffect(() => { isConnectingRef.current = isConnecting; }, [isConnecting]);
  useEffect(() => { isSwallowedRef.current = isSwallowed; }, [isSwallowed]);
  const [showSelector, setShowSelector] = useState(false);
  const [isGlitched, setIsGlitched] = useState(false);
  const [isActuallyHidden, setIsActuallyHidden] = useState(!isVisible);

  // Use Refs for logic control to avoid infinite re-render loops
  const retryCountRef = useRef(0);
  const lastSyncRef = useRef<number>(0);
  const lastBoundsRef = useRef({ x: -1, y: -1, w: -1, h: -1 });
  const prevSyncLockedRef = useRef<boolean>(!!isSyncLocked);
  // Mirrors of state/prop values kept current via useEffect so that
  // the 5-second integrity poll interval closure never reads stale data.
  const assignedIdRef = useRef(assignedId);
  const isConnectingRef = useRef(false);
  const isSwallowedRef = useRef(false);

  const selectedConnection = assignedId
    ? (data.vms.find(v => v.name === assignedId) || data.remoteHosts.find(h => h.id === assignedId))
    : null;

  // Split remote hosts for the selector: VDI (Horizon/Omnissa) goes under "가상 머신"
  // with the Hyper-V VMs; everything else (RDP) stays under "원격 데스크톱".
  const vdiHosts = data.remoteHosts.filter(h => h.protocol === "HORIZON");
  const rdpHosts = data.remoteHosts.filter(h => h.protocol !== "HORIZON");

  // Listen for backend events (window-closed, swallow-success, swallow-failure).
  // Deps are [id] only — event handlers read current values via refs so the
  // listener is registered once and never torn down due to state churn.
  useEffect(() => {
    const unlistenClosed = listen<string>("window-closed", (event) => {
      if (event.payload === id) {
        setIsSwallowed(false);
        setIsGlitched(true);
        setIsConnecting(false);
      }
    });

    const unlistenSuccess = listen<string>("swallow-success", (event) => {
      if (event.payload === id) {
        setIsSwallowed(true);
        setIsConnecting(false);
        setIsGlitched(false);
        retryCountRef.current = 0;

        // Immediate sync to lock position before stabilization
        syncBounds();

        // Stabilization delay to let RDP/VDI window styles settle and header to render
        setTimeout(() => syncBounds(), 250);
      }
    });

    // Horizon: the launcher/auth window is swallowed before the session window
    // exists (up to ~20s of login). Flip to swallowed state now so the auth
    // window follows slot resizes (the [isSwallowed] bounds effect does the
    // initial sync); swallow-success later replaces it in place.
    const unlistenProgress = listen<string>("swallow-progress", (event) => {
      if (event.payload === id) {
        setIsSwallowed(true);
        setIsGlitched(false);
      }
    });

    const unlistenFailure = listen<string>("swallow-failure", (event) => {
      if (event.payload === id) {
        console.error(`[Slot ${id}] Swallow Failure received`);
        setIsConnecting(false);
        setIsGlitched(true);
      }
    });

    return () => {
      unlistenClosed.then(f => f());
      unlistenSuccess.then(f => f());
      unlistenProgress.then(f => f());
      unlistenFailure.then(f => f());
      // Hide native window when slot component unmounts (e.g. page change)
      // This prevents the window from floating over other pages.
      api.setWindowVisibility(id, false).catch(console.error);
    };
  }, [id]);

  // Check status on mount or assignment change
  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const isValid = await api.isWindowValid(id);
        if (mounted && isValid) {
          setIsSwallowed(true);
          setIsGlitched(false);
          retryCountRef.current = 0;
        }
      } catch (e) {
        console.error("Check status failed", e);
      }
    };
    checkStatus();
    return () => { mounted = false; };
  }, [id, assignedId]);

  const syncBounds = useCallback(async () => {
    if (!contentRef.current || !assignedId || !isSwallowed || isSyncLocked || isActuallyHidden) return;

    const now = Date.now();
    if (now - lastSyncRef.current < 16) return; // ~60fps throttle
    lastSyncRef.current = now;

    // contentRef points to slot-content-area (below the fixed header bar).
    // The Win32 window fills only this area, so no header-height offset is needed here.
    const rect = contentRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const nextX = Math.floor(rect.x * dpr);
    const nextY = Math.floor(rect.y * dpr);
    const nextW = Math.floor(rect.width * dpr);
    const nextH = Math.floor(rect.height * dpr);

    const prev = lastBoundsRef.current;

    // SYNC_THRESHOLD: Ignore changes smaller than 2px to prevent infinite "creeping" loops
    const threshold = 2;
    if (Math.abs(prev.x - nextX) < threshold &&
        Math.abs(prev.y - nextY) < threshold &&
        Math.abs(prev.w - nextW) < threshold &&
        Math.abs(prev.h - nextH) < threshold &&
        prev.x !== -1) {
      return;
    }

    lastBoundsRef.current = { x: nextX, y: nextY, w: nextW, h: nextH };

    try {
      await api.syncSlotBounds(id, nextX, nextY, nextW, nextH);
    } catch (e) {
      console.error("Sync bounds failed", e);
    }
  }, [id, assignedId, isSwallowed, isSyncLocked, isActuallyHidden]);

  // Sync bounds on resize or scroll — single ResizeObserver, single set of listeners
  useEffect(() => {
    if (!isSwallowed || isActuallyHidden) return;

    // NOTE: do NOT reset lastBoundsRef to -1 here. This effect re-runs on every
    // isActuallyHidden flip; resetting the cache each time defeats the 2px threshold
    // in syncBounds, forcing an unconditional sync at whatever width the DOM shows
    // that frame — which during a sibling's display:none flicker is full vs half,
    // making the swallowed window oscillate (1856↔923). The explicit rAF sync below
    // already covers the first measurement after (re)mount.

    const observer = new ResizeObserver(() => {
      // rAF ensures DOM reflow has settled before measuring
      requestAnimationFrame(() => syncBounds());
    });

    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);

    // Dragging the app between monitors with different scaling changes
    // devicePixelRatio WITHOUT firing 'resize' (window px size can be
    // unchanged), so the dpr-scaled bounds would go stale and the swallowed
    // window mis-sizes on the new monitor. matchMedia on the current dpr is the
    // native way to observe that change; re-arm it each time it fires since the
    // resolution threshold itself moved.
    let dprMql: MediaQueryList | null = null;
    const onDprChange = () => {
      lastBoundsRef.current = { x: -1, y: -1, w: -1, h: -1 };
      requestAnimationFrame(() => syncBounds());
      armDprListener();
    };
    const armDprListener = () => {
      dprMql?.removeEventListener("change", onDprChange);
      dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprMql.addEventListener("change", onDprChange);
    };
    armDprListener();

    // Defer the initial sync to the next frame so getBoundingClientRect()
    // measures after layout (avoids zero-size rects on first mount).
    const rafId = requestAnimationFrame(() => syncBounds());

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
      dprMql?.removeEventListener("change", onDprChange);
    };
  }, [isSwallowed, syncBounds, isActuallyHidden]);

  // When isSyncLocked transitions from true → false, the cached bounds may be
  // stale (the slot can shift while sync is locked). Invalidate the cache and
  // force a fresh sync so the swallowed window catches up. If the slot is also
  // visible (DOM unhidden) but the Win32 child was held hidden because the
  // visibility flip happened mid-lock, reveal it here so it appears at the
  // correct bounds in a single frame instead of flashing at the stale position.
  useEffect(() => {
    const wasLocked = prevSyncLockedRef.current;
    prevSyncLockedRef.current = !!isSyncLocked;
    if (wasLocked && !isSyncLocked && isSwallowed && !isActuallyHidden) {
      // Do NOT reset lastBoundsRef to -1 — that disables the 2px threshold and applies
      // whatever transient (mid-reflow) bounds this single frame holds, which during a
      // layout transition is a half-reflowed size → the (61,79)↔(1,37) coordinate
      // judder. syncBounds already syncs when the bounds genuinely changed.
      requestAnimationFrame(() => {
        syncBounds();
        const effectiveVisibility = isVisible && !showSelector && !isOverlayActive;
        if (effectiveVisibility) {
          api.setWindowVisibility(id, true).catch(console.error);
        }
      });
    }
  }, [isSyncLocked, isSwallowed, isActuallyHidden, syncBounds, id, isVisible, showSelector, isOverlayActive]);

  // Visibility handling with handshake. The Win32 child sits above the WebView2
  // renderer, so we must coordinate React DOM state with Rust ShowWindow calls.
  // Hide: Rust hides → React unmounts. Show: React mounts → reflow → Rust shows.
  // If a layout transition is in progress (isSyncLocked), defer the Rust
  // setVisibility(true) call to the lock-release effect above so the child
  // appears at the post-transition bounds instead of flashing at stale bounds.
  useEffect(() => {
    let mounted = true;
    const updateVisibility = async () => {
      // The CSS-hidden flag (.slot-hidden, drives the grid display:none) must track
      // isVisible regardless of swallow state — an empty/unassigned slot has nothing
      // for Rust to hide, but it still needs to leave the CSS grid flow or it lingers
      // as an extra implicit row when the layout shrinks (e.g. 2x2 -> 1x1).
      // showSelector/isOverlayActive only matter for hiding the swallowed Win32
      // child behind modals — an unassigned slot has no native window to hide,
      // and folding them into its visibility here would display:none the slot
      // (and the selector panel rendered inside it) the instant it opens.
      if (!isSwallowed) {
        if (mounted) setIsActuallyHidden(!isVisible);
        return;
      }
      const effectiveVisibility = isVisible && !showSelector && !isOverlayActive;
      if (!effectiveVisibility) {
        await api.setWindowVisibility(id, false).catch(console.error);
        if (mounted) setIsActuallyHidden(true);
      } else {
        if (mounted) setIsActuallyHidden(false);
        if (isSyncLocked) {
          // Defer to lock-release effect; it will sync bounds and then show.
          return;
        }
        // Sync the Win32 child to the slot's CURRENT bounds while it is still
        // hidden off-screen, THEN reveal — so it appears at the correct position
        // in one frame instead of flashing at the previous (stale) position and
        // jumping. Mirrors the proven sync-then-show order in the lock-release
        // effect above. (update_position is a no-op while hidden, so this just
        // refreshes the stored bounds; setWindowVisibility then shows there.)
        requestAnimationFrame(async () => {
          if (!mounted) return;
          // No lastBoundsRef=-1 reset here either — see lock-release effect. syncBounds
          // already syncs on a real change; forcing it applied mid-reflow bounds.
          await syncBounds();
          if (mounted) api.setWindowVisibility(id, true).catch(console.error);
        });
      }
    };
    updateVisibility();
    return () => { mounted = false; };
  }, [isSwallowed, id, isVisible, showSelector, isOverlayActive, isSyncLocked]);


  // Redundant safety heartbeat — 5s interval. Uses refs so the closure never
  // captures stale state and the effect never needs to re-register.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!assignedIdRef.current || isConnectingRef.current) return;
      try {
        const isValid = await api.isWindowValid(id);
        if (isValid && !isSwallowedRef.current) {
          setIsSwallowed(true);
          setIsGlitched(false);
          retryCountRef.current = 0;
        } else if (!isValid && isSwallowedRef.current) {
          setIsSwallowed(false);
          setIsGlitched(true);
        }
      } catch (e) {
        console.error("Integrity check failed", e);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleConnect = async (conn: VmInfo | RemoteHost) => {
    setIsConnecting(true);
    setIsGlitched(false);
    // Tear down any existing session first so a re-assign doesn't stack a second mstsc.
    if (isSwallowedRef.current) {
      await api.unswallowWindow(id).catch(console.error);
    }
    try {
      const rect = contentRef.current!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const slotW = Math.round(rect.width * dpr);
      const slotH = Math.round(rect.height * dpr);

      let pid: number;
      if ("state" in conn) { // VmInfo
        const ip = conn.ip_addresses?.find((a) => a && a.trim()) ?? "";
        if (ip) {
          // VM reports a reachable IP → RDP. mstsc's TscShellContainerClass IS the
          // session view, so it swallows clean with no surrounding chrome.
          pid = await api.connectVm(ip, "RDP", undefined, slotW, slotH, settings.rdpColorDepth, settings.rdpQuality);
        } else {
          // No IP (fresh/Linux VM, integration services not reporting yet) →
          // Hyper-V console. NEVER fall back to "localhost" — that RDP'd the HOST
          // itself and failed with 0x708 (console session already in use).
          // NOTE: vmconnect carries its own title/menu/toolbar chrome; stripping it
          // to a clean slot still needs work (see swallow.rs vmconnect diagnostics).
          pid = await api.connectConsole(conn.name);
        }
      } else { // RemoteHost → RDP / Horizon
        pid = await api.connectVm(conn.host, conn.protocol, conn.username || undefined, slotW, slotH, settings.rdpColorDepth, settings.rdpQuality);
      }

      // Start the swallow process with initial slot bounds.
      await api.swallowWindow(
        id,
        pid,
        Math.round(rect.x * dpr),
        Math.round(rect.y * dpr),
        slotW,
        slotH
      );
    } catch (e) {
      setIsConnecting(false);
      onError(String(e));
    }
  };

  // DEV-ONLY: swallow a throwaway Character Map window so SwallowGrid behavior
  // (header overlap, focus, theater, drag, z-index) can be tested with no VM/RDP.
  // Mirrors handleConnect's bounds math but sources the PID from the debug command.
  const handleSwallowTestWindow = async () => {
    setIsConnecting(true);
    setIsGlitched(false);
    try {
      const rect = contentRef.current!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const slotW = Math.round(rect.width * dpr);
      const slotH = Math.round(rect.height * dpr);
      const pid = await api.debugSpawnTestWindow();
      await api.swallowWindow(id, pid, Math.round(rect.x * dpr), Math.round(rect.y * dpr), slotW, slotH);
    } catch (e) {
      setIsConnecting(false);
      onError(String(e));
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.unswallowWindow(id);
      setIsSwallowed(false);
    } catch (e) {
      onError(String(e));
    }
  };

  const handleClearAssignment = async () => {
    if (isSwallowed) {
      await api.unswallowWindow(id);
      setIsSwallowed(false);
    }
    onAssign(null);
  };

  return (
    <div
      className={`swallow-slot ${isSwallowed ? "active" : ""} ${isGlitched ? "glitched" : ""} ${isActuallyHidden ? "slot-hidden" : ""}`}
    >
      {/* Header bar: always rendered in flow (36px, flex row) so the Win32 window
          starts below it. Buttons are always accessible regardless of Win32 z-order.
          This is the ONLY header over the slot — MultiView's controls render here
          too (headerControls) instead of in a second bar. */}
      <div className={`slot-header-bar ${isSwallowed ? "slot-header-bar--active" : ""}`}>
        {isSwallowed ? (
          <button className="slot-change-btn" onClick={() => setShowSelector(true)} title="다른 연결로 변경">
            <span className="slot-title">{selectedConnection?.name ?? (import.meta.env.DEV ? "테스트 창" : null)}</span>
            <ChevronDown size={11} />
          </button>
        ) : (
          <span className="slot-header-bar__label">
            {assignedId ? (selectedConnection?.name ?? assignedId) : "비어있음"}
          </span>
        )}
        <div className="slot-header-right">
          {headerControls}
          {/* Always rendered (disabled when no session) so the header controls
              never shift position when paging between swallowed/empty slots. */}
          <button className="slot-action-btn close" onClick={handleDisconnect} disabled={!isSwallowed} title="연결 해제">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content area: Win32 window fills this region exactly.
          contentRef measures this div — NOT the outer slot — so syncBounds
          correctly excludes the 36px header bar from the native window position. */}
      <div ref={contentRef} className="slot-content-area">
        {isGlitched && !isSwallowed && <div className="glitch-overlay-noise" />}

        {!assignedId && (
          <div className="slot-empty" onClick={() => setShowSelector(true)}>
            <Plus size={24} />
            <span>VM 또는 원격지 선택</span>
            {import.meta.env.DEV && (
              <button
                className="retry-btn-sm"
                style={{ marginTop: "10px", background: "rgba(91,130,190,0.15)", border: "1px solid rgba(91,130,190,0.35)" }}
                onClick={(e) => { e.stopPropagation(); handleSwallowTestWindow(); }}
                title="DEV: 테스트용 Win32 창(문자표)을 이 슬롯에 swallow"
              >
                ⚙ 테스트 창 swallow (dev)
              </button>
            )}
          </div>
        )}

        {assignedId && !isSwallowed && (
          <div className="slot-loading">
            {isConnecting ? (
              <>
                <RefreshCw size={24} className="spinning" />
                <span>{selectedConnection?.name} 분석 중...</span>
                {retryCountRef.current > 0 && <span className="retry-status">재연결 시퀀스 가동 ({retryCountRef.current} / 7)</span>}
                <button
                  className="retry-btn-sm"
                  style={{ marginTop: '12px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)' }}
                  onClick={() => {
                    setIsConnecting(false);
                    retryCountRef.current = 0;
                  }}
                >
                  연결 취소
                </button>
              </>
            ) : (
              <>
                {isGlitched ? <ZapOff size={24} className="error-icon" /> : <AlertCircle size={24} style={{ color: 'var(--accent-orange)' }} />}
                <span className={isGlitched ? "error-text" : ""}>
                  {selectedConnection?.name} {isGlitched ? "(신호 유실)" : "(연결 끊김)"}
                </span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="retry-btn-sm" onClick={() => selectedConnection && handleConnect(selectedConnection)}>
                    연결 시작
                  </button>
                  <button className="retry-btn-sm" style={{ background: 'transparent', border: '1px solid var(--border)' }} onClick={handleClearAssignment}>
                    슬롯 비우기
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Security overlay: covers the content area while keeping the header accessible */}
        {isSwallowed && isOverlayActive && (
          <div className="slot-overlay-security">
            <div className="overlay-placeholder-content">
              <div className="pulse-icon"><RefreshCw size={24} /></div>
              <p>관리 메뉴 조작 중...</p>
              <span>보안을 위해 화면 전송을 일시 감춥니다</span>
            </div>
          </div>
        )}
      </div>

      {showSelector && (
        <div className="slot-selector-overlay" onClick={() => setShowSelector(false)}>
          <div className="slot-selector" onClick={e => e.stopPropagation()}>
            <h4>슬롯 할당</h4>
            <div className="selector-list">
              <div className="selector-section">
                <h5>가상 머신</h5>
                {/* VDI (Omnissa/Horizon) is a virtual desktop too, so list it here next
                    to Hyper-V VMs. The "원격 데스크톱" group below is RDP-only. */}
                {data.vms.length === 0 && vdiHosts.length === 0 && <div className="selector-item empty">사용 가능한 VM 없음</div>}
                {data.vms.map(vm => (
                  <div key={vm.name} className="selector-item" onClick={async () => {
                    if (isSwallowed) { await api.unswallowWindow(id); setIsSwallowed(false); }
                    onAssign(vm.name);
                    setShowSelector(false);
                    handleConnect(vm);
                  }}>
                    <Terminal size={14} /> {vm.name}
                  </div>
                ))}
                {/* Omnissa/Horizon: grid embed DISABLED. The desktop window itself
                    swallows fine (window chain login→desktop works), but its MKS
                    display children stay pinned at absolute monitor coordinates
                    (log: MKSEmbedded rect=(1920,0 1920x1080)) and never follow the
                    reparented frame — the slot shows black. -desktopLayout
                    windowLarge didn't change it; a real fix needs Horizon SDK-level
                    embedding. Standalone connect from the Remote Assets page (no
                    swallow) is unaffected. */}
                {vdiHosts.map(host => (
                  <div key={host.id} className="selector-item disabled" title="멀티뷰 그리드 미지원 (원격 자산 페이지에서 일반 연결은 가능)">
                    <Monitor size={14} /> {host.name}
                    <span className="selector-item-badge">미지원</span>
                  </div>
                ))}
              </div>
              <div className="selector-section">
                <h5>원격 데스크톱</h5>
                {rdpHosts.length === 0 && <div className="selector-item empty">사용 가능한 원격지 없음</div>}
                {rdpHosts.map(host => (
                  <div key={host.id} className="selector-item" onClick={async () => {
                    if (isSwallowed) { await api.unswallowWindow(id); setIsSwallowed(false); }
                    onAssign(host.id);
                    setShowSelector(false);
                    handleConnect(host);
                  }}>
                    <Globe size={14} /> {host.name}
                  </div>
                ))}
              </div>
            </div>
            <button className="close-btn" onClick={() => setShowSelector(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
}
