import { describe, it, expect } from "vitest";
import { looksLikeHost } from "@/lib/net";

/* 오탐이 곧 UX 손상인 분기다 — 아무 검색어에나 "접속" 액션이 뜨면 팔레트 맨 위가
   쓰레기로 덮인다. 반대로 놓치면 Quick Connect 자체가 안 보인다. */
describe("looksLikeHost", () => {
  it("IPv4를 호스트로 본다", () => {
    expect(looksLikeHost("10.0.0.5")).toBe(true);
    expect(looksLikeHost("192.168.1.100")).toBe(true);
  });

  it("호스트명과 FQDN을 호스트로 본다", () => {
    expect(looksLikeHost("srv-01")).toBe(true);
    expect(looksLikeHost("dc01.corp.local")).toBe(true);
  });

  it("포트를 붙여도 인정한다", () => {
    expect(looksLikeHost("10.0.0.5:3389")).toBe(true);
    expect(looksLikeHost("srv-01:3390")).toBe(true);
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(looksLikeHost("  10.0.0.5  ")).toBe(true);
  });

  it("일반 검색어는 호스트로 보지 않는다", () => {
    // 공백이 있으면 무조건 탈락 — 팔레트 쿼리는 대부분 이쪽이다.
    expect(looksLikeHost("start web server")).toBe(false);
    expect(looksLikeHost("VM 설정")).toBe(false);
    expect(looksLikeHost("@prod")).toBe(false);
    expect(looksLikeHost("")).toBe(false);
  });

  it("순수 숫자는 호스트로 보지 않는다", () => {
    // "42"나 "3389"는 호스트가 아니라 그냥 숫자다. 글자도 점도 없으면 거른다.
    expect(looksLikeHost("42")).toBe(false);
    expect(looksLikeHost("3389")).toBe(false);
  });

  it("한글 검색어는 호스트로 보지 않는다", () => {
    // HOSTISH가 ASCII만 통과시키므로 걸린다. 한글 자산명을 칠 때 접속 액션이
    // 끼어들면 안 된다.
    expect(looksLikeHost("서버")).toBe(false);
    expect(looksLikeHost("웹서버-01")).toBe(false);
  });
});
