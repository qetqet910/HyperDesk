const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Get-VMNetworkAdapter's IPAddresses often lists an IPv6 link-local
// (fe80::…) or APIPA (169.254.x.x) address ahead of the real LAN IPv4 —
// picking array[0] blindly points RDP at an unreachable address.
export function pickReachableIp(ips?: string[]): string {
  return ips?.find((a) => IPV4.test(a) && !a.startsWith("169.254.")) ?? "";
}

// 커맨드 팔레트의 Quick Connect 판별. 표시 문자열이 아니라 **입력 분류**라
// 번역과 무관하다. 공백 없는 호스트명/IP(+선택적 :포트)만 통과시키고, 글자도
// 점도 없는 순수 숫자("42", "3389")는 호스트가 아니므로 거른다. ASCII만 통과하는
// 덕에 한글 자산명을 검색할 때 접속 액션이 끼어들지 않는다.
const HOSTISH = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d{1,5})?$/;
export function looksLikeHost(q: string): boolean {
  const s = q.trim();
  if (!HOSTISH.test(s)) return false;
  return /[a-zA-Z]/.test(s) || s.includes(".");
}
