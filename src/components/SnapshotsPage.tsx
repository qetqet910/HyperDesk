import { useState, useEffect, useCallback } from "react";
import { Server, Plus, RotateCcw, Trash2, RefreshCw, Camera } from "lucide-react";
import type { VmInfo, VmSnapshot } from "@/types";
import { api } from "@/lib/tauri-api";
import { ConfirmModal } from "@/components/ConfirmModal";

interface SnapshotsPageProps {
  vms: VmInfo[];
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

interface SnapshotsByVm {
  [vmName: string]: VmSnapshot[];
}

export function SnapshotsPage({ vms, onSuccess, onError }: SnapshotsPageProps) {
  const [snapsByVm, setSnapsByVm] = useState<SnapshotsByVm>({});
  const [loading, setLoading] = useState(false);
  const [loadingVm, setLoadingVm] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // vm name being created for
  const [newSnapName, setNewSnapName] = useState("");
  const [confirmRestore, setConfirmRestore] = useState<{ vmName: string; snap: VmSnapshot } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ vmName: string; snap: VmSnapshot } | null>(null);
  const [selectedVm, setSelectedVm] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const results: SnapshotsByVm = {};
    await Promise.all(
      vms.map(async (vm) => {
        try {
          results[vm.name] = await api.listSnapshots(vm.name);
        } catch {
          results[vm.name] = [];
        }
      })
    );
    setSnapsByVm(results);
    setLoading(false);
  }, [vms]);

  useEffect(() => {
    if (vms.length > 0) fetchAll();
  }, [fetchAll]);

  const handleCreate = async (vmName: string) => {
    setLoadingVm(vmName);
    try {
      await api.createSnapshot(vmName, newSnapName.trim());
      onSuccess?.(`[스냅샷] ${vmName}: "${newSnapName || "자동 이름"}" 스냅샷 생성 완료`);
      setCreating(null);
      setNewSnapName("");
      const snaps = await api.listSnapshots(vmName);
      setSnapsByVm(prev => ({ ...prev, [vmName]: snaps }));
    } catch (e) {
      onError?.(String(e));
    } finally {
      setLoadingVm(null);
    }
  };

  const handleRestore = async () => {
    if (!confirmRestore) return;
    const { vmName, snap } = confirmRestore;
    setLoadingVm(vmName);
    setConfirmRestore(null);
    try {
      await api.restoreSnapshot(vmName, snap.name);
      onSuccess?.(`[스냅샷] ${vmName}: "${snap.name}" 복원 완료`);
      const snaps = await api.listSnapshots(vmName);
      setSnapsByVm(prev => ({ ...prev, [vmName]: snaps }));
    } catch (e) {
      onError?.(String(e));
    } finally {
      setLoadingVm(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { vmName, snap } = confirmDelete;
    setLoadingVm(vmName);
    setConfirmDelete(null);
    try {
      await api.deleteSnapshot(vmName, snap.name);
      onSuccess?.(`[스냅샷] ${vmName}: "${snap.name}" 삭제 완료`);
      const snaps = await api.listSnapshots(vmName);
      setSnapsByVm(prev => ({ ...prev, [vmName]: snaps }));
    } catch (e) {
      onError?.(String(e));
    } finally {
      setLoadingVm(null);
    }
  };

  const allTotal = Object.values(snapsByVm).reduce((s, arr) => s + arr.length, 0);

  return (
    <>
      <div className="dashboard-grid">
        {/* Header row */}
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" }}>
            <Camera size={14} color="var(--accent-blue)" />
            Hyper-V 체크포인트 관리
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "9px", fontWeight: 900, color: "var(--accent-blue)", background: "rgba(110,113,255,0.1)", padding: "2px 10px", borderRadius: "4px", border: "1px solid rgba(110,113,255,0.2)" }}>
              {allTotal} TOTAL
            </span>
            <button
              className="hd-btn hd-btn--small"
              onClick={fetchAll}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <RefreshCw size={11} className={loading ? "spinning" : ""} /> 새로고침
            </button>
          </div>
        </div>

        {/* VM selector tabs */}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            className={`hd-segment-btn ${selectedVm === null ? "active" : ""}`}
            onClick={() => setSelectedVm(null)}
          >
            전체 VM
          </button>
          {vms.map(vm => (
            <button
              key={vm.name}
              className={`hd-segment-btn ${selectedVm === vm.name ? "active" : ""}`}
              onClick={() => setSelectedVm(vm.name)}
            >
              <span style={{ fontSize: "9px", color: vm.state === "Running" ? "var(--accent-green)" : "var(--text-muted)" }}>●</span>
              {vm.name}
              {(snapsByVm[vm.name]?.length ?? 0) > 0 && (
                <span className="hd-segment-count">{snapsByVm[vm.name].length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Snapshot table per VM */}
        {vms
          .filter(vm => selectedVm === null || vm.name === selectedVm)
          .map(vm => {
            const snaps = snapsByVm[vm.name] ?? [];
            const isBusy = loadingVm === vm.name;
            const isCreatingThis = creating === vm.name;

            return (
              <div key={vm.name} style={{ gridColumn: "1 / -1" }}>
                {/* VM header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 16px",
                  background: "rgba(110,113,255,0.05)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px 10px 0 0",
                  borderBottom: "none",
                  justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Server size={13} color="var(--accent-blue)" />
                    <span style={{ fontSize: "12px", fontWeight: 800 }}>{vm.name}</span>
                    <span className={`status-dot ${vm.state === "Running" ? "online" : "offline"}`} />
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{vm.state}</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {isCreatingThis ? (
                      <>
                        <input
                          autoFocus
                          value={newSnapName}
                          onChange={e => setNewSnapName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleCreate(vm.name); if (e.key === "Escape") { setCreating(null); setNewSnapName(""); } }}
                          placeholder="스냅샷 이름 (선택)"
                          style={{
                            background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-focus)",
                            borderRadius: "6px", padding: "5px 10px", fontSize: "11px",
                            color: "var(--text-main)", outline: "none", width: "180px", fontFamily: "var(--font)"
                          }}
                        />
                        <button className="hd-btn hd-btn--small" disabled={isBusy} onClick={() => handleCreate(vm.name)}>
                          {isBusy ? <RefreshCw size={11} className="spinning" /> : "생성"}
                        </button>
                        <button className="hd-btn hd-btn--small" onClick={() => { setCreating(null); setNewSnapName(""); }}>취소</button>
                      </>
                    ) : (
                      <button
                        className="hd-btn hd-btn--small"
                        disabled={isBusy}
                        onClick={() => { setCreating(vm.name); setNewSnapName(""); }}
                        style={{ display: "flex", alignItems: "center", gap: "5px" }}
                      >
                        <Plus size={11} /> 스냅샷 생성
                      </button>
                    )}
                  </div>
                </div>

                {/* Snapshot list */}
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0 0 10px 10px",
                  overflow: "hidden",
                  marginBottom: "16px",
                }}>
                  {snaps.length === 0 ? (
                    <div style={{ padding: "28px", textAlign: "center", opacity: 0.35, fontSize: "12px" }}>
                      스냅샷 없음
                    </div>
                  ) : (
                    <table className="hd-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>이름</th>
                          <th>유형</th>
                          <th>생성 시각</th>
                          <th style={{ textAlign: "right" }}>액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snaps.map(snap => (
                          <tr key={snap.id || snap.name}>
                            <td style={{ fontWeight: 700 }}>{snap.name}</td>
                            <td><span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{snap.snapshot_type}</span></td>
                            <td style={{ fontSize: "11px", color: "var(--text-muted)" }}>{snap.creation_time || "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                                <button
                                  className="hd-btn hd-btn--small"
                                  disabled={isBusy}
                                  title="이 시점으로 복원"
                                  onClick={() => setConfirmRestore({ vmName: vm.name, snap })}
                                  style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--accent-blue)" }}
                                >
                                  <RotateCcw size={11} /> 복원
                                </button>
                                <button
                                  className="hd-btn hd-btn--small"
                                  disabled={isBusy}
                                  title="스냅샷 삭제"
                                  onClick={() => setConfirmDelete({ vmName: vm.name, snap })}
                                  style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--accent-red)" }}
                                >
                                  <Trash2 size={11} /> 삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}

        {vms.length === 0 && (
          <div style={{ gridColumn: "1 / -1", padding: "60px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
            <Camera size={32} style={{ marginBottom: "12px" }} />
            <div style={{ fontSize: "13px", fontWeight: 700 }}>가상 머신 없음</div>
          </div>
        )}
      </div>

      {confirmRestore && (
        <ConfirmModal
          title="스냅샷 복원"
          message={`[${confirmRestore.vmName}]을(를) "${confirmRestore.snap.name}" 시점으로 복원하시겠습니까?\nVM이 실행 중이면 강제 종료 후 복원됩니다. 저장되지 않은 데이터가 손실될 수 있습니다.`}
          confirmText="복원 수행"
          type="danger"
          onConfirm={handleRestore}
          onClose={() => setConfirmRestore(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="스냅샷 삭제"
          message={`"${confirmDelete.snap.name}" 스냅샷을 영구 삭제하시겠습니까?`}
          confirmText="영구 삭제"
          type="danger"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
