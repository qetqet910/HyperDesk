import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/tauri-api";
import { VmInfo, VmSwitch, VmNetworkAdapter, SystemStats } from "../types";
import { BentoCell } from "./BentoCell";
import { Sparkline } from "./Sparkline";

interface NetworkPageProps {
  vms: VmInfo[];
  statsData?: SystemStats;
  netHistory: number[];
}

export function NetworkPage({ vms, statsData, netHistory }: NetworkPageProps) {
  const [switches, setSwitches] = useState<VmSwitch[]>([]);
  const [adapters, setAdapters] = useState<VmNetworkAdapter[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNetworkInfo = async () => {
    setLoading(true);
    const [sw, ad] = await Promise.allSettled([
      api.getVmSwitches(),
      api.getVmNetworkAdapters(),
    ]);
    if (sw.status === "fulfilled") setSwitches(sw.value);
    if (ad.status === "fulfilled") setAdapters(ad.value);
    setLoading(false);
  };

  useEffect(() => {
    fetchNetworkInfo();
  }, []);

  const getSwitchForVm = (vmName: string): string => {
    const adapter = adapters.find(a => a.vm_name === vmName);
    return adapter?.switch_name || "—";
  };

  const getSwitchType = (switchName: string): string => {
    const sw = switches.find(s => s.name === switchName);
    if (!sw) return "";
    return sw.switch_type;
  };

  const netIo = (statsData?.network_io ?? 0) / 1024;

  return (
    <div className="dashboard-grid">
      <div className="section-label" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px" }}>
        <h3>네트워크 인터페이스 및 트래픽</h3>
        <div className="section-line" style={{ flex: 1 }} />
        <button className="hd-btn hd-btn--small" onClick={fetchNetworkInfo} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <RefreshCw size={11} className={loading ? "spinning" : ""} /> 새로고침
        </button>
      </div>

      <BentoCell className="cell-4x2" style={{ gridColumn: "1 / -1", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
          <div className="stat-card">
            <div className="stat-label">실시간 I/O</div>
            <div className="stat-value" style={{ color: "var(--accent-green)" }}>{netIo.toFixed(1)} KB/s</div>
            <Sparkline data={netHistory} color="var(--accent-green)" height={40} suffix=" KB/s" />
          </div>
          <div className="stat-card">
            <div className="stat-label">vSwitch 수</div>
            <div className="stat-value">{loading ? "..." : switches.length}</div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
              {switches.filter(s => s.switch_type === "External").length} External ·{" "}
              {switches.filter(s => s.switch_type === "Internal").length} Internal ·{" "}
              {switches.filter(s => s.switch_type === "Private").length} Private
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">활성 커넥션</div>
            <div className="stat-value">{vms.filter(v => (v.ip_addresses?.length ?? 0) > 0).length}</div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>IP 할당된 VM</div>
          </div>
        </div>

        {/* vSwitch list */}
        {switches.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--text-muted)", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>
              Virtual Switch 목록
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {switches.map(sw => (
                <div key={sw.name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                  <span style={{
                    fontSize: "9px", fontWeight: 900, padding: "2px 7px", borderRadius: "4px",
                    background: sw.switch_type === "External" ? "rgba(0,255,153,0.1)" : sw.switch_type === "Internal" ? "rgba(110,113,255,0.1)" : "rgba(255,255,255,0.05)",
                    color: sw.switch_type === "External" ? "var(--accent-green)" : sw.switch_type === "Internal" ? "var(--accent-blue)" : "var(--text-muted)",
                    border: `1px solid ${sw.switch_type === "External" ? "rgba(0,255,153,0.2)" : sw.switch_type === "Internal" ? "rgba(110,113,255,0.2)" : "var(--border)"}`,
                  }}>
                    {sw.switch_type.toUpperCase()}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: "12px", flex: 1 }}>{sw.name}</span>
                  {sw.net_adapter_name && (
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{sw.net_adapter_name}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VM network table */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--text-muted)", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>
            VM IP 할당 목록
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "20px", opacity: 0.4, fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <RefreshCw size={13} className="spinning" /> vSwitch 정보 로딩 중...
            </div>
          ) : (
            <table className="hd-table">
              <thead>
                <tr>
                  <th>가상 머신</th>
                  <th>IP 주소</th>
                  <th>vSwitch</th>
                  <th>타입</th>
                </tr>
              </thead>
              <tbody>
                {vms.map(vm => {
                  const switchName = getSwitchForVm(vm.name);
                  const switchType = getSwitchType(switchName);
                  return (
                    <tr key={vm.name}>
                      <td style={{ fontWeight: 700 }}>{vm.name}</td>
                      <td>{(vm.ip_addresses?.length ?? 0) > 0 ? vm.ip_addresses?.join(", ") : <span style={{ opacity: 0.3 }}>N/A</span>}</td>
                      <td>{switchName}</td>
                      <td>
                        {switchType ? (
                          <span style={{
                            fontSize: "9px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px",
                            background: switchType === "External" ? "rgba(0,255,153,0.08)" : switchType === "Internal" ? "rgba(110,113,255,0.08)" : "rgba(255,255,255,0.04)",
                            color: switchType === "External" ? "var(--accent-green)" : switchType === "Internal" ? "var(--accent-blue)" : "var(--text-muted)",
                          }}>
                            {switchType}
                          </span>
                        ) : <span style={{ opacity: 0.3 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {vms.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", opacity: 0.3 }}>VM 없음</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </BentoCell>
    </div>
  );
}
