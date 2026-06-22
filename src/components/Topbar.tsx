import {
  RefreshCw, Minus, Square, X, Copy,
  Sun, Moon, Search
} from "lucide-react";
import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../contexts/SettingsContext";
import { applyTheme } from "../lib/theme";

interface TopbarProps {
  title: string;
  subtitle?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  actions?: React.ReactNode;
  onSearch?: () => void;
}

function getTauriWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function Topbar({ title, subtitle, isRefreshing, onRefresh, actions, onSearch }: TopbarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const { settings, updateSettings } = useSettings();

  useEffect(() => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;
    const updateState = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };
    updateState();
    const unlisten = appWindow.onResized(updateState);
    return () => { unlisten.then((u: () => void) => u()); };
  }, []);

  const toggleTheme = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = settings.theme === "light" ? "dark" : "light";
    applyTheme(next);
    updateSettings({ theme: next });
  };

  return (
    <header className="hd-topbar" data-tauri-drag-region>
      <div className="hd-topbar__left">
        <h2 className="hd-topbar__title">{title}</h2>
        {subtitle && <span className="hd-topbar__subtitle">{subtitle}</span>}
      </div>

      <div className="hd-topbar__right">
        <div className="hd-topbar__actions" data-tauri-drag-region="false">
          {onSearch && (
            <button className="tool-btn" onClick={(e) => { e.stopPropagation(); onSearch(); }} title="검색 (Ctrl+K)">
              <Search size={14} />
            </button>
          )}
          {actions}
          <button
            className="tool-btn"
            onClick={toggleTheme}
            title={settings.theme === "light" ? "Dark Mode" : "Light Mode"}
          >
            {settings.theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          {onRefresh && (
            <button className={`tool-btn ${isRefreshing ? "spinning" : ""}`} onClick={(e) => { e.stopPropagation(); onRefresh(); }} title="새로고침">
              <RefreshCw size={14} />
            </button>
          )}
        </div>

        <div className="hd-topbar__window-controls" data-tauri-drag-region="false">
          <button className="window-control-btn" onClick={() => getTauriWindow()?.minimize()} title="최소화">
            <Minus size={14} />
          </button>
          <button className="window-control-btn" onClick={() => getTauriWindow()?.toggleMaximize()} title={isMaximized ? "복원" : "최대화"}>
            {isMaximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button className="window-control-btn window-control-btn--close" onClick={() => getTauriWindow()?.close()} title="닫기">
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
