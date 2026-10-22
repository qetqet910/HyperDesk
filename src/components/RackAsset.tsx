import { useState } from "react";
import {
  Monitor, RefreshCw, Trash2, Settings, Server, Cloud
} from "lucide-react";
import type { VmInfo, RemoteHost } from "@/types";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useVmActions, useHostActions } from "@/hooks/useDashboard";
import { useT } from "@/lib/i18n";

interface CardWrapperProps {
  name: string;
  statusText: string;
  isRunning: boolean;
  isOff: boolean;
  isBusy: boolean;
  animDelay: number;
  subtitles: React.ReactNode;
  metrics: React.ReactNode;
  controls: React.ReactNode;
  themeColor?: string;
  /** Origin badge — makes the data source (Hyper-V vs Omnissa) instantly recognizable
      even though both cards now share identical layout/metrics structure. */
  source: { label: string; icon: React.ReactNode };
}

export function CardWrapper({
  name, statusText, isRunning, isOff, isBusy, animDelay, subtitles, metrics, controls,
  themeColor = "var(--accent-blue)", source
}: CardWrapperProps) {
  return (
    <div
      className={`vm-module-row${isRunning ? " running" : ""}${isOff ? " offline" : ""}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '0',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: 'fadeInSlide 0.5s ease backwards',
        animationDelay: `${animDelay}ms`,
        position: 'relative',
        overflow: 'hidden',
        height: '62px',
        marginBottom: '2px'
      }}
    >
      {/* 0. Rack Handle Indicator */}
      <div style={{
        width: '10px',
        height: '100%',
        background: isRunning ? themeColor : 'rgba(255,255,255,0.03)',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '8px 0',
        alignItems: 'center',
        opacity: isRunning ? 0.7 : 0.2,
        flexShrink: 0
      }}>
        <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#fff', opacity: 0.4 }} />
        <div style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#fff', opacity: 0.4 }} />
      </div>

      <div className="vm-card-grid">
        {/* 1. Status Icon Section */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '8px',
            background: isRunning ? `color-mix(in srgb, ${themeColor} 15%, transparent)` : 'rgba(255,255,255,0.03)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isRunning ? themeColor : 'var(--text-muted)',
            border: `1px solid ${isRunning ? `color-mix(in srgb, ${themeColor} 33%, transparent)` : 'transparent'}`,
            transition: 'all 0.3s ease'
          }}>
            {isBusy ? <RefreshCw size={16} className="spinning" /> : <Monitor size={16} strokeWidth={1.5} />}
          </div>
        </div>

        {/* 2. Identity Section — 2×2 격자. 1열(이름/출처 배지)의 폭이 고정이라
               상태 배지와 서브타이틀이 행마다 **같은 x**에서 시작한다. 내용 폭에
               맡기면 이름 길이("v9.2" vs "SKAC")만큼 배지가 밀려 줄이 안 맞는다. */}
        <div className="vm-row-identity">
          <span className="vm-row-name" title={name}>{name}</span>
          <StatusBadge state={statusText} />
          <span className="vm-row-source" style={{
            color: themeColor,
            background: `color-mix(in srgb, ${themeColor} 18%, transparent)`,
            border: `1px solid color-mix(in srgb, ${themeColor} 35%, transparent)`,
          }}>
            {source.icon}
            {source.label}
          </span>
          <div className="vm-row-sub">{subtitles}</div>
        </div>

        {/* 3 & 4. Metrics Section (Unified Grid) */}
        {metrics}

        {/* 5. Controls Section */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {controls}
        </div>
      </div>
    </div>
  );
}

interface HyperVCardProps {
  vm: VmInfo;
  animDelay?: number;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
  onSettings?: () => void;
}

export function HyperVCard({ vm, animDelay = 0, onError, onSuccess, onSettings }: HyperVCardProps) {
  const t = useT();
  const { start, stop, resume, console: connectConsole } = useVmActions();
  const [isBusy, setIsBusy] = useState(false);
  // 종료는 `Stop-VM -Force`(앱이 막아도 내린다)라 한 번 묻는다 — 명령 팔레트·VM 설정 창은
  // 이미 확인을 받는데 카드만 클릭 한 번에 운영 VM이 내려갔다.
  const [confirmStop, setConfirmStop] = useState(false);

  const isRunning = vm.state === "Running";
  const isOff     = vm.state === "Off";
  const isPaused  = vm.state === "Paused";
  // 저장됨은 Start-VM으로 저장 시점부터 다시 켠다. 예전엔 이 상태에 종료 버튼이 떴다.
  const isSaved   = vm.state === "Saved";

  const run = async (fn: () => Promise<any>, successMsg?: string) => {
    setIsBusy(true);
    try {
      await fn();
      if (successMsg) onSuccess?.(successMsg);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setIsBusy(false);
    }
  };

  const memGB = (bytes: number) => (bytes && bytes > 0 ? (bytes / 1024 / 1024 / 1024).toFixed(1) : "0.0");
  const cpu = isRunning ? Math.min(Math.round(vm.cpu_usage || 0), 100) : 0;

  const subtitles = (
    <>
      <span>GEN {vm.generation}</span>
      <span style={{ opacity: 0.2 }}>|</span>
      <span>{vm.processor_count} vCPU</span>
    </>
  );

  const metrics = (
    <>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>{t("card.cpu")}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, color: isRunning ? 'var(--text-main)' : 'var(--text-muted)', fontFamily: 'var(--font-num)' }}>
            {cpu.toString().padStart(2, '0')}
          </span>
          <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 800 }}>%</span>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>{t("card.memory")}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, fontFamily: 'var(--font-num)' }}>
            {isRunning ? memGB(vm.memory_assigned) : memGB(vm.memory_startup)}
          </span>
          <span style={{ fontSize: '10px', opacity: 0.4, fontWeight: 800 }}>GB</span>
          {/* Status dot instead of the raw enum string: on a Korean host
              MemoryStatus can be a localized word that overflowed the column and
              collided with the STOP button. A 6px dot conveys OK/not-OK without
              ever growing the row. flexShrink:0 keeps it from being squeezed. */}
          {isRunning && (
            <span
              title={vm.memory_status}
              style={{
                width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                alignSelf: 'center', marginLeft: '3px',
                background: vm.memory_status === 'OK' ? 'var(--accent-green)' : 'var(--accent-orange)',
              }}
            />
          )}
        </div>
      </div>
    </>
  );

  const controls = (
    <>
      {isOff || isPaused || isSaved ? (
        <button
          className="action-btn start vm-row-action"
          disabled={isBusy}
          onClick={() => run(() => isPaused ? resume.mutateAsync(vm.name) : start.mutateAsync(vm.name), t("card.vmStarted", { name: vm.name }))}
        >
          {isPaused ? t("card.resume") : t("card.start")}
        </button>
      ) : (
        <button className="action-btn stop vm-row-action" disabled={isBusy}
          style={{ background: 'rgba(244,63,94,0.1)', color: 'var(--accent-red)', border: '1px solid rgba(244,63,94,0.2)' }}
          onClick={() => setConfirmStop(true)}>
          {t("card.stop")}
        </button>
      )}

      <button className="refresh-btn vm-row-icon" disabled={isBusy}
        onClick={onSettings} title={t("card.vmSettings")}>
        <Settings size={15} />
      </button>

      <button className="refresh-btn vm-row-icon" disabled={isBusy || isOff}
        onClick={() => run(() => connectConsole.mutateAsync(vm.name), t("card.consoleOpened"))} title={t("card.console")}>
        <Monitor size={15} />
      </button>
    </>
  );

  return (
    <>
      <CardWrapper
        name={vm.name}
        statusText={vm.state}
        isRunning={isRunning}
        isOff={isOff}
        isBusy={isBusy}
        animDelay={animDelay}
        subtitles={subtitles}
        metrics={metrics}
        controls={controls}
        themeColor="var(--accent-blue)"
        source={{ label: "HYPER-V", icon: <Server size={10} strokeWidth={2.5} /> }}
      />
      {/* ConfirmModal은 스스로 body에 뜬다 — 카드는 overflow:hidden에 드래그 중 transform이 걸린다. */}
      {confirmStop && (
        <ConfirmModal
          title={t("vmset.forceStopTitle")}
          message={t("vmset.forceStopBody", { name: vm.name })}
          confirmText={t("vmset.forceStopConfirm")}
          type="danger"
          onConfirm={() => run(() => stop.mutateAsync(vm.name), t("card.vmStopped", { name: vm.name }))}
          onClose={() => setConfirmStop(false)}
        />
      )}
    </>
  );
}

interface HorizonCardProps {
  host: RemoteHost;
  animDelay?: number;
  onEdit?: (host: RemoteHost) => void;
  /** 삭제(자동 감지 항목은 숨기기) 요청 — 확인 창과 토스트는 App의 공통 흐름이 맡는다. */
  onDelete?: (id: string) => void;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export function HorizonCard({ host, animDelay = 0, onEdit, onDelete, onError, onSuccess }: HorizonCardProps) {
  const t = useT();
  const { connect } = useHostActions();
  const [isBusy, setIsBusy] = useState(false);

  const isOffline = host.status === 'TIMEOUT' || host.status === 'Offline';
  
  const run = async (fn: () => Promise<any>, successMsg?: string) => {
    setIsBusy(true);
    try {
      await fn();
      if (successMsg) onSuccess?.(successMsg);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setIsBusy(false);
    }
  };

  const subtitles = (
    <>
      <span>BLAST PROTOCOL</span>
      <span style={{ opacity: 0.2 }}>|</span>
      <span style={{ color: isOffline ? 'var(--accent-red)' : 'var(--accent-green)', opacity: 0.8 }}>{isOffline ? t("card.down") : t("card.stable")}</span>
    </>
  );

  const metrics = (
    <>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>{t("card.latency")}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, color: isOffline ? 'var(--accent-red)' : 'var(--text-main)', fontFamily: 'var(--font-num)' }}>
            {isOffline ? '---' : host.latency?.toString().padStart(3, '0')}
          </span>
          <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 800 }}>ms</span>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>{t("card.load")}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, color: isOffline ? 'var(--accent-red)' : 'var(--text-main)', fontFamily: 'var(--font-num)' }}>
            {isOffline ? '--' : Math.round(host.load ?? 0).toString().padStart(2, '0')}
          </span>
          <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 800 }}>%</span>
        </div>
      </div>
    </>
  );

  const controls = (
    <>
      <button
        className="action-btn vdi vm-row-action"
        disabled={isBusy}
        // 글자색을 테마 색에서 가져온다 — 흰 글씨(#fff)는 라이트 테마의 옅은 바탕에서 사라졌다.
        style={isOffline
          ? { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }
          : { background: 'color-mix(in srgb, var(--accent-purple) 14%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 35%, transparent)' }}
        onClick={() => run(
          () => connect.mutateAsync({ host: host.host, protocol: host.protocol, username: host.username }),
          t("card.vdiConnecting")
        )}
      >
        {t("card.connect")}
      </button>

      <button className="refresh-btn vm-row-icon" disabled={isBusy} onClick={() => onEdit?.(host)} title={t("card.editAsset")}>
        <Settings size={15} />
      </button>

      {/* Hyper-V 행의 두 번째 아이콘 버튼과 같은 크기·모양 — 색만 위험색이다. 예전엔 확인 없이
          바로 지웠다 — 원격 자산 탭·VM 탭과 같은 App의 확인 흐름으로 보낸다. */}
      <button className="refresh-btn vm-row-icon vm-row-icon--danger" disabled={isBusy} onClick={() => onDelete?.(host.id)} title={t("card.deleteAsset")}>
        <Trash2 size={15} />
      </button>
    </>
  );

  return (
    <CardWrapper
      name={host.name}
      statusText={isOffline ? "Offline" : "Online"}
      isRunning={!isOffline}
      isOff={isOffline}
      isBusy={isBusy}
      animDelay={animDelay}
      subtitles={subtitles}
      metrics={metrics}
      controls={controls}
      themeColor="var(--accent-purple)"
      source={{ label: "OMNISSA", icon: <Cloud size={10} strokeWidth={2.5} /> }}
    />
  );
}
