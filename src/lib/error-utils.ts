export interface ParsedError {
  title: string;
  body: string;
}

export function parseError(raw: string): ParsedError {
  if (raw.includes("Insufficient system resources") || raw.includes("0x800705AA"))
    return { title: "시스템 RAM이 부족합니다", body: "가상 머신을 시작하기 위한 메모리(RAM)가 부족합니다." };
  if (raw.includes("Hyper-V PowerShell 모듈") || (raw.includes("Get-VM") && raw.includes("not recognized")))
    return { title: "Hyper-V를 사용할 수 없습니다", body: "Hyper-V PowerShell 모듈이 설치되어 있지 않습니다." };
  if (raw.includes("Cannot find vm") || raw.includes("No virtual machine"))
    return { title: "가상 머신을 찾을 수 없습니다", body: "지정한 이름의 VM이 존재하지 않습니다." };
  if (raw.includes("Access is denied") || raw.includes("access denied"))
    return { title: "권한이 없습니다", body: "관리자 권한이 필요합니다." };
  if (raw.includes("already running") || raw.includes("already started"))
    return { title: "이미 실행 중입니다", body: "VM이 이미 실행 중 상태입니다." };
  if (raw.includes("timed out") || raw.includes("Connection timed out"))
    return { title: "연결 시간 초과", body: "지정한 시간 내에 연결에 실패했습니다." };
  return { title: "작업 실패", body: raw.substring(0, 200) };
}
