import { describe, it, expect } from "vitest";
import { getSlotCount } from "../lib/layout-utils";

describe("getSlotCount", () => {
  // ── 기존 동작 (GREEN 유지 필수) ─────────────────────────────
  it("1x1 레이아웃은 슬롯 1개를 반환한다", () => {
    expect(getSlotCount("1x1")).toBe(1);
  });

  it("2x2 레이아웃은 슬롯 4개를 반환한다", () => {
    expect(getSlotCount("2x2")).toBe(4);
  });

  it("알 수 없는 레이아웃은 4개를 반환한다 (기본값)", () => {
    expect(getSlotCount("unknown")).toBe(4);
  });
});
