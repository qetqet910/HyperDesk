import { useSettings } from "@/contexts/SettingsContext";
import { SwallowSlot } from "@/components/SwallowSlot";
import { VmInfo, RemoteHost } from "@/types";
import { Expand, Shrink, Maximize, Server, Monitor, Globe, RefreshCw, Plus } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useT } from "@/lib/i18n";
import { Sparkline } from "@/components/Sparkline";
import { useSystemStats } from "@/hooks/useDashboard";
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
  const t = useT();
  // 대시보드와 같은 쿼리 키를 쓰므로 React Query가 캐시를 공유한다 — 멀티뷰에
  // 들어왔다고 폴링이 하나 더 붙지 않는다.
  const { data: stats } = useSystemStats();
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
  // Live-session state for the right rail. slotAssignments only records what a slot
  // is CONFIGURED to hold — a slot whose mstsc/vmconnect died keeps its assignment,
  // so without this the rail rendered a dead slot identically to a live one.
  const [connectedSlots, setConnectedSlots] = useState<Record<string, boolean>>({});
  const handleConnectedChange = useCallback((slotId: string, connected: boolean) => {
    setConnectedSlots(prev => (prev[slotId] === connected ? prev : { ...prev, [slotId]: connected }));
  }, []);
  const liveCount = Object.values(connectedSlots).filter(Boolean).length;
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
      onError(t("mv.fullscreenFailed", { err: String(e) }));
    }
  };

  const handleUpdateSlot = (index: number, connectionId: string | null) => {
    const newAssignments = { ...settings.slotAssignments };
    if (connectionId) newAssignments[index] = connectionId;
    else delete newAssignments[index];
    updateSettings({ slotAssignments: newAssignments });
  };

  // Resolve a slot index to its assigned session, for the right rail. Kind drives
  // the icon/label; null name means the slot is empty.
  //
  // The resolved vm/host object is carried through — it used to be looked up and
  // then thrown away, keeping only name+kind, while `data` already holds live
  // cpu/memory/uptime/latency refreshed on the dashboard's 5s poll. The rail's
  // per-session metrics below are that already-paid-for data, not a new fetch.
  const slotMeta = (i: number): { name: string | null; kind: "hyperv" | "rdp" | "horizon" | null; vm?: VmInfo; host?: RemoteHost } => {
    const assignedId = settings.slotAssignments[i] || null;
    if (!assignedId) return { name: null, kind: null };
    const vm = data.vms.find((v) => v.name === assignedId);
    if (vm) return { name: vm.name, kind: "hyperv", vm };
    const host = data.remoteHosts.find((h) => h.id === assignedId);
    if (host) return { name: host.name, kind: host.protocol === "HORIZON" ? "horizon" : "rdp", host };
    return { name: assignedId, kind: null };
  };
  // **SystemStats의 단위가 필드마다 다르다** — memory_*는 KB, disk_free는 MB,
  // VmInfo의 memory_*는 바이트다(App.tsx의 대시보드 변환과 대조해 확인). 헬퍼를
  // 하나로 합치거나 서로 바꿔 쓰면 값이 1024배 틀어진 채 조용히 표시된다.
  const gbFromBytes = (b: number) => (b > 0 ? (b / 1024 / 1024 / 1024).toFixed(1) : "0.0");
  const gbFromKb = (k: number) => (k > 0 ? (k / 1024 / 1024).toFixed(0) : "0");
  const gbFromMb = (m: number) => (m > 0 ? (m / 1024).toFixed(0) : "0");
  const kindIcon = (kind: ReturnType<typeof slotMeta>["kind"]) => {
    if (kind === "hyperv") return <Server size={15} />;
    if (kind === "horizon") return <Globe size={15} />;
    if (kind === "rdp") return <Monitor size={15} />;
    return <Plus size={15} />;
  };
  // 프로토콜 이름(Hyper-V/Horizon/RDP)은 고유명사라 번역하지 않는다.
  const kindLabel = (kind: ReturnType<typeof slotMeta>["kind"]) =>
    kind === "hyperv" ? "Hyper-V" : kind === "horizon" ? "Horizon" : kind === "rdp" ? "RDP" : t("rail.unknown");
  // Rail card sub-line. The icon already carries WHAT the slot is, so this line
  // carries its STATE — that's the thing slotAssignments alone could never say.
  // rail.unknown is a real case: an assignment whose VM/host has since disappeared
  // (renamed VM, deleted host) resolves to a name with no kind, and the old label
  // rendered that as "비어있음" while the name sat right above it.
  const subLabel = (kind: ReturnType<typeof slotMeta>["kind"], name: string | null, connecting: boolean, connected: boolean) => {
    if (connecting) return t("rail.connecting");
    if (!name) return t("rail.empty");
    if (!kind) return t("rail.unknown");
    return connected ? kindLabel(kind) : t("rail.idle");
  };

  // Header controls rendered INSIDE the active slot's 36px header bar. Deliberately
  // NOT a separate header: a second bar floating over the slot's own header was the
  // "duplicated header" bug, and any HTML below the 36px band is physically covered
  // by the swallowed Win32 window anyway.
  //
  // The 1~4 slot switcher only appears while IMMERSIVE — there the right rail is
  // hidden (VM owns the whole screen), so the header's numbers are the only visual
  // "which slot is active" feedback (see the flashImmersiveHeader effect above). In
  // normal mode the right rail is the switcher, so the header just carries the
  // fullscreen/immersive toggles and the numbers would be redundant with the rail.
  const headerControls = (
    <>
      {isImmersive && (
        <>
          <div className="control-group">
            {Array.from({ length: SLOT_COUNT }).map((_, i) => (
              <button
                key={i}
                className={activeSlot === i ? "active" : ""}
                disabled={anyConnecting && activeSlot !== i}
                onClick={() => setActiveSlot(i)}
                title={anyConnecting && activeSlot !== i ? t("rail.lockedSwitch") : t("rail.slotHint", { n: i + 1 })}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="control-divider" />
        </>
      )}
      <div className="control-group">
        <button
          className={isImmersive ? "active" : ""}
          disabled={anyConnecting}
          onClick={handleToggleImmersive}
          title={anyConnecting ? t("mv.lockedToggle") : isImmersive ? t("mv.immersiveOff") : t("mv.immersiveOn")}
        >
          {isImmersive ? <Shrink size={14} /> : <Expand size={14} />}
        </button>
        {/* OS-fullscreen toggle is hidden while immersive — immersive already IS
            fullscreen, and a second toggle desyncs the two (Shrink exits). */}
        {!isImmersive && (
          <button onClick={handleToggleOSFullscreen} title={t("mv.osFullscreen")}>
            <Maximize size={14} />
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className={`multiview-container ${isImmersive ? "immersive" : ""} ${isImmersive && edgeRevealed ? "edge-revealed" : ""}`}>
      {/* Stage = grid + rail as a flex ROW. The rail is a real SIBLING that shrinks
          the grid (and therefore each slot's .slot-content-area), so the swallowed
          Win32 window re-fits the narrower area via its ResizeObserver — it is NOT
          an overlay over the VM (a swallowed child renders physically above WebView2
          and can't be covered by DOM z-index). Hidden while immersive so the VM keeps
          the full screen. */}
      <div className="multiview-stage">
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
                onConnectedChange={handleConnectedChange}
              />
            );
          })}
        </div>

        {!isImmersive && (
          <aside className="multiview-rail">
            <div className="multiview-rail__title">
              <span>{t("rail.title")}</span>
              {/* Live count, not assigned count — the sidebar's N/4 pill already
                  reports assignments, so repeating that here would say nothing new. */}
              <span className="multiview-rail__count">{liveCount}/{SLOT_COUNT}</span>
            </div>
            <div className="multiview-rail__list">
              {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                const meta = slotMeta(i);
                const slotId = `slot-${i}`;
                const connecting = !!connectingSlots[slotId];
                const connected = !!connectedSlots[slotId];
                const isActive = activeSlot === i;
                const locked = anyConnecting && !isActive;
                return (
                  <button
                    key={i}
                    className={`session-card ${isActive ? "active" : ""} ${meta.name ? "filled" : "empty"} ${connected ? "live" : ""}`}
                    disabled={locked}
                    /* Not aria-current — this pages between slots, it isn't navigation. */
                    aria-pressed={isActive}
                    onClick={() => setActiveSlot(i)}
                    title={locked ? t("rail.lockedSwitch") : t("rail.slotHint", { n: i + 1 })}
                  >
                    {/* 활성 마커. 카드마다 정적으로 그리지 않고 layoutId 하나를 공유해서
                        슬롯을 바꾸면 막대가 카드 사이를 **미끄러진다** — Alt+1~4로 전환할 때
                        포커스가 어디로 갔는지 눈이 따라갈 수 있게 하는 게 목적이다(장식 아님).
                        모션 감소 설정은 App.tsx의 MotionConfig가 전역으로 처리한다. */}
                    {isActive && (
                      <motion.span
                        layoutId="session-card-marker"
                        className="session-card__marker"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="session-card__top">
                      <span className="session-card__icon">
                        {connecting ? <RefreshCw size={15} className="spinning" /> : kindIcon(meta.kind)}
                        {connected && <span className="session-card__live" aria-hidden="true" />}
                      </span>
                      <span className="session-card__text">
                        <span className="session-card__name">{meta.name ?? t("rail.slot", { n: i + 1 })}</span>
                        <span className="session-card__sub">{subLabel(meta.kind, meta.name, connecting, connected)}</span>
                      </span>
                      <span className="session-card__hint">Alt+{i + 1}</span>
                    </span>

                    {/* 실시간 지표. 전부 이미 폴링 중인 data에서 나온다 — 새 커맨드 없음.
                        VM은 실행 중일 때만(꺼진 VM의 CPU 0%는 정보가 아니라 소음),
                        원격 호스트는 항상(지연/오프라인이 곧 그 카드의 상태다). */}
                    {meta.vm && meta.vm.state === "Running" && (
                      <span className="session-metrics">
                        <span className="session-metric">
                          <span className="session-metric__k">CPU</span>
                          <span className="session-metric__bar">
                            <i style={{ width: `${Math.min(Math.round(meta.vm.cpu_usage || 0), 100)}%` }} />
                          </span>
                          <span className="session-metric__v">{Math.min(Math.round(meta.vm.cpu_usage || 0), 100)}%</span>
                        </span>
                        <span className="session-metric">
                          <span className="session-metric__k">MEM</span>
                          <span className="session-metric__v session-metric__v--wide">
                            {gbFromBytes(meta.vm.memory_demand || meta.vm.memory_assigned)} / {gbFromBytes(meta.vm.memory_assigned)} GB
                          </span>
                        </span>
                        <span className="session-metric">
                          <span className="session-metric__k">{t("rail.uptime")}</span>
                          <span className="session-metric__v session-metric__v--wide">{meta.vm.uptime || "—"}</span>
                        </span>
                      </span>
                    )}
                    {meta.host && (
                      <span className="session-metrics">
                        <span className="session-metric">
                          <span className="session-metric__k">{t("rail.latency")}</span>
                          <span className="session-metric__v session-metric__v--wide">
                            {meta.host.status === "TIMEOUT" || meta.host.status === "Offline"
                              ? t("rail.offline")
                              : `${meta.host.latency ?? "—"} ms`}
                          </span>
                        </span>
                        {meta.host.host && (
                          <span className="session-metric">
                            <span className="session-metric__k">IP</span>
                            <span className="session-metric__v session-metric__v--wide">{meta.host.host}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 호스트 시스템. 원격 세션 4개를 돌리는 화면이야말로 "내 PC가 버티고
                있나"를 봐야 하는 자리다. useSystemStats/Sparkline 모두 대시보드가
                이미 쓰는 것이라 새 폴링도, 새 컴포넌트도 없다. autoRefresh가 꺼져
                있으면 갱신이 멈추는 것도 대시보드와 같은 동작. */}
            {stats && (
              <div className="rail-host">
                <div className="rail-host__title">{t("rail.hostSystem")}</div>
                <div className="rail-host__row">
                  <span className="rail-host__k">CPU</span>
                  <span className="rail-host__v">{Math.round(stats.cpu)}%</span>
                </div>
                <Sparkline data={stats.cpu_history} height={28} color="var(--accent-blue)" suffix="%" />
                <div className="rail-host__row">
                  <span className="rail-host__k">MEM</span>
                  <span className="rail-host__v">
                    {gbFromKb(stats.memory_used)} / {gbFromKb(stats.memory_total)} GB
                  </span>
                </div>
                <Sparkline data={stats.mem_history} height={28} color="var(--accent-green)" suffix="%" />
                <div className="rail-host__row">
                  <span className="rail-host__k">{t("rail.disk")}</span>
                  <span className="rail-host__v">{gbFromMb(stats.disk_free)} GB</span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
