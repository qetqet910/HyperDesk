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
import { useT, type Key } from "@/lib/i18n";

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
  /** 번역 키. 완성된 문자열이 아니라 키를 들고 있어야 언어를 바꿨을 때 이 상수
      배열이 아니라 렌더가 다시 평가된다(모듈 상수는 한 번만 만들어진다). */
  label: Key;
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
  { id: "dashboard", label: "nav.dashboard", icon: <LayoutDashboard size={15} /> },
  { id: "multiview", label: "nav.multiview", icon: <Layers size={15} />, badge: "LIVE", badgeColor: "var(--accent-green)" },
  { id: "vms",       label: "nav.vms",       icon: <Server size={15} /> },
  { id: "remote",    label: "nav.remote",    icon: <Globe size={15} /> },
  { id: "snapshots", label: "nav.snapshots", icon: <Camera size={15} /> },
  { id: "events",    label: "nav.events",    icon: <Terminal size={15} /> },
];

const SYSTEM_ITEMS: NavItem[] = [
  { id: "settings", label: "nav.settings", icon: <Settings size={15} /> },
];

export function Sidebar({ current, onNav, vmCount = 0, remoteCount = 0, runningCount = 0, occupiedSlots = 0 }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("hd_sidebar_collapsed") === "true"
  );
  const [appVersion, setAppVersion] = useState("");
  const t = useT();

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
      <div className="hd-sidebar__eyebrow">{t("sidebar.workspace")}</div>
      <nav className="hd-sidebar__nav">
        {workspaceItems.map((item) => (
          <button
            key={item.id}
            className={`hd-nav-item ${current === item.id ? "hd-nav-item--active" : ""} ${collapsed ? "hd-nav-item--icon-only" : ""}`}
            title={collapsed ? t(item.label) : undefined}
            /* 활성 항목은 색/보더로만 구분돼 있어 스크린 리더엔 안 보인다. */
            aria-current={current === item.id ? "page" : undefined}
            onClick={() => onNav(item.id)}
          >
            <span className="hd-nav-item__icon">{item.icon}</span>
            <span className="hd-nav-item__label">{t(item.label)}</span>
            {item.count != null && item.count > 0 && (
              <span className="hd-nav-item__count">{item.count}</span>
            )}
            {item.id === "multiview" && occupiedSlots > 0 && (
              <span className="hd-nav-item__slots" title={t("sidebar.slotsConnected", { n: occupiedSlots })}>{occupiedSlots}/4</span>
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
      <div className="hd-sidebar__eyebrow hd-sidebar__eyebrow--system">{t("sidebar.system")}</div>
      <nav className="hd-sidebar__nav">
        {SYSTEM_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`hd-nav-item ${current === item.id ? "hd-nav-item--active" : ""} ${collapsed ? "hd-nav-item--icon-only" : ""}`}
            title={collapsed ? t(item.label) : undefined}
            aria-current={current === item.id ? "page" : undefined}
            onClick={() => onNav(item.id)}
          >
            <span className="hd-nav-item__icon">{item.icon}</span>
            <span className="hd-nav-item__label">{t(item.label)}</span>
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
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>

        <div className="hd-sidebar__status">
          <div className="hd-sidebar__status-text">
            <div className="hd-sidebar__status-label">{t("sidebar.coreOnline")}</div>
            <div className="hd-sidebar__status-sub">{t("sidebar.nodesActive", { n: runningCount })}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
