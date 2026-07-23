import { describe, it, expect } from "vitest";
import { pickReachableIp } from "@/lib/net";

describe("pickReachableIp", () => {
  it("skips IPv6 link-local and APIPA, picks the real LAN IPv4", () => {
    expect(pickReachableIp(["fe80::1234:5678%12", "169.254.1.5", "192.168.1.50"])).toBe("192.168.1.50");
  });

  it("returns empty string when nothing usable is present", () => {
    expect(pickReachableIp(["fe80::1234%12", "169.254.1.5"])).toBe("");
    expect(pickReachableIp(undefined)).toBe("");
    expect(pickReachableIp([])).toBe("");
  });
});
