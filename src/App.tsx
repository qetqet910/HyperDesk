import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import {
  Plus,
  Globe, Cpu, Settings as LucideSettings,
  Server,
  Play,
  Notebook,
  AlertTriangle
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri-api";
import { useDashboard, useSystemStats, useHostActions } from "@/hooks/useDashboard";
import { parseError } from "@/lib/error-utils";
import { pickReachableIp } from "@/lib/net";
import { useSettings } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/useToast";
import { applyTheme } from "@/lib/theme";
import { HyperVCard, HorizonCard } from "@/components/RackAsset";
import { Toast } from "@/components/Toast";
import { VmSettingsModal } from "@/components/VmSettingsModal";
import { CreateVmModal } from "@/components/CreateVmModal";
// Non-dashboard routes are code-split: the dashboard is the initial view, so
// these only load their chunk when the user first navigates to them, shrinking
// the initial app chunk (and its parse cost at startup).
const SettingsPage = lazy(() => import("@/components/SettingsPage").then(m => ({ default: m.SettingsPage })));
const MultiView = lazy(() => import("@/components/MultiView").then(m => ({ default: m.MultiView })));
const SnapshotsPage = lazy(() => import("@/components/SnapshotsPage").then(m => ({ default: m.SnapshotsPage })));import { AssetModal } from "@/components/AssetModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { MemoModal } from "@/components/MemoModal";
import { ColumnToggle } from "@/components/ColumnToggle";
import { Sidebar, type Page } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { BentoCell } from "@/components/BentoCell";
import { Sparkline } from "@/components/Sparkline";
const EventsPage = lazy(() => import("@/components/EventsPage").then(m => ({ default: m.EventsPage })));
const VmsPage = lazy(() => import("@/components/VmsPage").then(m => ({ default: m.VmsPage })));
const RemotePage = lazy(() => import("@/components/RemotePage").then(m => ({ default: m.RemotePage })));
import { CommandPalette } from "@/components/CommandPalette";
import { useT, type Key } from "@/lib/i18n";
import { useVmActions } from "@/hooks/useDashboard";
import type { VmInfo, RemoteHost, SlotConnectRequest } from "@/types";
import { Reorder, AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
// dotlottie-web fetches its WASM from a CDN by default (cdn.jsdelivr.net), which
// the production CSP (connect-src 'self') blocks → the loading animation silently
// never renders (only the caption shows). Self-host it: this ?url import bundles
// the exact WASM from the installed package into dist/ (always version-matched,
// same-origin), and setWasmUrl points the player at it. Also requires
// script-src 'wasm-unsafe-eval' in tauri.conf.json for WASM compilation.
import dotlottieWasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";
setWasmUrl(dotlottieWasmUrl);
import "./App.css";
import "./App.sidebar.css";

// ─── Loading screen copy — one is picked at random per app launch ────────────
const LOADING_KEYS: Key[] = [
  "loading.1", "loading.2", "loading.3", "loading.4", "loading.5", "loading.6", "loading.7",
];

// ─── Utilities ────────────────────────────────────────────────────────────────

// ─── Page metadata ────────────────────────────────────────────────────────────

// 사이드바 라벨과 같은 nav.* 키를 공유한다 — 같은 문구를 두 벌 번역하면
// 반드시 어긋난다.
const PAGE_KEYS: Record<Page, { title: Key; subtitle: Key }> = {
  dashboard: { title: "nav.dashboard", subtitle: "page.dashboard.sub" },
  multiview: { title: "nav.multiview", subtitle: "page.multiview.sub" },
  vms:       { title: "nav.vms",       subtitle: "page.vms.sub" },
  remote:    { title: "nav.remote",    subtitle: "page.remote.sub" },
  snapshots: { title: "nav.snapshots", subtitle: "page.snapshots.sub" },  events:    { title: "nav.events",    subtitle: "page.events.sub" },
  settings:  { title: "nav.settings",  subtitle: "page.settings.sub" },
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // Picked once per launch (not per render) — the loading screen only shows
  // during the initial fetch, so "매번 다르게" means "different each time you
  // start the app", not re-rolling on every re-render.
  const [loadingKey] = useState(() => LOADING_KEYS[Math.floor(Math.random() * LOADING_KEYS.length)]);
  const { settings, updateSettings } = useSettings();
  const t = useT();
  const { toasts, addToast, removeToast } = useToast();
  const { data, isLoading, refetch } = useDashboard();
  const { data: statsData } = useSystemStats();
  const { addHost, removeHost, updateHost, connect: connectHost } = useHostActions();
  const vmActions = useVmActions();

  // ── Page routing (localStorage-persisted) ──
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem("hd_page") as Page | null;
    const validPages: Page[] = ["dashboard", "multiview", "vms", "remote", "snapshots", "events"];
    if (saved && validPages.includes(saved)) return saved;
    if (!saved && settings.viewMode === "multiview") return "multiview";
    return "dashboard";
  });

  useEffect(() => {
    localStorage.setItem("hd_page", page);
    // Keep legacy viewMode in sync for MultiView component
    if (page === "multiview") updateSettings({ viewMode: "multiview" });
    else if (settings.viewMode === "multiview") updateSettings({ viewMode: "dashboard" });
  }, [page]);

  // ── Theme ──
  useEffect(() => {
    applyTheme(settings.theme ?? "dark");
  }, [settings.theme]);

  // ── Modals ──
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingHost, setEditingHost] = useState<RemoteHost | null>(null);
  // 신규 등록 시 미리 고를 프로토콜. 가상 머신 탭의 "Omnissa 등록"은 VDI로,
  // 원격 자산 탭의 "원격 자산 등록"은 RDP로 연다(편집일 땐 무시된다).
  const [addProtocol, setAddProtocol] = useState<"RDP" | "HORIZON">("RDP");
  const [showVmSettings, setShowVmSettings] = useState<VmInfo | null>(null);
  const [showCreateVm, setShowCreateVm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ title: string; body: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  // Notepad-style memo modal for a remote asset (opened from asset rows).
  const [memoHost, setMemoHost] = useState<RemoteHost | null>(null);
  // `rdp:` 링크가 왔는데 빈 슬롯이 없을 때 "지금 슬롯을 비울까?"를 묻는 대상.
  const [replaceAsk, setReplaceAsk] = useState<RemoteHost | null>(null);
  const isOverlayActive = !!(showAssetModal || confirmDelete || showVmSettings || errorModal || showSearch || memoHost || replaceAsk);

  // ── Data ──
  const [logs, setLogs] = useState<{ id: string; msg: string; type: string; time: string }[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);

  const vms = data?.vms ?? [];
  const remoteHosts = data?.remote_hosts ?? [];
  const horizonHosts = useMemo(() => remoteHosts.filter(h => h.protocol === "HORIZON"), [remoteHosts]);

  // ── `rdp:` 링크 ─────────────────────────────────────────────────────────────
  // Windows 선택 창에서 HyperDesk로 연 `rdp:` 링크: 원격 자산에 없으면 추가하고, 빈
  // 슬롯에 바로 연결한다. 빈 슬롯이 없으면 지금 슬롯을 비울지 묻는다(아니오 = 자산만 추가).
  const [slotRequest, setSlotRequest] = useState<SlotConnectRequest | null>(null);
  // 리스너가 한 번만 걸리도록 최신 목록은 ref로 읽는다(클로저에 옛 목록이 갇히지 않게).
  const linkCtx = useRef({ remoteHosts, slotAssignments: settings.slotAssignments ?? {} });
  linkCtx.current = { remoteHosts, slotAssignments: settings.slotAssignments ?? {} };

  const connectToSlot = useCallback((slot: number | "current", host: RemoteHost) => {
    setPage("multiview"); // MultiView는 이 페이지에서만 마운트된다
    setSlotRequest({ nonce: Date.now(), slot, host });
  }, []);

  const handleRdpLink = useCallback(async () => {
    const link = await api.takeRdpLink().catch(() => null);
    if (!link) return;
    const { remoteHosts: hosts, slotAssignments } = linkCtx.current;
    // 기본 포트(3389)는 붙이든 안 붙이든 같은 대상이다 — 레지스트리에서 감지된 자산은
    // 보통 포트 없이, 링크는 `host:3389`로 오는 경우가 많아 중복 등록되기 쉽다.
    const norm = (h: string) => h.toLowerCase().replace(/:3389$/, "");
    let host = hosts.find(h => h.protocol === "RDP" && norm(h.host) === norm(link.host));
    if (!host) {
      try {
        const id = await api.addRemoteHost(link.host, link.host, "RDP", link.username ?? undefined);
        host = { id, name: link.host, host: link.host, username: link.username ?? undefined, protocol: "RDP", is_detected: false, is_hidden: false };
        refetch();
        addToast(t("toast.linkAssetAdded", { name: link.host }), "success");
      } catch (e) {
        addToast(String(e), "error");
        return;
      }
    }
    const empty = [0, 1, 2, 3].find(i => !slotAssignments[i]);
    if (empty === undefined) setReplaceAsk(host);
    else connectToSlot(empty, host);
  }, [connectToSlot, refetch, addToast, t]);

  // 목록이 로드된 뒤에만 처리한다. 링크로 앱이 막 켜진 순간엔 원격 자산 목록이 아직
  // 비어 있어서, 이미 있는 자산을 또 추가하게 된다. 링크는 백엔드 대기열에 남아 있으니
  // 로드가 끝날 때 가져가면 된다.
  const dashboardReady = !!data;
  useEffect(() => {
    if (!dashboardReady) return;
    handleRdpLink(); // 꺼져 있다가 링크로 실행된 경우
    const unlisten = listen("rdp-link", () => { handleRdpLink(); }); // 이미 떠 있을 때
    return () => { unlisten.then(f => f()); };
  }, [dashboardReady, handleRdpLink]);
  const mstHostsList  = useMemo(() => remoteHosts.filter(h => h.protocol !== "HORIZON"), [remoteHosts]);
  const runningVms    = vms.filter(v => v.state === "Running").length;

  type AppRackAsset = { type: "HYPER_V"; id: string; data: VmInfo } | { type: "HORIZON"; id: string; data: RemoteHost };
  const [localRackAssets, setLocalRackAssets] = useState<AppRackAsset[]>([]);
  const [localMstHosts, setLocalMstHosts] = useState<RemoteHost[]>([]);
  const [localVms, setLocalVms] = useState<VmInfo[]>([]);

  // ── Security + Global shortcuts ──
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      // Block devtools shortcuts in production only — dev needs F12 for the swallow-tree investigation.
      if (!import.meta.env.DEV &&
          (e.key === "F12" || (e.ctrlKey && e.shiftKey && ["I","J","C"].includes(e.key)) || (e.ctrlKey && e.key === "U")))
        { e.preventDefault(); return; }
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setShowSearch(s => !s); }
      if (e.key === "Escape") {
        // Close overlays in priority order (innermost first)
        setShowSearch(false);
        setShowAssetModal(false);
        setEditingHost(null);
        setShowVmSettings(null);
        setConfirmDelete(null);
        setErrorModal(null);
        setMemoHost(null);
      }
    };
    window.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("contextmenu", onCtx); window.removeEventListener("keydown", onKey); };
  }, []);

  const openSearch = useCallback(() => { setShowSearch(true); }, []);
  const closeSearch = useCallback(() => { setShowSearch(false); }, []);

  // ── Telemetry ──
  useEffect(() => {
    if (statsData) {
      setCpuHistory(statsData.cpu_history ?? []);
      setMemHistory(statsData.mem_history ?? []);
    }
  }, [statsData]);

  // ── Rack + VM sort ──
  useEffect(() => {
    if (!data) return;

    // Dashboard rack (VMs + Horizon)
    const rackOrder: string[] = JSON.parse(localStorage.getItem("hyperdesk_rack_order") ?? "[]");
    const combined: AppRackAsset[] = [
      ...vms.map(v => ({ type: "HYPER_V" as const, id: `vm-${v.name}`, data: v })),
      ...horizonHosts.map(h => ({ type: "HORIZON" as const, id: `hz-${h.id}`, data: h })),
    ];
    combined.sort((a, b) => {
      const ia = rackOrder.indexOf(a.id); const ib = rackOrder.indexOf(b.id);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    if (localRackAssets.length === 0 || combined.length !== localRackAssets.length) {
      setLocalRackAssets(combined);
    } else {
      const map = new Map(combined.map(c => [c.id, c]));
      setLocalRackAssets(prev => prev.map(p => map.get(p.id) ?? p));
    }

    // MST hosts
    const mstOrder: string[] = JSON.parse(localStorage.getItem("hyperdesk_mst_order") ?? "[]");
    const sortedMst = [...mstHostsList].sort((a, b) => {
      const ia = mstOrder.indexOf(a.id); const ib = mstOrder.indexOf(b.id);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    if (localMstHosts.length === 0 || sortedMst.length !== localMstHosts.length) {
      setLocalMstHosts(sortedMst);
    } else {
      const map = new Map(sortedMst.map(c => [c.id, c]));
      setLocalMstHosts(prev => prev.map(p => (map.get(p.id) ?? p) as RemoteHost));
    }

    // VMs page order
    const vmOrder: string[] = JSON.parse(localStorage.getItem("hyperdesk_vms_order") ?? "[]");
    const sortedVms = [...vms].sort((a, b) => {
      const ia = vmOrder.indexOf(a.name); const ib = vmOrder.indexOf(b.name);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    if (localVms.length === 0 || sortedVms.length !== localVms.length) {
      setLocalVms(sortedVms);
    } else {
      const map = new Map(sortedVms.map(v => [v.name, v]));
      setLocalVms(prev => prev.map(p => map.get(p.name) ?? p));
    }
  }, [data, vms, remoteHosts, horizonHosts, mstHostsList]);

  // ── Startup log ──
  const addLog = (msg: string, type: "info" | "success" | "error" | "warn") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [{ id: Math.random().toString(36), msg, type, time }, ...prev].slice(0, 50));
  };

  const startupLogFiredRef = useRef(false);
  useEffect(() => {
    if (isLoading || startupLogFiredRef.current) return;
    startupLogFiredRef.current = true;
    const seq = [
      { msg: "[SYSTEM] Booting HyperDesk Core Engine...", type: "info" },
      { msg: "[SCAN] Searching for Virtual Machines (Hyper-V)...", type: "info" },
      { msg: `[SUCCESS] ${vms.length} Hyper-V Units Online.`, type: "success" },
      { msg: "[SCAN] Mapping Remote Assets (RDP / Registry)...", type: "info" },
      { msg: `[SUCCESS] ${remoteHosts.length} Network Assets Indexed.`, type: "success" },
      { msg: "[SYSTEM] SYMMETRY GRID STABLE. ALL SYSTEMS GREEN.", type: "success" },
    ] as const;
    const timers = seq.map((s, i) => setTimeout(() => addLog(s.msg, s.type), i * 40));
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  // parseError는 키만 분류하고 표시는 여기서 한다. detail이 있으면(어느 패턴에도
  // 안 걸린 경우) 번역된 안내문 대신 원문 일부를 보여준다 — 분류 못 한 에러는
  // 원문이 유일한 단서다.
  const showError = (e: ReturnType<typeof parseError>) => ({
    title: t(e.titleKey),
    body: e.detail ?? t(e.bodyKey),
  });

  const handleError = (raw: string) => {
    const err = showError(parseError(raw));
    setErrorModal(err);
    addLog(`[ERROR] ${err.title}: ${err.body}`, "error");
  };

  const handleAssetAction = async (hostData: any) => {
    try {
      if (editingHost) {
        await updateHost.mutateAsync({ id: editingHost.id, ...hostData });
        addToast(t("toast.assetSynced", { name: hostData.name }), "success");
      } else {
        await addHost.mutateAsync(hostData);
        addToast(t("toast.assetAdded", { name: hostData.name }), "success");
      }
      setShowAssetModal(false);
      setEditingHost(null);
    } catch (e) { handleError(String(e)); }
  };

  const handleDeleteHost = async () => {
    if (!confirmDelete) return;
    try {
      await removeHost.mutateAsync(confirmDelete);
      addToast(t("toast.assetDeleted"), "info");
      setConfirmDelete(null);
    } catch (e) { handleError(String(e)); }
  };

  // ── Loading state logic is now handled in the main render block ──

  // ── Topbar actions per page ──
  const topbarActions = (
    <>
      {/* Add-asset is a primary action — surfaced on every page, not just VMs. */}
      {page !== "settings" && (
        <button
          className="tool-btn"
          onClick={() => { setEditingHost(null); setAddProtocol("RDP"); setShowAssetModal(true); }}
          title={t("dash.addAsset")}
        >
          <Plus size={15} />
        </button>
      )}
      <button className="tool-btn" onClick={() => setPage("settings")} title={t("common.settings")}>
        <LucideSettings size={15} />
      </button>
    </>
  );

  const meta = { title: t(PAGE_KEYS[page].title), subtitle: t(PAGE_KEYS[page].subtitle) };

  // ─── Content Components ───────────────────────────────────────────────────


  // ─── Dashboard content (extracted for clarity) ───────────────────────────

  const DashboardContent = (
    <motion.div 
      className="dashboard-grid"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
      }}
    >
      {/* KPI Strip */}
      <motion.div 
        className="hd-kpi-strip" 
        style={{ gridColumn: "1 / -1" }}
        variants={{
          hidden: { opacity: 0, y: 10 },
          visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
        }}
      >
        {(() => {
          const onlineRemote = remoteHosts.filter(h => h.status !== "TIMEOUT" && h.status !== "Offline").length;
          const latencyHosts = remoteHosts.filter(h => (h.latency ?? 0) > 0);
          const avgLatency = latencyHosts.length ? Math.round(latencyHosts.reduce((s, h) => s + (h.latency ?? 0), 0) / latencyHosts.length) : 0;
          const memUsedGB = ((statsData?.memory_used ?? data?.system_memory_used ?? 0) / 1024 / 1024);
          const memTotalGB = ((statsData?.memory_total ?? data?.system_memory_total ?? 1) / 1024 / 1024);
          const memPct = memTotalGB > 0 ? ((memUsedGB / memTotalGB) * 100).toFixed(1) : "0";
          return [
            { label: t("dash.kpi.activeVms"), value: `${runningVms}/${vms.length}`, delta: t("dash.kpi.activeVmsDelta", { n: runningVms }), up: runningVms > 0, color: "var(--accent-green)" },
            { label: t("dash.kpi.memory"), value: `${memUsedGB.toFixed(1)} GB`, delta: `${memPct}%`, up: true, color: "var(--accent-blue)" },
            { label: t("dash.kpi.remote"), value: t("dash.kpi.remoteValue", { n: onlineRemote }), delta: t("dash.kpi.remoteDelta", { n: remoteHosts.length }), up: true, color: "var(--accent-blue)" },
            { label: t("dash.kpi.latency"), value: `${avgLatency} ms`, delta: t("dash.kpi.latencyDelta", { n: latencyHosts.length }), up: avgLatency < 50, color: avgLatency < 50 ? "var(--accent-green)" : "var(--accent-orange)" },
          ].map((kpi) => (
            <div key={kpi.label} className="hd-kpi-tile">
              <div className="hd-kpi-label">{kpi.label}</div>
              <div className="hd-kpi-value" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className={`hd-kpi-delta ${kpi.up ? "up" : "dn"}`}>{kpi.up ? "▲" : "▼"} {kpi.delta}</div>
            </div>
          ));
        })()}
      </motion.div>

      {/* Section: System Command Hub */}
      <motion.div 
        className="section-label"
        variants={{
          hidden: { opacity: 0, x: -10 },
          visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
        }}
      >
        <h3>{t("dash.systemStatus")}</h3><div className="section-line" />
      </motion.div>

      <motion.div
        // flexWrap + per-child minWidth: the monitor (flex 3) and snapshot index
        // (flex 2) sit side-by-side when wide and stack once the row can't give
        // each its ~320px min, instead of squeezing the sparklines to nothing.
        style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: "16px" }}
        variants={{
          hidden: { opacity: 0, y: 15 },
          visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
        }}
      >
        <BentoCell className="cell-master-hub" style={{ flex: "3 1 340px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Cpu size={14} color="var(--accent-blue)" />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>{t("dash.resourceMonitor")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 500, color: "var(--accent-green)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent-green)", display: "inline-block" }} />
              {t("dash.running", { n: runningVms, total: vms.length })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", flex: 1 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "10px", color: "var(--text-muted)" }}>
                <span>CPU</span><span>{(statsData?.cpu ?? data?.system_cpu ?? 0).toFixed(1)}%</span>
              </div>
              <Sparkline data={cpuHistory} height={70} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "10px", color: "var(--text-muted)" }}>
                <span>{t("dash.memory")}</span><span>{(((statsData?.memory_used ?? data?.system_memory_used) ?? 0) / 1024 / 1024).toFixed(1)} GB</span>
              </div>
              <Sparkline data={memHistory} color="var(--accent-green)" height={70} />
            </div>
          </div>

          {/* Bottom stat bar */}
          <div className="hub-stat-bar">
            <div className="hub-stat-item">
              <span className="hub-stat-label">{t("dash.diskFree")}</span>
              <div className="hub-stat-track">
                {/* Fill shows the FREE fraction (matches the label + green color) */}
                <div className="hub-stat-fill" style={{ width: `${statsData?.disk_total ? Math.round((statsData.disk_free / statsData.disk_total) * 100) : 0}%`, background: "var(--accent-green)" }} />
              </div>
              <span className="hub-stat-value" style={{ color: "var(--accent-green)" }}>
                {(((statsData?.disk_free ?? data?.system_disk_free) ?? 0) / 1024).toFixed(0)} GB
              </span>
            </div>
            <div className="hub-stat-sep" />
            <div className="hub-stat-item">
              <span className="hub-stat-label">{t("dash.network")}</span>
              <div className="hub-stat-track">
                <div className="hub-stat-fill" style={{ width: `${Math.min(100, ((statsData?.network_io ?? data?.system_network_io ?? 0) / 102400) * 100)}%`, background: "var(--accent-blue)" }} />
              </div>
              <span className="hub-stat-value" style={{ color: "var(--accent-blue)" }}>
                {(((statsData?.network_io ?? data?.system_network_io) ?? 0) / 1024).toFixed(1)} KB/s
              </span>
            </div>
            <div className="hub-stat-sep" />
            <div className="hub-stat-item">
              <span className="hub-stat-label">{t("dash.vcpuTotal")}</span>
              <div className="hub-stat-track">
                <div className="hub-stat-fill" style={{ width: `${Math.min(100, vms.reduce((s, v) => s + (v.processor_count ?? 0), 0) * 2)}%`, background: "var(--accent-blue)" }} />
              </div>
              <span className="hub-stat-value" style={{ color: "var(--accent-blue)" }}>
                {vms.reduce((s, v) => s + (v.processor_count ?? 0), 0)}
              </span>
            </div>
          </div>
        </BentoCell>

        {/* Snapshot Index */}
        <BentoCell style={{ flex: "2 1 300px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", opacity: 0.5 }}>◇</span>
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Snapshot Index</span>
            </div>
            <span style={{ fontSize: "9px", fontWeight: 900, color: "var(--accent-blue)", background: "rgba(110,113,255,0.1)", padding: "2px 8px", borderRadius: "4px", border: "1px solid rgba(110,113,255,0.2)" }}>
              {vms.reduce((s, v) => s + (v.checkpoint_count ?? 0), 0)} TOTAL
            </span>
          </div>

          <div style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>
            Recent Restore Points
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, overflowY: "auto" }}>
            {vms.filter(v => (v.checkpoint_count ?? 0) > 0).map(vm => {
              const dotColor = vm.state === "Running" ? "var(--accent-green)" : vm.state === "Paused" ? "var(--accent-orange)" : "var(--text-muted)";
              return (
                <div key={vm.name} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, fontFamily: "var(--font)", letterSpacing: "0.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{vm.name}</div>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{vm.checkpoint_count} checkpoint{(vm.checkpoint_count ?? 0) !== 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ fontSize: "9px", color: "var(--text-muted)", flexShrink: 0 }}>{vm.uptime !== "—" ? vm.uptime : "—"}</div>
                </div>
              );
            })}
            {vms.filter(v => (v.checkpoint_count ?? 0) > 0).length === 0 && (
              <div style={{ textAlign: "center", opacity: 0.3, padding: "24px", fontSize: "11px" }}>{t("dash.noSnapshots")}</div>
            )}
          </div>
        </BentoCell>
      </motion.div>

      {/* Section: Virtualization Rack */}
      <motion.div 
        className="section-label"
        variants={{
          hidden: { opacity: 0, x: -10 },
          visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
        }}
      >
        <h3>{t("dash.vmCluster")}</h3>
        <div className="section-line" />
      </motion.div>
      <motion.div
        // Span the full dashboard-grid width. `.cell-4x2`'s own `grid-column:
        // 1/-1` sits on the inner BentoCell, but the grid CHILD is THIS
        // motion.div — so the rule never applied and the card rendered at half
        // width (1 of 2 columns), clipping the VM rows' controls. Mirrors how
        // `.mst-line-container` (remote assets) puts the span on the grid child.
        style={{ gridColumn: "1 / -1" }}
        variants={{
          hidden: { opacity: 0, y: 15 },
          visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
        }}
      >
        <BentoCell className="cell-4x2" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>{t("dash.nodes", { n: vms.length + horizonHosts.length })}</span>
          <span style={{ fontSize: "11px", color: "var(--accent-green)", fontWeight: 600, background: "rgba(34,197,94,0.08)", padding: "2px 10px", borderRadius: "6px", border: "1px solid rgba(34,197,94,0.2)" }}>
            {t("dash.online", { n: runningVms + horizonHosts.filter(h => h.status !== "Offline").length, total: vms.length + horizonHosts.length })}
          </span>
        </div>
        <div className="rack-container no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "12px", overflowY: "scroll", maxHeight: "480px" }}>
          {data?.vm_error && (() => {
            const err = showError(parseError(data.vm_error));
            return (
              <div style={{ padding: "14px 16px", borderRadius: "10px", border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.08)", display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <AlertTriangle size={16} color="var(--accent-red)" style={{ flexShrink: 0, marginTop: "1px" }} />
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent-red)" }}>{err.title}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{err.body}</div>
                </div>
              </div>
            );
          })()}
          {localRackAssets.length > 0 ? (
            <Reorder.Group axis="y" values={localRackAssets} onReorder={(o) => { setLocalRackAssets(o); localStorage.setItem("hyperdesk_rack_order", JSON.stringify(o.map(i => i.id))); }} style={{ display: "flex", flexDirection: "column", gap: "12px", listStyle: "none", padding: 0, margin: 0 }}>
              {localRackAssets.map((asset, idx) => (
                <Reorder.Item key={asset.id} value={asset} style={{ listStyle: "none", margin: 0, padding: 0, width: "100%" }}>
                  {asset.type === "HYPER_V"
                    ? <HyperVCard vm={asset.data} animDelay={idx * 50} onError={handleError} onSuccess={(msg) => { addToast(msg, "success"); addLog(`[VM] ${msg}`, "success"); }} onSettings={() => setShowVmSettings(asset.data as VmInfo)} />
                    : <HorizonCard host={asset.data as RemoteHost} animDelay={idx * 50} onEdit={(h) => { setEditingHost(h); setShowAssetModal(true); }} onError={handleError} onSuccess={(msg) => { addToast(msg, "success"); addLog(`[VDI] ${msg}`, "success"); }} />
                  }
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            <div style={{ padding: "40px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
              <Server size={24} style={{ marginBottom: "10px" }} />
              <div style={{ fontSize: "12px", fontWeight: 500 }}>{t("dash.noVms")}</div>
            </div>
          )}
        </div>
      </BentoCell>
      </motion.div>
      {mstHostsList.length > 0 && <>
        <motion.div 
          className="section-label"
          variants={{
            hidden: { opacity: 0, x: -10 },
            visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
          }}
        >
          <Globe size={14} color="var(--accent-blue)" /><h3>{t("dash.remoteAssets")}</h3><div className="section-line" />
          <ColumnToggle value={settings.remoteAssetColumns} onChange={(v) => updateSettings({ remoteAssetColumns: v })} />
          <button className="hd-segment-btn" onClick={() => { setEditingHost(null); setAddProtocol("RDP"); setShowAssetModal(true); }} title={t("dash.registerAsset")}>
            <Plus size={13} />
          </button>
        </motion.div>
        <motion.div 
          className="mst-line-container"
          variants={{
            hidden: { opacity: 0, y: 15 },
            visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
          }}
        >
          {/* MST rows — 새 랙 슬레드 스타일. 2열 모드는 grid로 전환, 각 아이템은 반폭. */}
          <Reorder.Group
            axis="y"
            values={localMstHosts}
            onReorder={(o) => { setLocalMstHosts(o); localStorage.setItem("hyperdesk_mst_order", JSON.stringify(o.map(i => i.id))); }}
            style={settings.remoteAssetColumns === 2
              // auto-fit + minmax: tries 2 columns, but each row needs ~600px of
              // real estate (name 260px + status/ear/actions) before it clips the
              // CONNECT button/icons off the edge — so it collapses to 1 column on
              // its own once the container is too narrow, no JS/ResizeObserver needed.
              ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(650px, 1fr))", gap: "6px", listStyle: "none", padding: 0, margin: 0 }
              : { display: "flex", flexDirection: "column", gap: "6px", listStyle: "none", padding: 0, margin: 0 }}
          >
            {localMstHosts.map((host) => {
              const isOffline = host.status === "TIMEOUT" || host.status === "Offline";
              const proto = host.protocol === "HORIZON" ? "horizon" : "rdp";
              return (
                <Reorder.Item key={host.id} value={host} style={{ listStyle: "none", margin: 0, padding: 0, width: "100%" }}>
                  <div className={`mst-rack-row ${isOffline ? "dead" : ""}`}>
                    {/* 랙 귀 */}
                    <div className="mst-rack-ear">
                      <div className="mst-rack-stripe" />
                    </div>
                    {/* LED + 레이턴시 */}
                    <div className="mst-rack-status">
                      <span className={`mst-rack-led ${isOffline ? "offline" : "online"}`} />
                      <span className={`mst-rack-latency ${isOffline ? "offline" : "online"}`}>
                        {isOffline ? "---" : `${host.latency}MS`}
                      </span>
                    </div>
                    {/* 네임플레이트 */}
                    <div className="mst-rack-name">
                      <span className="mst-rack-hostname">{host.name}</span>
                      <span className={`mst-proto-tag ${proto}`}>{host.protocol}</span>
                      {host.is_detected && <span className="mst-proto-tag auto">AUTO</span>}
                    </div>
                    {/* 주소. 자동 감지는 이름이 곧 주소라 겹쳐 찍지 않는다(원격 자산 탭과 동일). */}
                    <div className={`mst-rack-addr${host.host === host.name ? " is-same" : ""}`}>
                      {host.host === host.name ? "" : host.host}
                    </div>
                    {/* 액션 */}
                    <div className="mst-rack-actions">
                      <button
                        className={`mst-rack-connect ${isOffline ? "disabled" : ""}`}
                        disabled={isOffline}
                        title={isOffline ? t("dash.offline") : t("dash.connect")}
                        onClick={() => !isOffline && connectHost.mutateAsync({ host: host.host, protocol: host.protocol, username: host.username })}
                      >
                        <Play size={13} />
                      </button>
                      {/* 글리프("✎") 대신 아이콘 — 나머지 버튼과 같은 획 두께·크기를 쓴다. */}
                      <button className="mst-rack-icon-btn" title={t("dash.memo")} onClick={() => setMemoHost(host)}><Notebook size={14} /></button>
                    </div>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </motion.div>
      </>}
    </motion.div>
  );

  // ─── Stats bar (shown below topbar) ─────────────────────────────────────────

  const StatsBar = (
    <div className="stats-bar">
      <div className="stat-item"><Server size={12} /><span>VM <strong>{vms.length}</strong> · <strong>{runningVms}</strong> UP</span></div>
      <span className="stat-sep">|</span>
      <div className="stat-item"><Globe size={12} /><span>{t("dash.statusRemote")} <strong>{remoteHosts.length}</strong></span></div>
      <span className="stat-sep">|</span>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <Cpu size={12} />
        <span style={{ color: "var(--accent-green)" }}>{(statsData?.cpu ?? data?.system_cpu ?? 0).toFixed(1)}%</span>
      </div>
    </div>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    // framer-motion 애니메이션은 JS로 값을 직접 쓰기 때문에 App.css의 전역
    // `@media (prefers-reduced-motion: reduce)` 블록이 **닿지 않는다**. 이 앱엔
    // motion 사용처가 24곳 있는데 그동안 전부 OS 모션 감소 설정을 무시하고 있었다.
    // reducedMotion="user"가 그 설정을 읽어 transform/layout 애니메이션을 끄고
    // opacity만 남긴다(사라지는 게 아니라 전정기관을 자극하는 움직임만 제거).
    <MotionConfig reducedMotion="user">
    <AnimatePresence mode="wait">
      {isLoading && !data ? (
        <motion.div
          key="loading"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(10px)", scale: 1.05 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="loading-screen"
        >
          <DotLottieReact src="/loading.lottie" loop autoplay speed={1} className="loading-lottie" />
          <p>{t(loadingKey)}</p>
        </motion.div>
      ) : (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="app-layout"
        >
          {/* ── Left Sidebar ── */}
          <Sidebar
            current={page}
            onNav={(p) => {
              if (p === "events" || p === "dashboard" || p === "multiview" || p === "vms" || p === "remote" || p === "snapshots" || p === "settings") {
                setPage(p);
              }
            }}
            vmCount={vms.length + horizonHosts.length}
            remoteCount={mstHostsList.length}
            runningCount={runningVms}
            occupiedSlots={Object.keys(settings.slotAssignments ?? {}).length}
          />

          {/* ── Main area ── */}
          <div className="hd-main">
            {/* Topbar */}
            <Topbar
              title={meta.title}
              subtitle={meta.subtitle}
              isRefreshing={isLoading}
              onRefresh={() => refetch()}
              actions={topbarActions}
              onSearch={openSearch}
            />

            {/* Stats strip (dashboard + vms only) */}
            {(page === "dashboard" || page === "vms") && StatsBar}

            {/* Content. MultiView renders bare (no .hd-page wrapper) — its swallowed
                Win32 windows can't follow a CSS enter animation. Every other page is
                wrapped in .hd-page keyed by `page` so the transition replays on nav. */}
            <main className={`hd-content ${page === "multiview" ? "hd-content--multiview" : ""}`}>
              {/* Suspense fallback covers the brief chunk-load of a lazily-imported
                  route (near-instant off local disk); the dashboard is eager so it
                  never shows the fallback on first paint. */}
              <Suspense fallback={<div className="hd-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px" }}>{t("common.loading")}</div>}>
                {page === "multiview" ? (
                  <MultiView data={{ vms, remoteHosts }} isOverlayActive={isOverlayActive} connectRequest={slotRequest} onConnectRequestHandled={() => setSlotRequest(null)} onError={(msg) => { addToast(msg, "error"); addLog(`[MULTIVIEW] ${msg}`, "error"); }} />
                ) : (
                  <div className="hd-page" key={page}>
                    {page === "dashboard" && DashboardContent}
                    {page === "vms" && <VmsPage
                      vms={vms}
                      statsData={statsData}
                      horizonHosts={horizonHosts}
                      onError={handleError}
                      onSuccess={(msg) => { addToast(msg, "success"); addLog(`[VM] ${msg}`, "success"); }}
                      onSettings={setShowVmSettings}
                      onCreate={() => setShowCreateVm(true)}
                      onHostConnect={(host, protocol, username) => connectHost.mutateAsync({ host, protocol, username })}
                      onHostEdit={(host) => { setEditingHost(host); setShowAssetModal(true); }}
                      onHostMemo={setMemoHost}
                      onHostDelete={setConfirmDelete}
                      onHostAdd={() => { setEditingHost(null); setAddProtocol("HORIZON"); setShowAssetModal(true); }}
                    />}
                    {page === "remote" && <RemotePage remoteHosts={mstHostsList} onConnect={(host, protocol, username) => connectHost.mutateAsync({ host, protocol, username })} onEdit={(host) => { setEditingHost(host); setShowAssetModal(true); }} onMemo={setMemoHost} onDelete={setConfirmDelete} onAdd={() => { setEditingHost(null); setAddProtocol("RDP"); setShowAssetModal(true); }} />}
                    {page === "snapshots" && <SnapshotsPage vms={vms} onSuccess={(msg) => { addToast(msg, "success"); addLog(`[SNAP] ${msg}`, "success"); }} onError={(msg) => { addToast(msg, "error"); addLog(`[SNAP] ${msg}`, "error"); }} />}
                    {page === "events"    && <EventsPage logs={logs} onClear={() => setLogs([])} />}
                    {page === "settings"  && <SettingsPage addToast={addToast} />}
                  </div>
                )}
              </Suspense>
            </main>
          </div>

          {/* ── Global overlays ── */}
          <Toast toasts={toasts} onClose={removeToast} />

          {/* Command Palette */}
          <CommandPalette
            isOpen={showSearch}
            onClose={closeSearch}
            vms={vms}
            remoteHosts={remoteHosts}
            onNav={(p) => { setPage(p); closeSearch(); }}
            onVmStart={(name) => { vmActions.start.mutate(name); addToast(t("toast.vmStarting", { name }), "info"); }}
            onVmStop={(name) => { vmActions.stop.mutate(name); addToast(t("toast.vmStopping", { name }), "info"); }}
            onVmSave={(name) => { vmActions.save.mutate(name); addToast(t("toast.vmSaving", { name }), "info"); }}
            onVmPause={(name) => { vmActions.pause.mutate(name); addToast(t("toast.vmPausing", { name }), "info"); }}
            onVmResume={(name) => { vmActions.resume.mutate(name); addToast(t("toast.vmResuming", { name }), "info"); }}
            onVmConnect={(vm) => {
              const ip = pickReachableIp(vm.ip_addresses);
              if (ip) vmActions.connect.mutate({ host: ip, username: undefined });
            }}
            onVmConsole={(name) => vmActions.console.mutate(name)}
            onVmSettings={(vm) => { setShowVmSettings(vm); closeSearch(); }}
            onHostConnect={(host) => connectHost.mutate({ host: host.host, protocol: host.protocol, username: host.username })}
            /* Quick connect: 등록 절차 없이 팔레트에 친 주소로 바로 RDP. 계정은
               설정의 "기본 접속 계정"을 쓴다 — 이 설정의 존재 이유가 정확히 이거다.
               비어 있으면 넘기지 않고 mstsc가 직접 묻게 둔다(빈 문자열을 넘기면
               계정을 지정한 것으로 취급돼 인증이 곧바로 실패한다). */
            onQuickConnect={(host) => connectHost.mutate({ host, protocol: "RDP", username: settings.defaultUsername || undefined })}
            onHostEdit={(host) => { setEditingHost(host); setShowAssetModal(true); closeSearch(); }}
            onHostDelete={(host) => { setConfirmDelete(host.id); closeSearch(); }}
            onAddAsset={() => { setEditingHost(null); setAddProtocol("RDP"); setShowAssetModal(true); closeSearch(); }}
            onThemeToggle={() => { const next = settings.theme === "light" ? "dark" : "light"; applyTheme(next); updateSettings({ theme: next }); }}
          />

          {showVmSettings  && <VmSettingsModal vm={showVmSettings} onClose={() => setShowVmSettings(null)} onLog={addLog} />}
          {showCreateVm    && <CreateVmModal
            onClose={() => setShowCreateVm(false)}
            onCreated={(name) => { setShowCreateVm(false); addToast(t("toast.vmCreated", { name }), "success"); addLog(t("log.vmCreated", { name }), "success"); refetch(); }}
            onError={(msg) => { handleError(msg); }}
          />}
          {showAssetModal  && <AssetModal initialData={editingHost ?? (addProtocol === "HORIZON"
            ? { id: "", name: "", host: "", username: "", protocol: "HORIZON", is_detected: false, is_hidden: false }
            : undefined)} isEditing={!!editingHost} isPending={addHost.isPending || updateHost.isPending} onClose={() => { setShowAssetModal(false); setEditingHost(null); }} onSubmit={handleAssetAction} />}
          {confirmDelete   && <ConfirmModal title={t("modal.deleteAsset.title")} message={t("modal.deleteAsset.body")} confirmText={t("modal.deleteAsset.confirm")} type="danger" onConfirm={handleDeleteHost} onClose={() => setConfirmDelete(null)} />}
          {replaceAsk && <ConfirmModal title={t("modal.slotFull.title")} message={t("modal.slotFull.body", { name: replaceAsk.name })} confirmText={t("modal.slotFull.confirm")} cancelText={t("modal.slotFull.no")} type="warning" onConfirm={() => connectToSlot("current", replaceAsk)} onClose={() => setReplaceAsk(null)} />}
          {errorModal      && <ConfirmModal title={errorModal.title} message={errorModal.body} confirmText={t("modal.ok")} onConfirm={() => setErrorModal(null)} onClose={() => setErrorModal(null)} />}
          {memoHost        && <MemoModal host={memoHost} onClose={() => setMemoHost(null)} onSaved={() => { refetch(); addToast(t("toast.memoSaved"), "success"); }} />}
        </motion.div>
      )}
    </AnimatePresence>
    </MotionConfig>
  );
}
