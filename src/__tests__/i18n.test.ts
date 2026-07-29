import { describe, it, expect } from "vitest";
import { translate, LANGS } from "@/lib/i18n";
import { en } from "@/locales/en";
import { ko } from "@/locales/ko";

/* translate()의 폴백 체인과 자리표시자 치환은 조용히 틀릴 수 있는 종류의
   로직이라(누락된 키가 화면에 빈칸으로 나가도 컴파일은 통과한다) 최소한의
   회귀 테스트를 남긴다. 사전 자체의 키 누락은 ko.ts의 타입이 컴파일 타임에
   잡으므로 여기선 검사하지 않는다 — 대신 "빈 값"만 확인한다. */
describe("translate", () => {
  it("선택한 언어의 값을 돌려준다", () => {
    expect(translate("en", "nav.dashboard")).toBe("Dashboard");
    expect(translate("ko", "nav.dashboard")).toBe("대시보드");
  });

  it("{n} 자리표시자를 치환한다", () => {
    expect(translate("en", "sidebar.nodesActive", { n: 3 })).toBe("3 nodes active");
  });

  it("같은 자리표시자가 여러 번 나와도 전부 치환한다", () => {
    // "Slot {n} (Alt+{n})" — 정규식에 /g가 빠지면 뒤쪽 {n}이 그대로 남는다.
    expect(translate("en", "rail.slotHint", { n: 2 })).toBe("Slot 2 (Alt+2)");
    expect(translate("ko", "rail.slotHint", { n: 2 })).toBe("슬롯 2 (Alt+2)");
  });

  it("값이 없는 자리표시자는 지우지 않고 그대로 남긴다", () => {
    // 빈 문자열로 지우면 번역 인자 누락을 화면에서 못 알아챈다.
    expect(translate("en", "rail.slotHint")).toBe("Slot {n} (Alt+{n})");
  });

  it("사전에 없는 언어가 들어와도 영어로 떨어진다", () => {
    // localStorage에 손으로 넣었거나 구버전에서 넘어온 값이 실제로 가능하다.
    expect(translate("fr" as never, "nav.dashboard")).toBe("Dashboard");
  });

  it("두 사전의 자리표시자 집합이 키마다 일치한다", () => {
    // en에 {n}이 있는데 ko에 없으면 그 언어에선 숫자가 통째로 사라지고, 반대면
    // 치환 안 된 "{n}"이 화면에 그대로 뜬다. 둘 다 컴파일도 통과하고 눈으로도
    // 안 잡히는 종류라 여기서 기계적으로 막는다.
    const holders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect([...holders(ko[k])].sort(), `key: ${k}`).toEqual([...holders(en[k])].sort());
    }
  });

  it("어느 사전에도 빈 문자열이 없다", () => {
    for (const lang of LANGS) {
      const dict = lang === "en" ? en : ko;
      for (const [k, v] of Object.entries(dict)) {
        expect(v, `${lang}.${k}`).not.toBe("");
      }
    }
  });
});
