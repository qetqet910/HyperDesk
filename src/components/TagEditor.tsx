import { useState, useRef, KeyboardEvent } from "react";
import { X } from "lucide-react";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
}

// Suggested tag prefixes (env:, role:, region:)
const SUGGESTIONS = [
  "env:production", "env:staging", "env:dev",
  "role:database", "role:web", "role:cache", "role:build",
  "region:seoul", "region:tokyo", "region:us-east",
];

export function TagEditor({ tags, onChange, placeholder = "태그 추가...", maxTags = 10 }: TagEditorProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = input.trim()
    ? SUGGESTIONS.filter(s => s.includes(input.toLowerCase()) && !tags.includes(s))
    : [];

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || tags.includes(tag) || tags.length >= maxTags) return;
    onChange([...tags, tag]);
    setInput("");
    setShowSuggestions(false);
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center",
          minHeight: "40px", padding: "6px 10px",
          background: "var(--sm-input-bg)",
          border: "1px solid var(--glass-border)", borderRadius: "10px",
          cursor: "text",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map(tag => (
          <span key={tag} style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            background: tagColor(tag).bg, border: `1px solid ${tagColor(tag).border}`,
            color: tagColor(tag).text,
            borderRadius: "5px", padding: "2px 8px", fontSize: "11px", fontWeight: 600,
          }}>
            {tag}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 0 2px", color: "inherit", opacity: 0.6, display: "flex", lineHeight: 1 }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {tags.length < maxTags && (
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={tags.length === 0 ? placeholder : ""}
            style={{
              flex: 1, minWidth: "80px", background: "none", border: "none", outline: "none",
              fontSize: "12px", color: "var(--text-main)",
            }}
          />
        )}
      </div>

      {/* Suggestions — rendered INLINE (in normal flow), not position:absolute.
          The editor lives inside a scrollable modal body (overflowY:auto), which
          clips any absolutely-positioned child; an inline box can't be clipped
          and simply pushes the rows below it down. */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div style={{
          marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px",
          padding: "8px", background: "var(--bg-surface)",
          border: "1px solid var(--border)", borderRadius: "8px",
        }}>
          {filteredSuggestions.slice(0, 8).map(s => (
            <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
              style={{
                background: tagColor(s).bg, border: `1px solid ${tagColor(s).border}`,
                color: tagColor(s).text, borderRadius: "5px", padding: "3px 9px",
                fontSize: "11px", fontWeight: 600, cursor: "pointer",
              }}
            >{s}</button>
          ))}
        </div>
      )}

      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "5px" }}>
        Enter · , · Space로 추가 &nbsp;·&nbsp; Backspace로 삭제 &nbsp;·&nbsp; env:, role:, region: 접두사 권장
      </div>
    </div>
  );
}

// Tag color by prefix
function tagColor(tag: string): { bg: string; border: string; text: string } {
  if (tag.startsWith("env:prod")) return { bg: "rgba(244,63,94,0.1)",  border: "rgba(244,63,94,0.3)",  text: "var(--accent-red)" };
  if (tag.startsWith("env:"))     return { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "var(--accent-orange)" };
  if (tag.startsWith("role:"))    return { bg: "rgba(110,113,255,0.1)",border: "rgba(110,113,255,0.3)",text: "var(--accent-blue)" };
  if (tag.startsWith("region:"))  return { bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.3)",  text: "var(--accent-green)" };
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: "var(--text-secondary)" };
}

// Read-only tag pill for display
export function TagPill({ tag }: { tag: string }) {
  const { bg, border, text } = tagColor(tag);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: bg, border: `1px solid ${border}`, color: text,
      borderRadius: "4px", padding: "1px 7px", fontSize: "10px", fontWeight: 600,
    }}>
      {tag}
    </span>
  );
}
