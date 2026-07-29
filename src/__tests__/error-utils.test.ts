import { describe, it, expect } from "vitest";
import { parseError } from "@/lib/error-utils";
import { en } from "@/locales/en";

/* parseError가 완성된 문구 대신 번역 키를 돌려주도록 바뀌면서, 이 테스트도
   표시 문구가 아니라 **분류 결과**를 검증한다. 카피를 다듬어도 안 깨지고,
   틀린 분류만 잡는다 — 원래 이쪽이 이 함수가 하는 일에 맞는 검증이다.
   키가 실제 사전에 있는지는 마지막 테스트가 한 번에 확인한다. */
describe("parseError", () => {
  it("RAM 부족 에러를 분류한다", () => {
    expect(parseError("Insufficient system resources exist to complete the API").titleKey)
      .toBe("error.ram.title");
  });

  it("0x800705AA 에러코드를 RAM 부족으로 분류한다", () => {
    expect(parseError("0x800705AA failed").titleKey).toBe("error.ram.title");
  });

  it("알 수 없는 에러는 generic으로 떨어진다", () => {
    expect(parseError("some totally unknown error").titleKey).toBe("error.generic.title");
  });

  it("분류 실패 시 원문을 200자로 잘라 detail에 담는다", () => {
    const r = parseError("x".repeat(300));
    expect(r.detail?.length).toBe(200);
  });

  it("분류에 성공하면 detail을 채우지 않는다", () => {
    // detail이 있으면 UI가 bodyKey 대신 원문을 보여주므로, 분류된 에러에
    // 원문이 새면 번역된 안내문이 영어 스택트레이스로 대체된다.
    expect(parseError("Access is denied").detail).toBeUndefined();
  });

  it("Hyper-V 모듈 미설치 에러를 분류한다", () => {
    expect(parseError("PowerShell error: Hyper-V PowerShell 모듈이 설치되어 있지 않습니다").titleKey)
      .toBe("error.hyperv.title");
  });

  it("VM을 찾을 수 없는 에러를 분류한다", () => {
    expect(parseError("PowerShell error: Cannot find vm with name 'TestVM'").titleKey)
      .toBe("error.vmNotFound.title");
  });

  it("접근 거부 에러를 분류한다", () => {
    expect(parseError("Access is denied").titleKey).toBe("error.denied.title");
  });

  it("VM이 이미 실행 중인 에러를 분류한다", () => {
    expect(parseError("The virtual machine is already running").titleKey).toBe("error.running.title");
  });

  it("연결 시간 초과 에러를 분류한다", () => {
    expect(parseError("Connection timed out").titleKey).toBe("error.timeout.title");
  });

  it("돌려주는 키가 전부 사전에 실제로 존재한다", () => {
    const samples = [
      "Insufficient system resources", "0x800705AA", "Cannot find vm", "Access is denied",
      "already running", "timed out", "Hyper-V PowerShell 모듈", "unknown",
    ];
    for (const s of samples) {
      const r = parseError(s);
      expect(en[r.titleKey], `${s} → ${r.titleKey}`).toBeTruthy();
      expect(en[r.bodyKey], `${s} → ${r.bodyKey}`).toBeTruthy();
    }
  });
});
