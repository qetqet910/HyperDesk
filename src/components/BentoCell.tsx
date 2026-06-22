import { useRef } from "react";

interface BentoCellProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glitch?: boolean;
}

export function BentoCell({ children, className = "", style = {}, glitch = false }: BentoCellProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cellRef.current) return;
    const rect = cellRef.current.getBoundingClientRect();
    cellRef.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    cellRef.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };
  return (
    <div ref={cellRef} className={`bento-cell ${className} ${glitch ? "glitch-static" : ""}`} onMouseMove={handleMouseMove} style={style}>
      <div className="glow-border" />
      {children}
    </div>
  );
}
