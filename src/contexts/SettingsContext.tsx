import { createContext, useContext, useState, useEffect, ReactNode } from "react";
// 타입만 가져온다 — i18n.ts는 useSettings를 쓰므로 값을 import하면 순환이 된다.
// `import type`은 컴파일 시 지워져서 런타임 순환이 생기지 않는다. 로케일 감지는
// 한 줄짜리라 아래 DEFAULT_SETTINGS에 인라인으로 둔다(i18n.ts에 헬퍼로 두면
// 값 import가 되어 순환이 생긴다 — 실제로 한 번 그렇게 만들었다가 걷어냈다).
import type { Lang } from "@/lib/i18n";

export interface Settings {
  pollingInterval: number;
  defaultUsername: string;
  autoRefresh: boolean;
  viewMode: "dashboard" | "multiview";
  slotAssignments: Record<string, string>;
  theme: "dark" | "light" | "retro";
  rdpColorDepth: 16 | 32;
  rdpQuality: "low" | "balanced" | "high";
  /** Remote-asset list layout, shared by the Dashboard's remote-assets section
      and the Remote Assets page (same list, same preference either place). */
  remoteAssetColumns: 1 | 2;
  /** VM cluster list layout — same 1/2-column toggle as remoteAssetColumns, but
      independent so the VM page and the remote-asset page remember their own. */
  vmColumns: 1 | 2;
  /** UI 언어. 저장된 설정이 없으면 OS 로케일에서 추론하고, 한국어가 아니면
      영어로 떨어진다 — 해외 사용자가 처음 켰을 때 영어가 보여야 하기 때문. */
  lang: Lang;
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
  remoteAssetColumns: 1,
  vmColumns: 1,
  lang: navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en",
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

  // index.html은 `<html lang="ko">`로 하드코딩돼 있어서, UI를 영어로 바꿔도
  // 문서는 계속 한국어라고 선언한다. 스크린 리더 발음과 Chromium의 CJK 줄바꿈
  // 규칙이 이 속성을 보므로 실제 언어를 따라가야 한다.
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

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
