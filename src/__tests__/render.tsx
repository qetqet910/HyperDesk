import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";

// 번역(useT)을 쓰는 컴포넌트는 SettingsProvider 안에서만 렌더된다. 컴포넌트 테스트는
// 한국어 UI 문구로 단언하므로 설정 언어를 ko로 고정한다(jsdom 기본 언어는 en-US).
export function render(ui: ReactElement, options?: RenderOptions) {
  localStorage.setItem("hyperdesk_settings", JSON.stringify({ lang: "ko" }));
  return rtlRender(ui, { wrapper: SettingsProvider, ...options });
}
