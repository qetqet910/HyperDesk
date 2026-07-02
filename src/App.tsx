import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, RefreshCw,
  Globe, Cpu, Settings as LucideSettings,
  Server
} from "lucide-react";
import { useDashboard, useSystemStats, useHostActions } from "./hooks/useDashboard";
import { parseError } from "./lib/error-utils";
import { useSettings } from "./contexts/SettingsContext";
import { useToast } from "./hooks/useToast";
import { applyTheme } from "./lib/theme";
import { HyperVCard, HorizonCard } from "./components/RackAsset";
import { Toast } from "./components/Toast";
import { SettingsPage } from "./components/SettingsPage";
import { VmSettingsModal } from "./components/VmSettingsModal";
import { MultiView } from "./components/MultiView";
import { SnapshotsPage } from "./components/SnapshotsPage";
import { AssetModal } from "./components/AssetModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { Sidebar, type Page } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { BentoCell } from "./components/BentoCell";
import { Sparkline } from "./components/Sparkline";
import { EventsPage } from "./components/EventsPage";
import { VmsPage } from "./components/VmsPage";
import { RemotePage } from "./components/RemotePage";
import { CommandPalette } from "./components/CommandPalette";
import { HeatmapView } from "./components/HeatmapView";
import { useVmActions } from "./hooks/useDashboard";
import type { VmInfo, RemoteHost } from "./types";
import { Reorder } from 'framer-motion';
import "./App.css";
import "./App.sidebar.css";

// ─── Utilities ────────────────────────────────────────────────────────────────

// ─── Page metadata ────────────────────────────────────────────────────────────

const PAGE_META: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "대시보드",     subtitle: "Virtualization Control Hub · Cool Blue" },
  multiview: { title: "멀티 뷰",      subtitle: "SwallowGrid™ · Live Remote Desktops" },
  vms:       { title: "가상 머신",    subtitle: "Hyper-V Units · Gen 1 + Gen 2" },
  remote:    { title: "원격 자산",    subtitle: "RDP · Horizon · MST" },
  snapshots: { title: "스냅샷",       subtitle: "복원 지점 및 체크포인트 관리" },
  events:    { title: "이벤트 로그",  subtitle: "실시간 시스템 스트림" },
  settings:  { title: "설정",         subtitle: "테마 · 동기화 · 업데이트" },
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { settings, updateSettings } = useSettings();
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
  const [showVmSettings, setShowVmSettings] = useState<VmInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ title: string; body: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const isOverlayActive = !!(showAssetModal || confirmDelete || showVmSettings || errorModal || showSearch);

  // ── Data ──
  const [logs, setLogs] = useState<{ id: string; msg: string; type: string; time: string }[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);

  const vms = data?.vms ?? [];
  const remoteHosts = data?.remote_hosts ?? [];
  const horizonHosts = useMemo(() => remoteHosts.filter(h => h.protocol === "HORIZON"), [remoteHosts]);
  const mstHostsList  = useMemo(() => remoteHosts.filter(h => h.protocol !== "HORIZON"), [remoteHosts]);
  const runningVms    = vms.filter(v => v.state === "Running").length;

  type AppRackAsset = { type: "HYPER_V"; id: string; data: VmInfo } | { type: "HORIZON"; id: string; data: RemoteHost };
  const [localRackAssets, setLocalRackAssets] = useState<AppRackAsset[]>([]);
  const [localMstHosts, setLocalMstHosts] = useState<RemoteHost[]>([]);
  const [localVms, setLocalVms] = useState<VmInfo[]>([]);
  const [dashboardView, setDashboardView] = useState<"rack" | "heatmap">("rack");

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
      { msg: "[SYSTEM] Booting HyperDesk Core Engine v1.0.3...", type: "info" },
      { msg: "[SCAN] Searching for Virtual Machines (Hyper-V)...", type: "info" },
      { msg: `[SUCCESS] ${vms.length} Hyper-V Units Online.`, type: "success" },
      { msg: "[SCAN] Mapping Remote Assets (RDP / Registry)...", type: "info" },
      { msg: `[SUCCESS] ${remoteHosts.length} Network Assets Indexed.`, type: "success" },
      { msg: "[SYSTEM] SYMMETRY GRID STABLE. ALL SYSTEMS GREEN.", type: "success" },
    ] as const;
    const timers = seq.map((s, i) => setTimeout(() => addLog(s.msg, s.type), i * 40));
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  const handleError = (raw: string) => {
    const err = parseError(raw);
    setErrorModal(err);
    addLog(`[ERROR] ${err.title}: ${err.body}`, "error");
  };

  const handleAssetAction = async (hostData: any) => {
    try {
      if (editingHost) {
        await updateHost.mutateAsync({ id: editingHost.id, ...hostData });
        addToast(`${hostData.name} 자산 정보가 동기화되었습니다.`, "success");
      } else {
        await addHost.mutateAsync(hostData);
        addToast(`${hostData.name} 자산이 등록되었습니다.`, "success");
      }
      setShowAssetModal(false);
      setEditingHost(null);
    } catch (e) { handleError(String(e)); }
  };

  const handleDeleteHost = async () => {
    if (!confirmDelete) return;
    try {
      await removeHost.mutateAsync(confirmDelete);
      addToast("자산 삭제가 완료되었습니다.", "info");
      setConfirmDelete(null);
    } catch (e) { handleError(String(e)); }
  };

  // ── Loading ──
  if (isLoading && !data) return (
    <div className="loading-screen"><RefreshCw size={36} className="spinning" /><p>관제 시스템 부팅 중...</p></div>
  );

  // ── Topbar actions per page ──
  const topbarActions = (
    <>
      {/* Add-asset is a primary action — surfaced on every page, not just VMs. */}
      {page !== "settings" && (
        <button
          className="tool-btn"
          onClick={() => { setEditingHost(null); setShowAssetModal(true); }}
          title="자산 추가"
        >
          <Plus size={15} />
        </button>
      )}
      <button className="tool-btn" onClick={() => setPage("settings")} title="설정">
        <LucideSettings size={15} />
      </button>
    </>
  );

  const meta = PAGE_META[page];

  // ─── Content Components ───────────────────────────────────────────────────


  // ─── Dashboard content (extracted for clarity) ───────────────────────────

  const DashboardContent = (
    <div className="dashboard-grid">
      {/* KPI Strip */}
      <div className="hd-kpi-strip" style={{ gridColumn: "1 / -1" }}>
        {(() => {
          const onlineRemote = remoteHosts.filter(h => h.status !== "TIMEOUT" && h.status !== "Offline").length;
          const latencyHosts = remoteHosts.filter(h => (h.latency ?? 0) > 0);
          const avgLatency = latencyHosts.length ? Math.round(latencyHosts.reduce((s, h) => s + (h.latency ?? 0), 0) / latencyHosts.length) : 0;
          const memUsedGB = ((statsData?.memory_used ?? data?.system_memory_used ?? 0) / 1024 / 1024);
          const memTotalGB = ((statsData?.memory_total ?? data?.system_memory_total ?? 1) / 1024 / 1024);
          const memPct = memTotalGB > 0 ? ((memUsedGB / memTotalGB) * 100).toFixed(1) : "0";
          return [
            { label: "활성 VM",     value: `${runningVms}/${vms.length}`,  delta: `${runningVms}개 실행 중`,    up: runningVms > 0, color: "var(--accent-green)" },
            { label: "메모리 사용",  value: `${memUsedGB.toFixed(1)} GB`,   delta: `${memPct}%`,                 up: true,           color: "var(--accent-blue)" },
            { label: "원격 자산",   value: `${onlineRemote}개 온라인`,      delta: `전체 ${remoteHosts.length}개`, up: true,          color: "var(--accent-blue)" },
            { label: "평균 레이턴시", value: `${avgLatency} ms`,            delta: `${latencyHosts.length}개 호스트`, up: avgLatency < 50, color: avgLatency < 50 ? "var(--accent-green)" : "var(--accent-orange)" },
          ].map((kpi) => (
            <div key={kpi.label} className="hd-kpi-tile">
              <div className="hd-kpi-label">{kpi.label}</div>
              <div className="hd-kpi-value" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className={`hd-kpi-delta ${kpi.up ? "up" : "dn"}`}>{kpi.up ? "▲" : "▼"} {kpi.delta}</div>
            </div>
          ));
        })()}
      </div>

      {/* Section: System Command Hub */}
      <div className="section-label"><h3>시스템 현황</h3><div className="section-line" /></div>

      <div style={{ gridColumn: "1 / -1", display: "flex", gap: "16px" }}>
        <BentoCell className="cell-master-hub" style={{ flex: 3, padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Cpu size={14} color="var(--accent-blue)" />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>리소스 모니터</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 500, color: "var(--accent-green)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent-green)", display: "inline-block" }} />
              {runningVms}/{vms.length} 실행 중
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
                <span>메모리</span><span>{(((statsData?.memory_used ?? data?.system_memory_used) ?? 0) / 1024 / 1024).toFixed(1)} GB</span>
              </div>
              <Sparkline data={memHistory} color="var(--accent-blue)" height={70} />
            </div>
          </div>

          {/* Bottom stat bar */}
          <div className="hub-stat-bar">
            <div className="hub-stat-item">
              <span className="hub-stat-label">디스크 여유</span>
              <div className="hub-stat-track">
                <div className="hub-stat-fill" style={{ width: "72%", background: "var(--accent-green)" }} />
              </div>
              <span className="hub-stat-value" style={{ color: "var(--accent-green)" }}>
                {(((statsData?.disk_free ?? data?.system_disk_free) ?? 0) / 1024).toFixed(0)} GB
              </span>
            </div>
            <div className="hub-stat-sep" />
            <div className="hub-stat-item">
              <span className="hub-stat-label">네트워크</span>
              <div className="hub-stat-track">
                <div className="hub-stat-fill" style={{ width: `${Math.min(100, ((statsData?.network_io ?? data?.system_network_io ?? 0) / 102400) * 100)}%`, background: "var(--accent-blue)" }} />
              </div>
              <span className="hub-stat-value" style={{ color: "var(--accent-blue)" }}>
                {(((statsData?.network_io ?? data?.system_network_io) ?? 0) / 1024).toFixed(1)} KB/s
              </span>
            </div>
            <div className="hub-stat-sep" />
            <div className="hub-stat-item">
              <span className="hub-stat-label">vCPU 합계</span>
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
        <BentoCell style={{ flex: 2, padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
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
              <div style={{ textAlign: "center", opacity: 0.3, padding: "24px", fontSize: "11px" }}>스냅샷 없음</div>
            )}
          </div>
        </BentoCell>
      </div>

      {/* Section: Virtualization Rack */}
      <div className="section-label">
        <h3>가상 머신 클러스터</h3>
        <div className="section-line" />
        <div style={{ display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)", padding: "2px", borderRadius: "7px", border: "1px solid var(--border)", flexShrink: 0 }}>
          {(["rack", "heatmap"] as const).map(v => (
            <button key={v} onClick={() => setDashboardView(v)}
              style={{ height: "22px", padding: "0 10px", borderRadius: "5px", border: "none", fontSize: "10px", fontWeight: 600, cursor: "pointer", background: dashboardView === v ? "var(--accent-blue)" : "transparent", color: dashboardView === v ? "#fff" : "var(--text-muted)", transition: "all 0.15s" }}>
              {v === "rack" ? "랙" : "히트맵"}
            </button>
          ))}
        </div>
      </div>
      <BentoCell className="cell-4x2" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>{vms.length + horizonHosts.length}개 노드</span>
          <span style={{ fontSize: "11px", color: "var(--accent-green)", fontWeight: 600, background: "rgba(34,197,94,0.08)", padding: "2px 10px", borderRadius: "6px", border: "1px solid rgba(34,197,94,0.2)" }}>
            {runningVms + horizonHosts.filter(h => h.status !== "Offline").length} / {vms.length + horizonHosts.length} 온라인
          </span>
        </div>
        {dashboardView === "heatmap" ? (
          <HeatmapView vms={vms} onVmClick={() => { setShowSearch(true); }} />
        ) : (
          <div className="rack-container no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "12px", overflowY: "scroll", maxHeight: "480px" }}>
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
                <div style={{ fontSize: "12px", fontWeight: 500 }}>감지된 VM이 없습니다</div>
              </div>
            )}
          </div>
        )}
      </BentoCell>

      {mstHostsList.length > 0 && <>
        <div className="section-label">
          <Globe size={14} color="var(--accent-blue)" /><h3>원격 자산</h3><div className="section-line" />
          <button className="hd-segment-btn" onClick={() => { setEditingHost(null); setShowAssetModal(true); }} title="원격 자산 등록">
            <Plus size={13} />
          </button>
        </div>
        <div className="mst-line-container">
          {/* MST rows — 새 랙 슬레드 스타일 */}
          <Reorder.Group axis="y" values={localMstHosts} onReorder={(o) => { setLocalMstHosts(o); localStorage.setItem("hyperdesk_mst_order", JSON.stringify(o.map(i => i.id))); }} style={{ display: "flex", flexDirection: "column", gap: "6px", listStyle: "none", padding: 0, margin: 0 }}>
            {localMstHosts.map((host) => {
              const isOffline = host.status === "TIMEOUT" || host.status === "Offline";
              const load = host.load ?? 0;
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
                    {/* 주소 */}
                    <div className="mst-rack-addr">{host.host}</div>
                    {/* 부하 게이지 */}
                    <div className="mst-rack-gauge">
                      <div className="mst-rack-track">
                        {!isOffline && load > 0 && <div className="mst-rack-fill" style={{ width: `${load}%` }} />}
                      </div>
                      <span className="mst-rack-pct" style={{ color: isOffline ? "var(--text-muted)" : "var(--text-main)" }}>
                        {isOffline ? "--" : `${Math.round(load)}%`}
                      </span>
                    </div>
                    {/* 액션 */}
                    <div className="mst-rack-actions">
                      <button
                        className={`mst-rack-connect ${isOffline ? "disabled" : ""}`}
                        disabled={isOffline}
                        onClick={() => !isOffline && connectHost.mutateAsync({ host: host.host, protocol: host.protocol, username: host.username })}
                      >
                        CONNECT ▸
                      </button>
                    </div>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </div>
      </>}
    </div>
  );

  // ─── Stats bar (shown below topbar) ─────────────────────────────────────────

  const StatsBar = (
    <div className="stats-bar">
      <div className="stat-item"><Server size={12} /><span>VM <strong>{vms.length}</strong> · <strong>{runningVms}</strong> UP</span></div>
      <span className="stat-sep">|</span>
      <div className="stat-item"><Globe size={12} /><span>원격지 <strong>{remoteHosts.length}</strong></span></div>
      <span className="stat-sep">|</span>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <Cpu size={12} />
        <span style={{ color: "var(--accent-green)" }}>{(statsData?.cpu ?? data?.system_cpu ?? 0).toFixed(1)}%</span>
      </div>
    </div>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-layout">
      {/* ── Left Sidebar ── */}
      <Sidebar
        current={page}
        onNav={(p) => {
          if (p === "events" || p === "dashboard" || p === "multiview" || p === "vms" || p === "remote" || p === "snapshots" || p === "settings") {
            setPage(p);
          }
        }}
        vmCount={vms.length}
        remoteCount={remoteHosts.length}
        runningCount={runningVms}
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
          {page === "multiview" ? (
            <MultiView data={{ vms, remoteHosts }} isOverlayActive={isOverlayActive} onError={(msg) => { addToast(msg, "error"); addLog(`[MULTIVIEW] ${msg}`, "error"); }} />
          ) : (
            <div className="hd-page" key={page}>
              {page === "dashboard" && DashboardContent}
              {page === "vms" && <VmsPage vms={vms} onError={handleError} onSuccess={(msg) => { addToast(msg, "success"); addLog(`[VM] ${msg}`, "success"); }} onSettings={setShowVmSettings} />}
              {page === "remote" && <RemotePage remoteHosts={remoteHosts} onConnect={(host, protocol, username) => connectHost.mutateAsync({ host, protocol, username })} onEdit={(host) => { setEditingHost(host); setShowAssetModal(true); }} onDelete={setConfirmDelete} onAdd={() => { setEditingHost(null); setShowAssetModal(true); }} />}
              {page === "snapshots" && <SnapshotsPage vms={vms} onSuccess={(msg) => { addToast(msg, "success"); addLog(`[SNAP] ${msg}`, "success"); }} onError={(msg) => { addToast(msg, "error"); addLog(`[SNAP] ${msg}`, "error"); }} />}
              {page === "events"    && <EventsPage logs={logs} onClear={() => setLogs([])} />}
              {page === "settings"  && <SettingsPage addToast={addToast} />}
            </div>
          )}
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
        onVmStart={(name) => { vmActions.start.mutate(name); addToast(`${name} 시작 중...`, "info"); }}
        onVmStop={(name) => { vmActions.stop.mutate(name); addToast(`${name} 종료 중...`, "info"); }}
        onVmSave={(name) => { vmActions.save.mutate(name); addToast(`${name} 상태 저장 중...`, "info"); }}
        onVmPause={(name) => { vmActions.pause.mutate(name); addToast(`${name} 일시정지 중...`, "info"); }}
        onVmResume={(name) => { vmActions.resume.mutate(name); addToast(`${name} 재개 중...`, "info"); }}
        onVmConnect={(vm) => {
          const ip = vm.ip_addresses?.[0];
          if (ip) vmActions.connect.mutate({ host: ip, username: undefined });
        }}
        onVmConsole={(name) => vmActions.console.mutate(name)}
        onVmSettings={(vm) => { setShowVmSettings(vm); closeSearch(); }}
        onHostConnect={(host) => connectHost.mutate({ host: host.host, protocol: host.protocol, username: host.username })}
        onHostEdit={(host) => { setEditingHost(host); setShowAssetModal(true); closeSearch(); }}
        onHostDelete={(host) => { setConfirmDelete(host.id); closeSearch(); }}
        onAddAsset={() => { setEditingHost(null); setShowAssetModal(true); closeSearch(); }}
        onThemeToggle={() => { const next = settings.theme === "light" ? "dark" : "light"; applyTheme(next); updateSettings({ theme: next }); }}
      />

      {showVmSettings  && <VmSettingsModal vm={showVmSettings} onClose={() => setShowVmSettings(null)} onLog={addLog} />}
      {showAssetModal  && <AssetModal initialData={editingHost ?? undefined} isEditing={!!editingHost} isPending={addHost.isPending || updateHost.isPending} onClose={() => { setShowAssetModal(false); setEditingHost(null); }} onSubmit={handleAssetAction} />}
      {confirmDelete   && <ConfirmModal title="자산 영구 삭제" message="선택한 원격 자산을 영구적으로 삭제하시겠습니까?" confirmText="영구 삭제 수행" type="danger" onConfirm={handleDeleteHost} onClose={() => setConfirmDelete(null)} />}
      {errorModal      && <ConfirmModal title={errorModal.title} message={errorModal.body} confirmText="확인" onConfirm={() => setErrorModal(null)} onClose={() => setErrorModal(null)} />}
    </div>
  );
}
