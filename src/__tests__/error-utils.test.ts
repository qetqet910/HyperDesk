import { describe, it, expect } from "vitest";
import { parseError } from "../lib/error-utils";

describe("parseError", () => {
  // ── 기존 동작 (GREEN 유지 필수) ─────────────────────────────
  it("RAM 부족 에러를 한국어로 변환한다", () => {
    const r = parseError("Insufficient system resources exist to complete the API");
    expect(r.title).toBe("시스템 RAM이 부족합니다");
  });

  it("0x800705AA 에러코드를 RAM 부족으로 변환한다", () => {
    const r = parseError("0x800705AA failed");
    expect(r.title).toBe("시스템 RAM이 부족합니다");
  });

  it("알 수 없는 에러는 '작업 실패'를 반환한다", () => {
    const r = parseError("some totally unknown error");
    expect(r.title).toBe("작업 실패");
  });

  it("에러 본문을 200자로 자른다", () => {
    const long = "x".repeat(300);
    const r = parseError(long);
    expect(r.body.length).toBe(200);
  });

  // ── Feature 1: 추가 패턴 (현재 RED) ────────────────────────
  it("[F1] Hyper-V 모듈 미설치 에러를 인식한다", () => {
    const r = parseError("PowerShell error: Hyper-V PowerShell 모듈이 설치되어 있지 않습니다");
    expect(r.title).toBe("Hyper-V를 사용할 수 없습니다");
  });

  it("[F1] VM을 찾을 수 없는 에러를 인식한다", () => {
    const r = parseError("PowerShell error: Cannot find vm with name 'TestVM'");
    expect(r.title).toBe("가상 머신을 찾을 수 없습니다");
  });

  it("[F1] 접근 거부 에러를 인식한다", () => {
    const r = parseError("Access is denied");
    expect(r.title).toBe("권한이 없습니다");
  });

  it("[F1] VM이 이미 실행 중인 에러를 인식한다", () => {
    const r = parseError("The virtual machine is already running");
    expect(r.title).toBe("이미 실행 중입니다");
  });

  it("[F1] 연결 시간 초과 에러를 인식한다", () => {
    const r = parseError("Connection timed out");
    expect(r.title).toBe("연결 시간 초과");
  });
});
