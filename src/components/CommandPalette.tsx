import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Fuse from "fuse.js";
import { useT, type Key } from "@/lib/i18n";
import {
  Search, Server, Globe, LayoutDashboard, Layers, Camera,
  Terminal, Play, Square, Pause, Save, Monitor,
  Plus, Settings, ChevronRight, AlertTriangle, Wifi, Pencil, Trash2, Sun, Zap,
} from "lucide-react";
import type { VmInfo, RemoteHost } from "@/types";
import type { Page } from "@/components/Sidebar";
import { looksLikeHost } from "@/lib/net";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaletteMode =
  | { type: "root" }
  | { type: "vm-context"; vm: VmInfo }
  | { type: "host-context"; host: RemoteHost }
  | { type: "confirm"; label: string; onConfirm: () => void };

interface VmAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  requiresStates?: string[];  // only shown when VM is in one of these states
  run: (vm: VmInfo) => void;
}

interface HostAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  run: (host: RemoteHost) => void;
}

interface PaletteProps {
  isOpen: boolean;
  onClose: () => void;
  vms: VmInfo[];
  remoteHosts: RemoteHost[];
  onNav: (page: Page) => void;
  onVmStart: (name: string) => void;
  onVmStop: (name: string) => void;
  onVmSave: (name: string) => void;
  onVmPause: (name: string) => void;
  onVmResume: (name: string) => void;
  onVmConnect: (vm: VmInfo) => void;
  onVmConsole: (name: string) => void;
  onVmSettings: (vm: VmInfo) => void;
  onHostConnect: (host: RemoteHost) => void;
  onHostEdit: (host: RemoteHost) => void;
  onHostDelete: (host: RemoteHost) => void;
  onAddAsset: () => void;
  onThemeToggle: () => void;
  /** Quick connect: 등록되지 않은 호스트/IP로 즉시 RDP. 팔레트에 친 문자열이
      그대로 넘어가므로 호출자가 프로토콜/계정 기본값을 정한다. */
  onQuickConnect: (host: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// 사이드바·Topbar와 같은 nav.* 키를 재사용한다.
const PAGES: { id: Page; labelKey: Key; icon: React.ReactNode }[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: <LayoutDashboard size={14} /> },
  { id: "multiview", labelKey: "nav.multiview", icon: <Layers size={14} /> },
  { id: "vms",       labelKey: "nav.vms",       icon: <Server size={14} /> },
  { id: "remote",    labelKey: "nav.remote",    icon: <Globe size={14} /> },
  { id: "snapshots", labelKey: "nav.snapshots", icon: <Camera size={14} /> },
  { id: "events",    labelKey: "nav.events",    icon: <Terminal size={14} /> },
  { id: "settings",  labelKey: "nav.settings",  icon: <Settings size={14} /> },
];

const STATE_COLOR: Record<string, string> = {
  Running: "var(--accent-green)",
  Off:     "var(--text-muted)",
  Paused:  "var(--accent-orange)",
  Saved:   "var(--accent-orange)",
};

// 모듈 레벨 함수라 훅을 못 쓴다 — t를 인자로 받는다. 알 수 없는 상태는 원문
// 그대로 돌려준다(Hyper-V가 새 상태를 추가해도 빈칸이 되지 않게).
function stateLabel(state: string, t: ReturnType<typeof useT>) {
  const map: Record<string, string> = {
    Running: t("vmState.Running"),
    Off:     t("vmState.Off"),
    Paused:  t("vmState.Paused"),
    Saved:   t("vmState.Saved"),
  };
  return map[state] ?? state;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CommandPalette({
  isOpen, onClose, vms, remoteHosts, onNav,
  onVmStart, onVmStop, onVmSave, onVmPause, onVmResume,
  onVmConnect, onVmConsole, onVmSettings, onHostConnect, onHostEdit, onHostDelete,
  onAddAsset, onThemeToggle, onQuickConnect,
}: PaletteProps) {
  const t = useT();
  // PAGES는 키만 들고 있으므로 여기서 현재 언어로 풀어 쓴다. 검색도 풀린 라벨을
  // 대상으로 하므로 영어 UI에선 "dash"가, 한국어 UI에선 "대시"가 걸린다
  // (p.id는 항상 영문이라 양쪽에서 다 매칭된다).
  const pages = useMemo(() => PAGES.map(p => ({ ...p, label: t(p.labelKey) })), [t]);
  const [mode, setMode] = useState<PaletteMode>({ type: "root" });
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmInput, setConfirmInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setMode({ type: "root" });
      setQuery("");
      setSelectedIndex(0);
      setConfirmInput("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // ── VM actions definition ──
  const buildVmActions = useCallback((vm: VmInfo): VmAction[] => [
    {
      id: "start",   label: t("cmd.vm.start"), icon: <Play size={14} />,
      requiresStates: ["Off", "Saved"],
      run: (v: VmInfo) => { onVmStart(v.name); onClose(); },
    },
    {
      id: "stop",    label: t("cmd.vm.stop"), icon: <Square size={14} />, destructive: true,
      requiresStates: ["Running", "Paused"],
      run: (v: VmInfo) => setMode({ type: "confirm", label: t("cmd.vm.stopConfirm", { name: v.name }), onConfirm: () => { onVmStop(v.name); onClose(); } }),
    },
    {
      id: "save",    label: t("cmd.vm.save"), icon: <Save size={14} />,
      requiresStates: ["Running"],
      run: (v: VmInfo) => { onVmSave(v.name); onClose(); },
    },
    {
      id: "pause",   label: t("cmd.vm.pause"), icon: <Pause size={14} />,
      requiresStates: ["Running"],
      run: (v: VmInfo) => { onVmPause(v.name); onClose(); },
    },
    {
      id: "resume",  label: t("cmd.vm.resume"), icon: <Play size={14} />,
      requiresStates: ["Paused", "Saved"],
      run: (v: VmInfo) => { onVmResume(v.name); onClose(); },
    },
    {
      id: "rdp",     label: t("cmd.vm.rdp"), icon: <Monitor size={14} />,
      requiresStates: ["Running"],
      run: (v: VmInfo) => { onVmConnect(v); onClose(); },
    },
    {
      id: "console", label: t("cmd.vm.console"), icon: <Terminal size={14} />,
      run: (v: VmInfo) => { onVmConsole(v.name); onClose(); },
    },
    {
      id: "snapshot", label: t("cmd.vm.snapshot"), icon: <Camera size={14} />,
      run: () => { onNav("snapshots"); onClose(); },
    },
    {
      id: "settings", label: t("cmd.vm.settings"), icon: <Settings size={14} />,
      run: (v: VmInfo) => { onVmSettings(v); onClose(); },
    },
  ].filter(a => !a.requiresStates || a.requiresStates.includes(vm.state)),
  [onVmStart, onVmStop, onVmSave, onVmPause, onVmResume, onVmConnect, onVmConsole, onVmSettings, onNav, onClose, t]);

  // ── Host actions definition (same 3 actions regardless of host) ──
  const buildHostActions = useCallback((): HostAction[] => [
    {
      id: "connect", label: t("cmd.host.connect"), icon: <Monitor size={14} />,
      run: (h: RemoteHost) => { onHostConnect(h); onClose(); },
    },
    {
      id: "edit", label: t("cmd.host.edit"), icon: <Pencil size={14} />,
      run: (h: RemoteHost) => { onHostEdit(h); onClose(); },
    },
    {
      id: "delete", label: t("cmd.host.delete"), icon: <Trash2 size={14} />, destructive: true,
      run: (h: RemoteHost) => setMode({ type: "confirm", label: t("cmd.host.deleteConfirm", { name: h.name }), onConfirm: () => { onHostDelete(h); onClose(); } }),
    },
  ],
  [onHostConnect, onHostEdit, onHostDelete, onClose, t]);

  // ── Fuzzy search setup ──
  const vmFuse = useMemo(() => new Fuse(vms, {
    keys: ["name", "ip_addresses", "state"],
    threshold: 0.4,
    includeScore: true,
  }), [vms]);

  const hostFuse = useMemo(() => new Fuse(remoteHosts, {
    keys: ["name", "host", "protocol"],
    threshold: 0.4,
    includeScore: true,
  }), [remoteHosts]);

  // ── Detect action-first query (e.g. "start", "stop") ──
  // **표시 문자열이 아니라 검색 별칭이다 — 번역하지 말 것.** 영어 UI를 쓰는
  // 한국인이 "시작"을 쳐도 걸려야 하므로 두 언어를 모두 남긴다. 이걸 t()로
  // 바꾸면 언어를 바꾼 순간 반대쪽 언어 검색이 죽는다.
  const ACTION_KEYWORDS: Record<string, string[]> = {
    start:   ["start", "시작", "켜"],
    stop:    ["stop", "종료", "끄"],
    pause:   ["pause", "일시정지"],
    resume:  ["resume", "재개"],
    save:    ["save", "저장"],
    rdp:     ["rdp", "연결", "connect"],
    console: ["console", "콘솔"],
    snapshot:["snapshot", "스냅샷"],
  };

  function detectActionKeyword(q: string): string | null {
    const lower = q.trim().toLowerCase();
    for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
      if (keywords.some(k => lower === k || lower.startsWith(k + " "))) return action;
    }
    return null;
  }

  // ── Build result list ──
  type ResultItem =
    | { kind: "section-header"; label: string }
    | { kind: "page"; id: Page; label: string; icon: React.ReactNode }
    | { kind: "vm"; vm: VmInfo }
    | { kind: "host"; host: RemoteHost }
    | { kind: "vm-action"; action: VmAction; vm: VmInfo }
    | { kind: "host-action"; action: HostAction; host: RemoteHost }
    | { kind: "global-action"; label: string; icon: React.ReactNode; run: () => void }
    | { kind: "quick-connect"; host: string };

  const results: ResultItem[] = useMemo(() => {
    if (mode.type === "host-context") {
      const host = mode.host;
      const actions = buildHostActions();
      const q = query.trim().toLowerCase();
      const filtered = q
        ? actions.filter(a => a.label.toLowerCase().includes(q) || a.id.includes(q))
        : actions;
      const items: ResultItem[] = [];
      if (filtered.length) {
        items.push({ kind: "section-header", label: t("cmd.section.hostActions", { name: host.name }) });
        filtered.forEach(a => items.push({ kind: "host-action", action: a, host }));
      }
      return items;
    }

    if (mode.type === "vm-context") {
      const vm = mode.vm;
      const actions = buildVmActions(vm);
      const q = query.trim().toLowerCase();
      const filtered = q
        ? actions.filter(a => a.label.toLowerCase().includes(q) || a.id.includes(q))
        : actions;
      const items: ResultItem[] = [];
      if (filtered.length) {
        items.push({ kind: "section-header", label: t("cmd.section.vmActions", { name: vm.name }) });
        filtered.forEach(a => items.push({ kind: "vm-action", action: a, vm }));
      }
      return items;
    }

    const q = query.trim();

    if (!q) {
      const items: ResultItem[] = [];
      items.push({ kind: "section-header", label: t("cmd.section.pages") });
      pages.forEach(p => items.push({ kind: "page", ...p }));
      items.push({ kind: "section-header", label: t("cmd.section.actions") });
      items.push({ kind: "global-action", label: t("cmd.addAsset"), icon: <Plus size={14} />, run: () => { onAddAsset(); onClose(); } });
      items.push({ kind: "global-action", label: t("cmd.themeToggle"), icon: <Sun size={14} />, run: () => { onThemeToggle(); onClose(); } });
      return items;
    }

    // ── @tag 쿼리 ──
    if (q.startsWith("@")) {
      const tagQuery = q.slice(1).toLowerCase();
      const matchedVms = vms.filter(v => v.tags?.some(t => t.toLowerCase().includes(tagQuery)));
      const matchedHosts = remoteHosts.filter(h => h.tags?.some(t => t.toLowerCase().includes(tagQuery)));
      const items: ResultItem[] = [];
      if (!tagQuery) {
        // Show all unique tags
        const allTags = new Set([
          ...vms.flatMap(v => v.tags ?? []),
          ...remoteHosts.flatMap(h => h.tags ?? []),
        ]);
        if (allTags.size) {
          items.push({ kind: "section-header", label: t("cmd.section.tagsInUse") });
          [...allTags].sort().forEach(tag =>
            items.push({ kind: "global-action", label: `@${tag}`, icon: null, run: () => { /* refine */ } })
          );
        } else {
          items.push({ kind: "section-header", label: t("cmd.section.noTags") });
        }
        return items;
      }
      if (matchedVms.length) {
        items.push({ kind: "section-header", label: t("cmd.section.tagVms", { tag: tagQuery, n: matchedVms.length }) });
        matchedVms.forEach(vm => items.push({ kind: "vm", vm }));
      }
      if (matchedHosts.length) {
        items.push({ kind: "section-header", label: t("cmd.section.tagHosts", { tag: tagQuery, n: matchedHosts.length }) });
        matchedHosts.forEach(host => items.push({ kind: "host", host }));
      }
      if (!matchedVms.length && !matchedHosts.length) {
        items.push({ kind: "section-header", label: t("cmd.section.tagNone", { tag: tagQuery }) });
      }
      return items;
    }

    // Check action-first mode
    const detectedAction = detectActionKeyword(q);
    if (detectedAction) {
      const applicableVms = vms.filter(vm => {
        const actions = buildVmActions(vm);
        return actions.some(a => a.id === detectedAction);
      });
      const items: ResultItem[] = [];
      if (applicableVms.length) {
        items.push({ kind: "section-header", label: t("cmd.section.pickVm", { q }) });
        applicableVms.forEach(vm => items.push({ kind: "vm", vm }));
      } else {
        items.push({ kind: "section-header", label: t("cmd.section.noStateVms") });
      }
      return items;
    }

    const items: ResultItem[] = [];

    // Fuzzy VM search
    const vmResults = vmFuse.search(q).slice(0, 5);
    if (vmResults.length) {
      items.push({ kind: "section-header", label: t("cmd.section.vms") });
      vmResults.forEach(r => items.push({ kind: "vm", vm: r.item }));
    }

    // Fuzzy host search
    const hostResults = hostFuse.search(q).slice(0, 4);
    if (hostResults.length) {
      items.push({ kind: "section-header", label: t("cmd.section.remote") });
      hostResults.forEach(r => items.push({ kind: "host", host: r.item }));
    }

    // Page search
    const pageResults = pages.filter(p =>
      p.label.toLowerCase().includes(q.toLowerCase()) || p.id.includes(q.toLowerCase())
    );
    if (pageResults.length) {
      items.push({ kind: "section-header", label: t("cmd.section.pages") });
      pageResults.forEach(p => items.push({ kind: "page", ...p }));
    }

    // Quick connect — **반드시 마지막에 push한다.** 맨 앞에 넣었더니 "srv"처럼
    // 호스트명스러운 부분 검색어에서도 이게 1번 항목이 되어, 기존 VM을 찾으려고
    // 이름 일부를 치고 Enter를 누르면 존재하지도 않는 호스트로 접속을 시도했다.
    // 마지막에 넣으면 아무것도 안 걸렸을 때만 1번이 되므로(빈 배열에 push =
    // 맨 위) IP를 통째로 친 데모 경로는 그대로 살고, 검색 경로는 안 망가진다.
    // 그 주소로 등록된 자산이 이미 있으면 아예 띄우지 않는다(같은 줄 중복).
    if (looksLikeHost(q) && !remoteHosts.some(h => h.host === q || h.name === q)) {
      if (items.length) items.push({ kind: "section-header", label: t("cmd.section.quickConnect") });
      items.push({ kind: "quick-connect", host: q });
    }

    return items;
  }, [query, mode, vms, remoteHosts, vmFuse, hostFuse, buildVmActions, buildHostActions, onAddAsset, onThemeToggle, onClose, pages, t, onQuickConnect]);

  // Only selectable items (not headers)
  const selectableResults = results.filter(r => r.kind !== "section-header");
  const clampedIndex = Math.min(selectedIndex, Math.max(0, selectableResults.length - 1));

  // ── Keyboard handler ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, selectableResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      if (mode.type !== "root") {
        setMode({ type: "root" });
        setQuery("");
        setSelectedIndex(0);
      } else {
        onClose();
      }
    } else if (e.key === "Backspace" && query === "" && (mode.type === "vm-context" || mode.type === "host-context")) {
      setMode({ type: "root" });
      setSelectedIndex(0);
    } else if (e.key === "Enter") {
      const item = selectableResults[clampedIndex];
      if (!item) return;
      activateItem(item);
    }
  }, [mode, query, selectableResults, clampedIndex, onClose]);

  function activateItem(item: ResultItem) {
    if (item.kind === "quick-connect") {
      onQuickConnect(item.host);
      onClose();
    } else if (item.kind === "page") {
      onNav(item.id);
      onClose();
    } else if (item.kind === "vm") {
      if (mode.type === "root") {
        setMode({ type: "vm-context", vm: item.vm });
        setQuery("");
        setSelectedIndex(0);
      }
    } else if (item.kind === "host") {
      if (mode.type === "root") {
        setMode({ type: "host-context", host: item.host });
        setQuery("");
        setSelectedIndex(0);
      }
    } else if (item.kind === "vm-action") {
      item.action.run(item.vm);
    } else if (item.kind === "host-action") {
      item.action.run(item.host);
    } else if (item.kind === "global-action") {
      item.run();
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${clampedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  // Track selectable index
  let selectableCounter = -1;

  if (!isOpen) return null;

  // ── Confirm mode ──
  if (mode.type === "confirm") {
    return (
      <div className="hd-palette-overlay" style={overlayStyle} onClick={onClose}>
        <div className="hd-palette" style={{ ...paletteStyle, border: "1.5px solid var(--accent-red)" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid rgba(244,63,94,0.2)" }}>
            <AlertTriangle size={16} color="var(--accent-red)" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent-red)" }}>{mode.label}</span>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px" }}>
              {t("cmd.confirm.prompt")} <code style={{ background: "rgba(244,63,94,0.1)", padding: "1px 6px", borderRadius: "4px", color: "var(--accent-red)" }}>CONFIRM</code> {t("cmd.confirm.promptTail")}
            </p>
            <input
              autoFocus
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setMode({ type: "root" }); setConfirmInput(""); }
                if (e.key === "Enter" && confirmInput === "CONFIRM") { mode.onConfirm(); setConfirmInput(""); }
              }}
              placeholder="CONFIRM"
              style={{
                width: "100%", background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.3)",
                borderRadius: "8px", padding: "10px 14px", color: confirmInput === "CONFIRM" ? "var(--accent-red)" : "var(--text-main)",
                fontSize: "14px", fontWeight: 700, outline: "none", letterSpacing: "1px",
              }}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button onClick={() => { setMode({ type: "root" }); setConfirmInput(""); }}
                style={{ flex: 1, height: "34px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "12px" }}>
                {t("cmd.confirm.cancel")}
              </button>
              <button
                disabled={confirmInput !== "CONFIRM"}
                onClick={() => { if (confirmInput === "CONFIRM") { mode.onConfirm(); setConfirmInput(""); } }}
                style={{ flex: 1, height: "34px", borderRadius: "8px", border: "none", background: confirmInput === "CONFIRM" ? "var(--accent-red)" : "rgba(244,63,94,0.15)", color: confirmInput === "CONFIRM" ? "#fff" : "rgba(244,63,94,0.4)", cursor: confirmInput === "CONFIRM" ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 600 }}>
                {t("cmd.confirm.run")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal / VM-context mode ──
  return (
    <div className="hd-palette-overlay" style={overlayStyle} onClick={onClose}>
      <div className="hd-palette" style={paletteStyle} onClick={e => e.stopPropagation()}>

        {/* Input row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          {mode.type === "vm-context" || mode.type === "host-context" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <span style={{ fontSize: "11px", background: "rgba(110,113,255,0.12)", border: "1px solid rgba(110,113,255,0.25)", borderRadius: "5px", padding: "2px 8px", color: "var(--accent-blue)", fontWeight: 600, whiteSpace: "nowrap", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {mode.type === "vm-context" ? mode.vm.name : mode.host.name}
              </span>
              <ChevronRight size={12} color="var(--text-muted)" />
            </div>
          ) : (
            <Search size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={mode.type === "vm-context" || mode.type === "host-context" ? t("cmd.placeholderAction") : t("cmd.placeholder")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: "14px", color: "var(--text-main)", minWidth: 0 }}
          />
          <kbd style={{ fontSize: "10px", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 6px", flexShrink: 0 }}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="no-scrollbar" style={{ maxHeight: "380px", overflowY: "auto", padding: "6px" }}>
          {selectableResults.length === 0 && query.trim() !== "" && (
            <div style={{ padding: "32px", textAlign: "center", fontSize: "12px", color: "var(--text-muted)" }}>{t("cmd.noResults")}</div>
          )}
          {results.map((item, i) => {
            if (item.kind === "section-header") {
              return (
                <div key={`h-${i}`} style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", padding: "10px 10px 4px", letterSpacing: "0.3px" }}>
                  {item.label}
                </div>
              );
            }

            selectableCounter++;
            const idx = selectableCounter;
            const isSelected = idx === clampedIndex;

            if (item.kind === "vm") {
              const color = STATE_COLOR[item.vm.state] ?? "var(--text-muted)";
              return (
                <div
                  key={`vm-${item.vm.name}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={rowStyle(isSelected)}
                >
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <Server size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500 }}>{item.vm.name}</span>
                  <span style={{ fontSize: "10px", color, fontWeight: 500 }}>{stateLabel(item.vm.state, t)}</span>
                  {item.vm.cpu_usage > 0 && (
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "8px" }}>CPU {item.vm.cpu_usage.toFixed(0)}%</span>
                  )}
                  {mode.type === "root" && <ChevronRight size={12} color="var(--text-muted)" style={{ marginLeft: "4px" }} />}
                </div>
              );
            }

            if (item.kind === "host") {
              const isOffline = item.host.status === "TIMEOUT" || item.host.status === "Offline";
              return (
                <div
                  key={`host-${item.host.id}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={{ ...rowStyle(isSelected), opacity: isOffline ? 0.6 : 1 }}
                >
                  <Wifi size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500 }}>{item.host.name}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{item.host.host}</span>
                  <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "4px", background: "rgba(110,113,255,0.1)", color: "var(--accent-blue)", marginLeft: "6px", fontWeight: 600 }}>
                    {item.host.protocol}
                  </span>
                  {mode.type === "root" && <ChevronRight size={12} color="var(--text-muted)" style={{ marginLeft: "4px" }} />}
                </div>
              );
            }

            if (item.kind === "quick-connect") {
              return (
                <div
                  key="quick-connect"
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={rowStyle(isSelected)}
                >
                  <Zap size={14} color="var(--accent-green)" />
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 600 }}>
                    {t("cmd.quickConnect", { host: item.host })}
                  </span>
                  <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "4px", background: "var(--accent-wash)", color: "var(--accent-soft)", fontWeight: 700 }}>
                    RDP
                  </span>
                </div>
              );
            }

            if (item.kind === "page") {
              return (
                <div
                  key={`page-${item.id}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={rowStyle(isSelected)}
                >
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500 }}>{item.label}</span>
                </div>
              );
            }

            if (item.kind === "vm-action") {
              const { action, vm } = item;
              return (
                <div
                  key={`act-${action.id}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={{ ...rowStyle(isSelected), ...(action.destructive ? destructiveRowOverride(isSelected) : {}) }}
                >
                  <span style={{ flexShrink: 0, color: action.destructive ? "var(--accent-red)" : "var(--text-muted)" }}>{action.icon}</span>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: action.destructive ? "var(--accent-red)" : "var(--text-main)" }}>{action.label}</span>
                  {action.destructive && <AlertTriangle size={11} color="var(--accent-red)" style={{ marginLeft: "4px" }} />}
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "4px" }}>{vm.name}</span>
                </div>
              );
            }

            if (item.kind === "host-action") {
              const { action, host } = item;
              return (
                <div
                  key={`hact-${action.id}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={{ ...rowStyle(isSelected), ...(action.destructive ? destructiveRowOverride(isSelected) : {}) }}
                >
                  <span style={{ flexShrink: 0, color: action.destructive ? "var(--accent-red)" : "var(--text-muted)" }}>{action.icon}</span>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: action.destructive ? "var(--accent-red)" : "var(--text-main)" }}>{action.label}</span>
                  {action.destructive && <AlertTriangle size={11} color="var(--accent-red)" style={{ marginLeft: "4px" }} />}
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "4px" }}>{host.name}</span>
                </div>
              );
            }

            if (item.kind === "global-action") {
              return (
                <div
                  key={`g-${item.label}`}
                  data-idx={idx}
                  onClick={() => activateItem(item)}
                  style={rowStyle(isSelected)}
                >
                  <span style={{ flexShrink: 0, color: "var(--text-muted)" }}>{item.icon}</span>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 500 }}>{item.label}</span>
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "14px" }}>
          {[
            ["↑↓", t("cmd.hint.move")],
            ["Enter", t("cmd.hint.select")],
            [mode.type === "vm-context" || mode.type === "host-context" ? "Esc / ←" : "Esc", mode.type === "vm-context" || mode.type === "host-context" ? t("cmd.hint.back") : t("cmd.hint.close")],
          ].map(([key, label]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "var(--text-muted)" }}>
              <kbd style={{ border: "1px solid var(--border)", borderRadius: "3px", padding: "1px 5px", fontSize: "9px" }}>{key}</kbd>
              {label}
            </span>
          ))}
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-muted)" }}>
            {t("cmd.results", { n: selectableResults.length })}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9000,
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  paddingTop: "100px",
};

const paletteStyle: React.CSSProperties = {
  width: "560px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  overflow: "hidden",
  willChange: "transform, opacity",
};

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "9px 10px", borderRadius: "8px", cursor: "pointer",
    background: selected ? "rgba(110,113,255,0.12)" : "transparent",
    border: selected ? "1px solid rgba(110,113,255,0.2)" : "1px solid transparent",
    transition: "background 0.1s",
  };
}

function destructiveRowOverride(selected: boolean): React.CSSProperties {
  return {
    background: selected ? "rgba(244,63,94,0.1)" : "transparent",
    border: selected ? "1px solid rgba(244,63,94,0.2)" : "1px solid transparent",
  };
}
