import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Layers,
  Server,
  Globe,
  Camera,
  Terminal,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

export type Page =
  | "dashboard"
  | "multiview"
  | "vms"
  | "remote"
  | "snapshots"
  | "events"
  | "settings";

interface NavItem {
  id: Page;
  label: string;
  icon: React.ReactNode;
  count?: number;
  badge?: string;
  badgeColor?: string;
}

interface SidebarProps {
  current: Page;
  onNav: (page: Page) => void;
  vmCount?: number;
  remoteCount?: number;
  runningCount?: number;
  /** Number of multiview slots (0–4) currently holding a connection assignment.
      Rendered as an "N/4" pill on the 멀티 뷰 nav item. */
  occupiedSlots?: number;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { id: "dashboard", label: "대시보드",    icon: <LayoutDashboard size={15} /> },
  { id: "multiview", label: "멀티 뷰",     icon: <Layers size={15} />, badge: "LIVE", badgeColor: "var(--accent-green)" },
  { id: "vms",       label: "가상 머신",   icon: <Server size={15} /> },
  { id: "remote",    label: "원격 자산",   icon: <Globe size={15} /> },
  { id: "snapshots", label: "스냅샷",      icon: <Camera size={15} /> },
  { id: "events",    label: "이벤트 로그", icon: <Terminal size={15} /> },
];

const SYSTEM_ITEMS: NavItem[] = [
  { id: "settings", label: "설정", icon: <Settings size={15} /> },
];

export function Sidebar({ current, onNav, vmCount = 0, remoteCount = 0, runningCount = 0, occupiedSlots = 0 }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("hd_sidebar_collapsed") === "true"
  );
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    localStorage.setItem("hd_sidebar_collapsed", String(collapsed));
    // Modals center against the main content area, not the full window — they read this var.
    document.documentElement.style.setProperty("--hd-sidebar-w", collapsed ? "58px" : "220px");
  }, [collapsed]);

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  // Ctrl+B toggles the sidebar — the familiar editor convention, replacing the old footer "접기" text button.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const workspaceItems = WORKSPACE_ITEMS.map((item) => {
    if (item.id === "vms")    return { ...item, count: vmCount };
    if (item.id === "remote") return { ...item, count: remoteCount };
    return item;
  });

  return (
    <aside className={`hd-sidebar ${collapsed ? "hd-sidebar--collapsed" : ""}`}>
      {/* Logo */}
      <div className="hd-sidebar__brand">
        <div className="hd-sidebar__logo-text">
          <span className="hd-sidebar__logo-name">HYPERDESK</span>
          <span className="hd-sidebar__version">{appVersion ? `v${appVersion}` : ""}</span>
        </div>
      </div>

      {/* Workspace nav */}
      <div className="hd-sidebar__eyebrow">Workspace</div>
      <nav className="hd-sidebar__nav">
        {workspaceItems.map((item) => (
          <button
            key={item.id}
            className={`hd-nav-item ${current === item.id ? "hd-nav-item--active" : ""} ${collapsed ? "hd-nav-item--icon-only" : ""}`}
            title={collapsed ? item.label : undefined}
            onClick={() => onNav(item.id)}
          >
            <span className="hd-nav-item__icon">{item.icon}</span>
            <span className="hd-nav-item__label">{item.label}</span>
            {item.count != null && item.count > 0 && (
              <span className="hd-nav-item__count">{item.count}</span>
            )}
            {item.id === "multiview" && occupiedSlots > 0 && (
              <span className="hd-nav-item__slots" title={`${occupiedSlots}개 슬롯 연결됨`}>{occupiedSlots}/4</span>
            )}
            {item.badge && (
              <span
                className="hd-nav-item__badge"
                style={{ color: item.badgeColor ?? "var(--accent-blue)", borderColor: item.badgeColor ?? "var(--accent-blue)" }}
              >
                ● {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* System nav */}
      <div className="hd-sidebar__eyebrow hd-sidebar__eyebrow--system">System</div>
      <nav className="hd-sidebar__nav">
        {SYSTEM_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`hd-nav-item ${current === item.id ? "hd-nav-item--active" : ""} ${collapsed ? "hd-nav-item--icon-only" : ""}`}
            title={collapsed ? item.label : undefined}
            onClick={() => onNav(item.id)}
          >
            <span className="hd-nav-item__icon">{item.icon}</span>
            <span className="hd-nav-item__label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer — button is DOM-first so that when collapsed it stacks ABOVE the
          status (footer is bottom-anchored, grows upward, dot stays put). When
          expanded the button is absolutely positioned inline with "Core Online". */}
      <div className="hd-sidebar__footer">
        <button
          className="hd-sidebar__collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          style={{position: "absolute"}}
          title={collapsed ? "사이드바 펼치기 (Ctrl+B)" : "사이드바 접기 (Ctrl+B)"}
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>

        <div className="hd-sidebar__status">
          <div className="hd-sidebar__status-text">
            <div className="hd-sidebar__status-label">Core Online</div>
            <div className="hd-sidebar__status-sub">{runningCount} nodes active</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
