import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface Settings {
  pollingInterval: number;
  defaultUsername: string;
  autoRefresh: boolean;
  viewMode: "dashboard" | "multiview";
  slotAssignments: Record<string, string>;
  theme: "dark" | "light" | "retro";
  rdpColorDepth: 16 | 32;
  rdpQuality: "low" | "balanced" | "high";
}

const DEFAULT_SETTINGS: Settings = {
  pollingInterval: 10000,
  defaultUsername: "Administrator",
  autoRefresh: false,
  viewMode: "dashboard",
  slotAssignments: {},
  theme: "dark",
  rdpColorDepth: 32,
  rdpQuality: "balanced",
};

const STORAGE_KEY = "hyperdesk_settings";

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(saved);
    if (!("theme" in parsed)) parsed.theme = "dark";
    delete parsed.layout; // removed: single-slot view only
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (updates: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
