import type { Key } from "@/lib/i18n";

/* 이 함수는 순수 함수라 useT()를 못 쓴다. 그래서 완성된 문구가 아니라 **번역
   키**를 돌려주고 표시는 호출자(UI)가 한다 — 분류는 로직, 문구는 UI라는
   분리가 원래 더 맞다. 부수 효과로 error-utils 테스트가 표시 문구가 아니라
   분류 결과를 검증하게 되어, 카피를 다듬어도 테스트가 안 깨진다. */
export interface ParsedError {
  titleKey: Key;
  /** 어느 패턴에도 안 걸렸을 땐 `detail`(원문 일부)을 대신 보여준다. */
  bodyKey: Key;
  detail?: string;
}

export function parseError(raw: string): ParsedError {
  if (raw.includes("Insufficient system resources") || raw.includes("0x800705AA"))
    return { titleKey: "error.ram.title", bodyKey: "error.ram.body" };
  // 이 한글 조각은 commands.rs가 PowerShell로 내보내는 원문(Write-Error)과 맞춘
  // 것이다 — 표시용이 아니라 **매칭 패턴**이므로 번역하면 안 된다. 백엔드 메시지를
  // 영문화하게 되면 여기 패턴도 같이 바꿔야 매칭이 유지된다.
  if (raw.includes("Hyper-V PowerShell 모듈") || (raw.includes("Get-VM") && raw.includes("not recognized")))
    return { titleKey: "error.hyperv.title", bodyKey: "error.hyperv.body" };
  if (raw.includes("Cannot find vm") || raw.includes("No virtual machine"))
    return { titleKey: "error.vmNotFound.title", bodyKey: "error.vmNotFound.body" };
  if (raw.includes("Access is denied") || raw.includes("access denied"))
    return { titleKey: "error.denied.title", bodyKey: "error.denied.body" };
  if (raw.includes("already running") || raw.includes("already started"))
    return { titleKey: "error.running.title", bodyKey: "error.running.body" };
  if (raw.includes("timed out") || raw.includes("Connection timed out"))
    return { titleKey: "error.timeout.title", bodyKey: "error.timeout.body" };
  return { titleKey: "error.generic.title", bodyKey: "error.generic.body", detail: raw.substring(0, 200) };
}
