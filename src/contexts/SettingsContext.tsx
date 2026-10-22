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

/** 자동 새로고침 간격 범위(초). 설정 화면 입력칸과 저장값 보정이 같이 쓴다. */
export const POLL_MIN_SEC = 2;
export const POLL_MAX_SEC = 300;

const DEFAULT_SETTINGS: Settings = {
  pollingInterval: 10000,
  defaultUsername: "Administrator",
  // 켜짐이 기본이다. 꺼져 있으면 VM 상태·지연 시간이 앱을 다시 볼 때만 바뀌고, CPU/메모리
  // 그래프는 조회 한 번에 점 하나씩만 쌓여(백엔드 SYSTEM_HISTORY) 사실상 빈 채로 남았다.
  // 기존 사용자는 아래 AUTO_REFRESH_MIGRATED로 한 번만 켠다.
  autoRefresh: true,
  viewMode: "dashboard",
  slotAssignments: {},
  theme: "dark",
  rdpColorDepth: 32,
  rdpQuality: "high",
  remoteAssetColumns: 1,
  vmColumns: 1,
  lang: navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en",
};

const STORAGE_KEY = "hyperdesk_settings";
// 자동 새로고침 기본값을 켜짐으로 바꾼 1.4.1의 1회 이전 표시. 설정은 첫 실행 때 **전체**가
// 저장되므로 그 전에 한 번이라도 켠 사용자는 전부 autoRefresh:false가 박혀 있어서, 기본값만
// 바꿔선 아무도 혜택을 못 받는다. 이 표시가 없을 때 딱 한 번 켜고, 그 뒤 끈 건 존중한다.
const AUTO_REFRESH_MIGRATED = "hd_autorefresh_on_v141";

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      localStorage.setItem(AUTO_REFRESH_MIGRATED, "1"); // 새 설치는 이미 켜짐 기본값이다
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(saved);
    if (!("theme" in parsed)) parsed.theme = "dark";
    delete parsed.layout; // removed: single-slot view only
    // 예전 입력칸은 범위를 안 지켜서 0(= 갱신 멈춤)이나 1초가 저장됐을 수 있다. 범위로 맞춘다.
    if ("pollingInterval" in parsed) {
      const p = Number(parsed.pollingInterval);
      parsed.pollingInterval = Number.isFinite(p)
        ? Math.min(POLL_MAX_SEC * 1000, Math.max(POLL_MIN_SEC * 1000, p))
        : DEFAULT_SETTINGS.pollingInterval;
    }
    if (localStorage.getItem(AUTO_REFRESH_MIGRATED) !== "1") {
      parsed.autoRefresh = true;
      // 바로 저장한다 — 개발 모드 StrictMode는 이 초기화 함수를 두 번 부르는데, 두 번째 호출이
      // 옛 값(false)을 다시 읽으면 이전이 사라진다.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      localStorage.setItem(AUTO_REFRESH_MIGRATED, "1");
    }
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
