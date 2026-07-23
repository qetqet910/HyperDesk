const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Get-VMNetworkAdapter's IPAddresses often lists an IPv6 link-local
// (fe80::…) or APIPA (169.254.x.x) address ahead of the real LAN IPv4 —
// picking array[0] blindly points RDP at an unreachable address.
export function pickReachableIp(ips?: string[]): string {
  return ips?.find((a) => IPV4.test(a) && !a.startsWith("169.254.")) ?? "";
}
