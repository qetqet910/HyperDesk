import { useState } from "react";
import {
  Monitor, RefreshCw, Trash2, Settings, Server, Cloud
} from "lucide-react";
import type { VmInfo, RemoteHost } from "@/types";
import { StatusBadge } from "@/components/StatusBadge";
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

  const isRunning = vm.state === "Running";
  const isOff     = vm.state === "Off";
  const isPaused  = vm.state === "Paused";

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
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>CPU Load</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, color: isRunning ? 'var(--text-main)' : 'var(--text-muted)', fontFamily: 'var(--font-num)' }}>
            {cpu.toString().padStart(2, '0')}
          </span>
          <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 800 }}>%</span>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>Memory Allocation</div>
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
      {isOff || isPaused ? (
        <button
          className="action-btn start vm-row-action"
          disabled={isBusy}
          onClick={() => run(() => isPaused ? resume.mutateAsync(vm.name) : start.mutateAsync(vm.name), t("card.vmStarted", { name: vm.name }))}
        >
          START
        </button>
      ) : (
        <button className="action-btn stop vm-row-action" disabled={isBusy}
          style={{ background: 'rgba(244,63,94,0.1)', color: 'var(--accent-red)', border: '1px solid rgba(244,63,94,0.2)' }}
          onClick={() => run(() => stop.mutateAsync(vm.name), t("card.vmStopped", { name: vm.name }))}>
          STOP
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
  );
}

interface HorizonCardProps {
  host: RemoteHost;
  animDelay?: number;
  onEdit?: (host: RemoteHost) => void;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export function HorizonCard({ host, animDelay = 0, onEdit, onError, onSuccess }: HorizonCardProps) {
  const t = useT();
  const { connect, removeHost } = useHostActions();
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
      <span style={{ color: isOffline ? 'var(--accent-red)' : 'var(--accent-green)', opacity: 0.8 }}>{isOffline ? 'DOWN' : 'STABLE'}</span>
    </>
  );

  const metrics = (
    <>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>Net Latency</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '16px', fontWeight: 900, color: isOffline ? 'var(--accent-red)' : 'var(--text-main)', fontFamily: 'var(--font-num)' }}>
            {isOffline ? '---' : host.latency?.toString().padStart(3, '0')}
          </span>
          <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 800 }}>ms</span>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.04)', paddingLeft: '20px' }}>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 800 }}>Server Load</div>
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
        style={{ background: isOffline ? 'rgba(255,255,255,0.03)' : 'rgba(100,100,255,0.1)', color: isOffline ? 'var(--text-muted)' : '#fff', border: isOffline ? '1px solid var(--border)' : 'none' }}
        onClick={() => run(
          () => connect.mutateAsync({ host: host.host, protocol: host.protocol, username: host.username }),
          t("card.vdiConnecting")
        )}
      >
        CONNECT
      </button>

      <button className="refresh-btn vm-row-icon" disabled={isBusy} onClick={() => onEdit?.(host)} title={t("card.editAsset")}>
        <Settings size={15} />
      </button>

      {/* Hyper-V 행의 두 번째 아이콘 버튼과 같은 크기·모양 — 색만 위험색이다. */}
      <button className="refresh-btn vm-row-icon vm-row-icon--danger" disabled={isBusy} onClick={() => run(() => removeHost.mutateAsync(host.id), t("card.assetDeleted"))} title={t("card.deleteAsset")}>
        <Trash2 size={15} />
      </button>
    </>
  );

  return (
    <CardWrapper
      name={host.name}
      statusText={isOffline ? "Ping Timeout" : "Online"}
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
