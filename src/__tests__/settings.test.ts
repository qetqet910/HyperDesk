import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings } from "@/contexts/SettingsContext";

const save = (s: object) => localStorage.setItem("hyperdesk_settings", JSON.stringify(s));

beforeEach(() => localStorage.clear());

describe("loadSettings", () => {
  it("저장된 새로고침 간격을 2~300초로 맞춘다", () => {
    // 예전 입력칸은 범위를 안 지켜서 0(= 폴링 정지)이나 1초가 저장될 수 있었다.
    const cases: [unknown, number][] = [[0, 2000], [1000, 2000], [5000, 5000], [999_000, 300_000], ["abc", 10_000]];
    for (const [stored, want] of cases) {
      save({ pollingInterval: stored });
      expect(loadSettings().pollingInterval, `stored=${String(stored)}`).toBe(want);
    }
  });

  it("기존 사용자는 자동 새로고침을 한 번만 켜고, 그 뒤 다시 끈 값은 존중한다", () => {
    save({ autoRefresh: false }); // 1.4.0까지 첫 실행에 박힌 값
    expect(loadSettings().autoRefresh).toBe(true);
    save({ autoRefresh: false }); // 사용자가 다시 끔
    expect(loadSettings().autoRefresh).toBe(false);
  });

  it("새 설치는 켜짐이고, 끄면 다음 실행에도 꺼져 있다", () => {
    expect(loadSettings().autoRefresh).toBe(true);
    save({ autoRefresh: false });
    expect(loadSettings().autoRefresh).toBe(false);
  });

  it("두 번 연달아 불러도(StrictMode의 초기화 이중 호출) 이전 결과가 같다", () => {
    save({ autoRefresh: false });
    loadSettings();
    expect(loadSettings().autoRefresh).toBe(true);
  });
});
