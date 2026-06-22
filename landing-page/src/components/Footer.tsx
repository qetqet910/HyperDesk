import { Lang } from "../types";

const footerTexts = {
  en: "Built with Rust, Tauri, and React. Windows 10/11 Only.",
  ko: "Rust, Tauri, React 기반으로 제작되었습니다. Windows 전용."
};

export default function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="border-t border-white/5 bg-black py-16 text-center text-neutral-500 relative z-10">
      <div className="flex justify-center items-center gap-3 mb-6">
        <img src="/@fs/c:/Dev/HyperDesk/src/assets/logo.svg" className="w-6 h-6 opacity-50 grayscale" alt="Logo" />
        <span className="font-bold text-lg text-neutral-400 tracking-tight">HyperDesk</span>
      </div>
      <p className="text-sm max-w-md mx-auto leading-relaxed">{footerTexts[lang]}</p>
      <p className="text-sm mt-4 opacity-50">© 2026 HyperDesk Inc. All rights reserved.</p>
    </footer>
  );
}
