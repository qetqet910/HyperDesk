import { useCallback } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { en } from "@/locales/en";
import { ko } from "@/locales/ko";

/* ─── i18n ───────────────────────────────────────────────────────────────────
   i18next를 쓰지 않는다. 이 앱은 SettingsContext가 이미 localStorage 영속 +
   변경 시 리렌더를 하고 있어서, 언어는 거기 필드 하나면 끝난다. i18next가
   추가로 파는 건 복수형 규칙(한국어엔 없고 영어도 이 앱엔 거의 안 쓰인다),
   네임스페이스 지연 로딩(언어 2개에 무의미), 로케일 감지(아래 한 줄)뿐이라
   패키지 3개를 들일 값이 없다. 언어가 5개를 넘거나 번역가에게 외주를 주게
   되면(Crowdin류 툴체인이 필요해지면) 그때 갈아타는 게 맞다.

   en이 정본(canonical)이다 — ko.ts는 `Record<Key, string>`으로 타입이 묶여
   있어서 en에 키를 추가하고 ko에 안 넣으면 **컴파일이 깨진다**. 번역 누락이
   런타임에 조용히 새는 걸 막는 게 이 구조의 핵심이라, ko를 Partial로 느슨하게
   바꾸지 말 것. */

export const LANGS = ["en", "ko"] as const;
export type Lang = (typeof LANGS)[number];
export type Key = keyof typeof en;

export const LANG_LABEL: Record<Lang, string> = { en: "English", ko: "한국어" };

const DICTS: Record<Lang, Record<Key, string>> = { en, ko };

/** `{name}` 자리표시자를 vars로 치환한다. 값이 없으면 자리표시자를 그대로 남겨
    화면에서 바로 눈에 띄게 한다(빈 문자열로 지우면 누락을 못 알아챈다). */
export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const s = DICTS[lang]?.[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export function useT() {
  const { settings } = useSettings();
  const lang = settings.lang;
  return useCallback(
    (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang]
  );
}
