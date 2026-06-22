import { Lang } from "../types";
import { useState, useEffect } from "react";

const navTexts = {
  en: { start: "Start" },
  ko: { start: "시작" }
};

export default function Navbar({ lang, setLang, navigate, currentPath }: any) {
  const t = navTexts[lang as Lang];
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[200] h-10 flex items-center justify-between px-1 bg-[#C0C0C0] border-t-2 border-white shadow-[0_-1px_0_0_#dfdfdf,inset_0_1px_0_0_#fff]">
      <div className="flex items-center h-full py-[3px] gap-1">
        {/* Start Button */}
        <button 
          onClick={() => navigate('/')}
          className="flex items-center gap-1 px-2 h-full font-bold text-black bg-[#C0C0C0] border-2 border-white border-b-black border-r-black active:border-black active:border-b-white active:border-r-white"
          style={{ boxShadow: 'inset 1px 1px #dfdfdf, inset -1px -1px #808080' }}
        >
          <img src="https://win98icons.alexmeub.com/icons/png/windows-0.png" className="w-5 h-5 filter drop-shadow-sm" alt="Start" />
          <span className="text-sm tracking-wide">{t.start}</span>
        </button>
        
        {/* Vertical Divider */}
        <div className="w-[2px] h-full bg-gray-500 mx-1 border-r border-white"></div>
        
        {/* Taskbar Items */}
        <button 
          onClick={() => navigate(currentPath === '/docs' ? '/' : '/docs')}
          className={`flex items-center gap-2 px-2 min-w-[120px] max-w-[160px] h-full font-bold text-black text-xs truncate border-2 ${currentPath === '/docs' ? 'border-gray-500 border-b-white border-r-white bg-gray-300' : 'border-white border-b-black border-r-black bg-[#C0C0C0] hover:bg-gray-200'} shadow-[inset_1px_1px_#dfdfdf,inset_-1px_-1px_#808080]`}
        >
          <img src={currentPath === '/docs' ? "https://win98icons.alexmeub.com/icons/png/help_book_big-0.png" : "https://win98icons.alexmeub.com/icons/png/desktop-0.png"} className="w-4 h-4" />
          <span className="truncate">{currentPath === '/docs' ? 'Documentation' : 'Desktop'}</span>
        </button>

        <a 
          href="https://github.com/qetqet910/HyperDesk"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center gap-2 px-2 min-w-[120px] max-w-[160px] h-full font-bold text-black text-xs truncate border-2 border-white border-b-black border-r-black bg-[#C0C0C0] hover:bg-gray-200 shadow-[inset_1px_1px_#dfdfdf,inset_-1px_-1px_#808080]"
        >
          <img src="https://win98icons.alexmeub.com/icons/png/world-0.png" className="w-4 h-4" />
          <span className="truncate">GitHub</span>
        </a>
      </div>
      
      {/* System Tray */}
      <div className="flex items-center h-full py-[3px]">
        <div className="flex items-center h-full px-2 gap-2 border-2 border-gray-500 border-b-white border-r-white shadow-[inset_1px_1px_0_0_#000]">
          <div 
            className="flex items-center gap-1 cursor-pointer hover:opacity-80" 
            onClick={() => setLang(lang === 'en' ? 'ko' : 'en')}
            title="Switch Language"
          >
            <img src="https://win98icons.alexmeub.com/icons/png/keyboard-0.png" className="w-4 h-4" />
            <span className="text-[10px] font-bold text-black uppercase">{lang}</span>
          </div>
          <span className="font-mono text-xs text-black cursor-default">{time}</span>
        </div>
      </div>
    </nav>
  );
}
