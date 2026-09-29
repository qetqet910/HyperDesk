import { List, LayoutGrid } from "lucide-react";
import { useT } from "@/lib/i18n";

interface ColumnToggleProps {
  value: 1 | 2;
  onChange: (v: 1 | 2) => void;
}

/** Sliding 2-way pill toggle (1-column list vs. 2-column grid) for the remote
    asset list. Shared between the Dashboard's remote-assets section and the
    Remote Assets page — same underlying list, same layout preference. */
export function ColumnToggle({ value, onChange }: ColumnToggleProps) {
  const t = useT();
  return (
    <div className="col-toggle" role="radiogroup" aria-label={t("cols.label")}>
      <div className={`col-toggle__thumb ${value === 2 ? "col-toggle__thumb--right" : ""}`} />
      <button
        type="button"
        className={`col-toggle__btn ${value === 1 ? "active" : ""}`}
        onClick={() => onChange(1)}
        title={t("cols.one")}
        aria-pressed={value === 1}
      >
        <List size={13} />
      </button>
      <button
        type="button"
        className={`col-toggle__btn ${value === 2 ? "active" : ""}`}
        onClick={() => onChange(2)}
        title={t("cols.two")}
        aria-pressed={value === 2}
      >
        <LayoutGrid size={13} />
      </button>
    </div>
  );
}
