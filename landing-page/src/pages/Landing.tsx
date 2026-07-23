import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { Lang } from "../types";
import { useState, useMemo } from "react";
// @ts-ignore
import readmeText from "../../../README.md?raw";

const ICON_TXT = "https://win98icons.alexmeub.com/icons/png/file_lines-0.png";
const ICON_INTERNET = "https://win98icons.alexmeub.com/icons/png/msie1-2.png";
const ICON_WARNING = "https://win98icons.alexmeub.com/icons/png/msg_warning-0.png";
const ICON_ERROR = "https://win98icons.alexmeub.com/icons/png/msg_error-0.png";

const translations = {
  en: {
    heroTitle: "HYPERDESK",
    heroSub: "COMMAND YOUR VIRTUAL WORLD",
    heroDesc: "The ultimate Multi-View VDI & VM Monitoring Hub. Experience native performance and seamless Window Swallowing technology.",
    downloadBtn: "GET IT ON MICROSOFT STORE",
    githubBtn: "SOURCE CODE",
    marquee: "⚡ WELCOME TO HYPERDESK ⚡ THE FUTURE OF VDI IS RETRO ⚡ NO DEADLOCKS ⚡ NO LAG ⚡ JUST RAW SPEED ⚡",
    f1Title: "SwallowGrid™",
    f1Desc: "Seamlessly embed RDP and VMware Horizon windows directly into the UI.",
    f2Title: "2x2 Multi-View",
    f2Desc: "Monitor up to 4 sessions simultaneously. Zero-distraction Theater Mode.",
    f3Title: "Rust Backend",
    f3Desc: "Memory footprint so low you'll think your RAM is broken. Pure native speed.",
    sysAlert: "System Alert",
    errs: [
      "Task Failed Successfully.",
      "RAM Usage is dangerously LOW.",
      "Warning: Deadlocks are obsolete.",
      "Process 'Lag.exe' not found.",
      "Too much speed detected."
    ],
    blinks: [
      "WOW!!",
      "🚧 UNDER CONSTRUCTION 🚧",
      "100% NATIVE SPEED",
      "NO ELECTRON INSIDE",
      "DOPAMINE OVERLOAD",
      "VIRUS FREE 100%",
      "HOT DEALS!!!",
      "CLICK HERE!!!"
    ],
    guestTitle: "Sign My Guestbook!",
    guestPlaceholder: "You rock!",
    guestSubmit: "Submit",
    ieTitle: "Microsoft Internet Explorer",
    ieAddress: "Address:",
    ieWelcome: "Welcome to HyperDesk Official WebSite!",
    ieMarquee: "🔥 The Best VDI Client on the World Wide Web 🔥",
    ieDesc: "Due to GitHub's strict security policies, we cannot display their site in this iframe.",
    ieBtn: "CLICK HERE TO VISIT GITHUB",
    ieOpt: "Optimized for Netscape Navigator 4.0",
    ieRes: "Best viewed at 800x600 resolution"
  },
  ko: {
    heroTitle: "하이퍼데스크",
    heroSub: "모든 인프라를 한 곳에서 완벽하게",
    heroDesc: "차원이 다른 VDI 및 VM 통합 관제 허브. Tauri와 Rust로 완성된 압도적인 성능과 독자적인 윈도우 임베딩 기술을 경험하세요.",
    downloadBtn: "Microsoft Store에서 받기",
    githubBtn: "소스코드",
    marquee: "⚡ HYPERDESK에 오신 것을 환영합니다 ⚡ VDI의 미래는 레트로에 있습니다 ⚡ 데드락 제로 ⚡ 렉 제로 ⚡ 압도적 속도 ⚡",
    f1Title: "SwallowGrid™",
    f1Desc: "RDP, VMware Horizon 창을 앱 내부에 완벽히 이식하여 네이티브 앱처럼 동작합니다.",
    f2Title: "2x2 멀티 뷰",
    f2Desc: "최대 4개의 세션을 동시 모니터링. 완벽한 몰입을 위한 시어터 모드를 지원합니다.",
    f3Title: "Rust 백엔드",
    f3Desc: "램을 아예 쓰지 않는 것처럼 느껴지는 초경량 메모리 점유율. 압도적인 속도를 자랑합니다.",
    sysAlert: "시스템 경고",
    errs: [
      "작업이 성공적으로 실패했습니다.",
      "RAM 사용량이 위험할 정도로 낮습니다.",
      "경고: 데드락은 이제 구시대의 유물입니다.",
      "'Lag.exe' 프로세스를 찾을 수 없습니다.",
      "속도가 너무 빠릅니다. 주의하십시오."
    ],
    blinks: [
      "대박!!",
      "🚧 공사중 🚧",
      "100% 네이티브 속도",
      "일렉트론 아님",
      "도파민 과부하",
      "100% 바이러스 없음",
      "초특가 할인!!!",
      "지금 클릭하세요!!!"
    ],
    guestTitle: "방명록을 남겨주세요!",
    guestPlaceholder: "최고예요!",
    guestSubmit: "작성하기",
    ieTitle: "마이크로소프트 인터넷 익스플로러",
    ieAddress: "주소:",
    ieWelcome: "HyperDesk 공식 웹사이트에 오신 것을 환영합니다!",
    ieMarquee: "🔥 월드 와이드 웹 최고의 VDI 클라이언트 🔥",
    ieDesc: "GitHub의 강력한 보안 정책으로 인해 이곳에 사이트를 직접 표시할 수 없습니다.",
    ieBtn: "GITHUB 방문하기 (클릭)",
    ieOpt: "넷스케이프 내비게이터 4.0에 최적화됨",
    ieRes: "800x600 해상도 권장"
  }
};

// Store-only distribution now (no more .exe releases) — this is a fixed link,
// not a hook, because there's nothing to fetch: the Store always serves the
// current version itself. A future direct-download (bypass the Store app)
// automation is still just an idea, not built — see conversation 2026-07-23.
const MS_STORE_URL = "https://apps.microsoft.com/detail/9NPVXL622ZQQ";

function RetroWindow({ title, children, color = "bg-[#000080]", className = "", initialZ = 10, onClose, resizable = false }: any) {
  const [zIndex, setZIndex] = useState(initialZ);
  const dragControls = useDragControls();
  return (
    <motion.div
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      onPointerDown={() => setZIndex(Date.now() % 10000 + 100)}
      className={`absolute border-2 border-white border-b-black border-r-black bg-[#C0C0C0] flex flex-col shadow-[2px_2px_0_0_#000] ${className}`}
      style={{
        zIndex,
        touchAction: "none",
        resize: resizable ? 'both' : 'none',
        overflow: resizable ? 'hidden' : 'visible'
      }}
    >
      <div
        className={`title-bar ${color} p-1 flex justify-between items-center cursor-grab active:cursor-grabbing`}
        onPointerDown={(e) => dragControls.start(e)}
      >
        <h3 className="font-bold text-white tracking-widest text-sm px-2 truncate">{title}</h3>
        {onClose && (
          <div 
            onClick={onClose}
            className="w-5 h-5 flex-shrink-0 border-2 border-white border-b-black border-r-black bg-[#C0C0C0] flex items-center justify-center font-bold text-black hover:bg-gray-300 active:border-black active:border-b-white active:border-r-white cursor-pointer"
          >
            X
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-[#C0C0C0] border-t-2 border-l-2 border-gray-500 border-b-white border-r-white relative">
        {children}
      </div>
    </motion.div>
  );
}

const DesktopIcon = ({ iconSrc, label, x, y, onClick }: any) => (
  <motion.div 
    drag dragMomentum={false} 
    className="absolute flex flex-col items-center justify-center w-24 cursor-pointer group"
    style={{ left: x, top: y, touchAction: "none", zIndex: 5 }}
    onDoubleClick={onClick}
    onClick={(e) => { if(e.detail === 2) onClick(); }} 
  >
    <div className="mb-1 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] transition-transform group-active:brightness-50 group-active:translate-y-[1px]">
      <img src={iconSrc} alt={label} className="w-10 h-10 pixelated pointer-events-none" style={{ imageRendering: 'pixelated' }} />
    </div>
    <span className="bg-transparent text-white text-xs px-1 text-center font-bold border border-transparent group-hover:bg-[#000080] group-hover:text-white group-hover:border-white border-dotted drop-shadow-[1px_1px_1px_rgba(0,0,0,1)]">{label}</span>
  </motion.div>
);

const MicroBanner = ({ text, bg, border1, border2 }: any) => (
  <div className={`inline-block ${bg} text-white text-[9px] px-2 py-[2px] font-bold border-2 ${border1} ${border2} shadow-sm mx-1`}>
    {text}
  </div>
);

export default function Landing({ lang }: { lang: Lang }) {
  const t = translations[lang];

  const [isReadmeOpen, setIsReadmeOpen] = useState(false);
  const [isInternetOpen, setIsInternetOpen] = useState(false);

  // Random layout generator
  const layout = useMemo(() => {
    const randomRange = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randomPos = (minX=5, maxX=70, minY=10, maxY=80) => ({
      top: `${randomRange(minY, maxY)}vh`,
      left: `${randomRange(minX, maxX)}vw`,
      transform: `rotate(${randomRange(-8, 8)}deg)`
    });

    return {
      f1: randomPos(5, 30, 60, 85),
      f2: randomPos(60, 85, 15, 40),
      f3: randomPos(50, 75, 60, 85),
      guestbook: randomPos(35, 65, 70, 85),
      errors: [
        { ...randomPos(5, 80, 5, 80), icon: ICON_WARNING },
        { ...randomPos(5, 80, 5, 80), icon: ICON_ERROR },
        { ...randomPos(5, 80, 5, 80), icon: ICON_WARNING },
        { ...randomPos(5, 80, 5, 80), icon: ICON_ERROR },
        { ...randomPos(5, 80, 5, 80), icon: ICON_WARNING },
      ],
      blinks: [
        { color: "text-[#FF00FF]", ...randomPos() },
        { color: "text-yellow-300", ...randomPos() },
        { color: "text-[#00FF00]", ...randomPos() },
        { color: "text-cyan-400", ...randomPos() },
        { color: "text-red-500", ...randomPos() },
        { color: "text-purple-400", ...randomPos() },
        { color: "text-orange-400", ...randomPos() },
        { color: "text-blue-300", ...randomPos() }
      ],
      banners: [
        { text: "TAURI", bg: "bg-orange-600", b1: "border-white", b2: "border-r-black border-b-black", ...randomPos(5, 85, 5, 85) },
        { text: "RUST", bg: "bg-black", b1: "border-gray-500", b2: "border-r-white border-b-white", ...randomPos(5, 85, 5, 85) },
        { text: "REACT", bg: "bg-blue-600", b1: "border-cyan-300", b2: "border-r-blue-900 border-b-blue-900", ...randomPos(5, 85, 5, 85) },
        { text: "WIN32 API", bg: "bg-gray-400", b1: "border-white", b2: "border-r-black border-b-black text-black", ...randomPos(5, 85, 5, 85) },
        { text: "BEST VIEWED IN IE4", bg: "bg-blue-800", b1: "border-gray-400", b2: "border-r-black border-b-black", ...randomPos(5, 85, 5, 85) },
        { text: "TYPESCRIPT", bg: "bg-blue-500", b1: "border-white", b2: "border-r-blue-800 border-b-blue-800", ...randomPos(5, 85, 5, 85) },
      ]
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-[#008080] relative overflow-hidden font-mono cursor-default">
      
      {/* Background Pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==')] z-0"></div>

      {/* Marquee Banner */}
      <div className="w-full bg-[#000080] border-b-2 border-white text-white font-black py-1 overflow-hidden flex whitespace-nowrap absolute top-0 z-[150]">
        <motion.div
          animate={{ x: [0, -1000] }}
          transition={{ repeat: Infinity, duration: 15, ease: "linear" }}
          className="text-sm tracking-widest uppercase"
        >
          {t.marquee} {t.marquee} {t.marquee}
        </motion.div>
      </div>

      {/* Interactive Desktop Icons */}
      <DesktopIcon iconSrc={ICON_TXT} label="README.txt" x="2%" y="10%" onClick={() => setIsReadmeOpen(true)} />
      <DesktopIcon iconSrc={ICON_INTERNET} label="Internet" x="2%" y="25%" onClick={() => setIsInternetOpen(true)} />

      {/* Random Y2K Blinking Texts */}
      {layout.blinks.map((b, i) => (
        <div 
          key={i} 
          className={`absolute ${b.color} font-black text-xl md:text-3xl tracking-widest drop-shadow-[2px_2px_0_#000] animate-[pulse_0.7s_steps(2,start)_infinite] z-[5] pointer-events-none`}
          style={{ top: b.top, left: b.left, transform: b.transform }}
        >
          {t.blinks[i]}
        </div>
      ))}

      {/* Fake Error Messages (Lowest Z-Index) */}
      {layout.errors.map((err, i) => (
        <div key={`err-${i}`} className="pointer-events-auto absolute" style={{ top: err.top, left: err.left, transform: err.transform, zIndex: 2 }}>
          <div className="w-[260px] border-2 border-white border-b-black border-r-black bg-[#C0C0C0] flex flex-col shadow-md">
            <div className="bg-[#000080] p-1 flex justify-between items-center cursor-default">
              <h3 className="font-bold text-white tracking-widest text-xs px-1">{t.sysAlert}</h3>
              <div className="w-4 h-4 flex-shrink-0 border-2 border-white border-b-black border-r-black bg-[#C0C0C0] flex items-center justify-center font-bold text-black text-[10px]">X</div>
            </div>
            <div className="p-3 flex gap-3 items-center bg-[#C0C0C0]">
              <img src={err.icon} className="w-8 h-8 pointer-events-none" />
              <div className="text-xs font-bold leading-tight">{t.errs[i]}</div>
            </div>
            <div className="flex justify-center pb-3 bg-[#C0C0C0]">
              <button className="border-2 border-white border-b-black border-r-black bg-[#C0C0C0] px-6 py-1 text-xs font-bold shadow-[inset_1px_1px_#fff]">OK</button>
            </div>
          </div>
        </div>
      ))}

      {/* Floating Banners Scattered */}
      {layout.banners.map((ban, i) => (
        <motion.div 
          key={`ban-${i}`}
          drag dragMomentum={false}
          className="absolute z-[10] cursor-grab active:cursor-grabbing"
          style={{ top: ban.top, left: ban.left, transform: ban.transform }}
        >
          <MicroBanner text={ban.text} bg={ban.bg} border1={ban.b1} border2={ban.b2} />
        </motion.div>
      ))}

      {/* App Windows */}
      <AnimatePresence>
        {isReadmeOpen && (
          <RetroWindow title="Notepad - README.txt" className="w-[85%] md:w-[600px] h-[60vh] top-[15vh] left-[15vw] z-[90]" initialZ={90} onClose={() => setIsReadmeOpen(false)} resizable={true}>
            <div className="h-full bg-white p-2">
              <textarea 
                className="w-full h-full resize-none outline-none font-mono text-sm"
                readOnly
                value={readmeText}
              />
            </div>
          </RetroWindow>
        )}

        {isInternetOpen && (
          <RetroWindow title={t.ieTitle} className="w-[90%] md:w-[800px] h-[70vh] top-[10vh] left-[5vw] md:left-[20vw] z-[95]" initialZ={95} onClose={() => setIsInternetOpen(false)} resizable={true}>
            <div className="flex flex-col h-full bg-[#C0C0C0]">
              <div className="border-b-2 border-gray-400 p-2 flex gap-2 items-center bg-[#C0C0C0]">
                <span className="font-bold text-sm">{t.ieAddress}</span>
                <input type="text" value="https://github.com/qetqet910/HyperDesk" readOnly className="border-2 border-gray-500 border-r-white border-b-white bg-white w-full px-2 py-1 text-sm outline-none" />
              </div>
              <div className="flex-1 bg-white border-t-2 border-l-2 border-gray-500 border-b-white border-r-white m-1 relative overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto border-4 border-double border-blue-800 p-8 text-center bg-[#ffffcc]">
                  <h1 className="text-4xl font-black text-red-600 mb-4 underline">{t.ieWelcome}</h1>
                  <marquee className="text-xl font-bold text-blue-800 mb-8" scrollamount="10">{t.ieMarquee}</marquee>
                  
                  <img src="https://win98icons.alexmeub.com/icons/png/world-0.png" className="mx-auto mb-6 w-16 h-16" alt="Globe" style={{ imageRendering: 'pixelated' }} />
                  
                  <p className="text-lg font-bold mb-6">{t.ieDesc}</p>
                  
                  <a href="https://github.com/qetqet910/HyperDesk" target="_blank" rel="noreferrer" className="inline-block bg-gray-300 text-black font-black border-4 border-gray-500 border-t-white border-l-white px-8 py-3 hover:bg-gray-200 active:border-b-white active:border-r-white active:border-t-gray-500 active:border-l-gray-500">
                    {t.ieBtn}
                  </a>
                  
                  <div className="mt-12 text-sm text-gray-600">
                    <p>{t.ieOpt}</p>
                    <p>{t.ieRes}</p>
                  </div>
                </div>
              </div>
            </div>
          </RetroWindow>
        )}
      </AnimatePresence>

      {/* Main Content & Features */}
      <div className="relative z-[20] w-full h-full p-4 pt-12 pointer-events-none">
        
        {/* Main Hero Window (Fixed absolute positioning without transform translate to fix drag jumping) */}
        <div className="pointer-events-auto">
          <RetroWindow 
            title="SETUP.EXE" 
            className="w-[90%] md:w-[600px] h-auto top-[15vh] left-[5vw] md:left-[25vw] z-[40]"
            initialZ={40}
          >
            <div className="bg-white p-6 border-2 border-gray-500 border-b-white border-r-white m-1 shadow-[inset_1px_1px_#000]">
              <h1 className="text-4xl md:text-5xl font-black text-black mb-2 uppercase leading-[1.1] tracking-tighter" style={{ textShadow: "2px 2px 0px #C0C0C0" }}>
                {t.heroTitle}
              </h1>
              <h2 className="text-sm font-bold bg-[#000080] text-white px-2 py-1 inline-block mb-6">
                {t.heroSub}
              </h2>
              <p className="text-sm md:text-base font-bold border-l-4 border-[#000080] pl-4 mb-8 bg-gray-100 p-3 shadow-[1px_1px_0_0_rgba(0,0,0,0.2)]">
                {t.heroDesc}
              </p>
              <div className="flex flex-wrap gap-4 pt-4 border-t-2 border-gray-300">
                <a href={MS_STORE_URL} target="_blank" rel="noreferrer" className="flex-1 text-center border-2 border-white border-b-black border-r-black bg-[#C0C0C0] text-black font-black py-2 px-4 active:border-black active:border-b-white active:border-r-white active:translate-y-[1px] transition-all text-sm shadow-[1px_1px_0_0_rgba(0,0,0,1)] hover:bg-[#dfdfdf]">
                  {t.downloadBtn}
                </a>
                <a href="https://github.com/qetqet910/HyperDesk" target="_blank" rel="noreferrer" className="flex-1 text-center border-2 border-white border-b-black border-r-black bg-[#C0C0C0] text-black font-black py-2 px-4 active:border-black active:border-b-white active:border-r-white active:translate-y-[1px] transition-all text-sm shadow-[1px_1px_0_0_rgba(0,0,0,1)] hover:bg-[#dfdfdf]">
                  {t.githubBtn}
                </a>
              </div>
            </div>
          </RetroWindow>
        </div>

        {/* Randomly Placed Feature 1 */}
        <div className="pointer-events-auto absolute" style={{ top: layout.f1.top, left: layout.f1.left, transform: layout.f1.transform }}>
          <RetroWindow title="01_SWALLOW.DLL" color="bg-[#800080]" className="w-[300px]" initialZ={50}>
            <div className="p-3">
              <div className="flex items-center gap-3 mb-2">
                <img src="https://win98icons.alexmeub.com/icons/png/gears-0.png" className="w-8 h-8 pixelated pointer-events-none" />
                <h3 className="font-black text-lg text-black uppercase">{t.f1Title}</h3>
              </div>
              <p className="font-bold text-sm text-gray-800 bg-white p-2 border-2 border-gray-400 border-dashed">{t.f1Desc}</p>
            </div>
          </RetroWindow>
        </div>

        {/* Randomly Placed Feature 2 */}
        <div className="pointer-events-auto absolute" style={{ top: layout.f2.top, left: layout.f2.left, transform: layout.f2.transform }}>
          <RetroWindow title="02_MULTIVIEW.SYS" color="bg-[#800000]" className="w-[300px]" initialZ={45}>
            <div className="p-3">
              <div className="flex items-center gap-3 mb-2">
                <img src="https://win98icons.alexmeub.com/icons/png/display_properties-2.png" className="w-8 h-8 pixelated pointer-events-none" />
                <h3 className="font-black text-lg text-black uppercase">{t.f2Title}</h3>
              </div>
              <p className="font-bold text-sm text-gray-800 bg-white p-2 border-2 border-gray-400 border-dashed">{t.f2Desc}</p>
            </div>
          </RetroWindow>
        </div>

        {/* Randomly Placed Feature 3 */}
        <div className="pointer-events-auto absolute" style={{ top: layout.f3.top, left: layout.f3.left, transform: layout.f3.transform }}>
          <RetroWindow title="03_RUST_CORE.BIN" color="bg-[#008000]" className="w-[300px]" initialZ={55}>
            <div className="p-3 bg-yellow-100">
              <div className="flex items-center gap-3 mb-2">
                <img src="https://win98icons.alexmeub.com/icons/png/memory-0.png" className="w-8 h-8 pixelated pointer-events-none" />
                <h3 className="font-black text-lg text-red-600 uppercase">{t.f3Title}</h3>
              </div>
              <p className="font-bold text-sm text-black bg-white p-2 border-2 border-red-500 border-dotted">{t.f3Desc}</p>
            </div>
          </RetroWindow>
        </div>

        {/* Randomly Placed Guestbook */}
        <div className="pointer-events-auto absolute" style={{ top: layout.guestbook.top, left: layout.guestbook.left, transform: layout.guestbook.transform }}>
          <RetroWindow title="GUESTBOOK.EXE" color="bg-[#000080]" className="w-[250px]" initialZ={70}>
            <div className="p-2 bg-[#ffccff] text-center border-4 border-pink-500 border-dotted">
              <h4 className="font-serif italic text-xl text-purple-700 font-bold mb-2">{t.guestTitle}</h4>
              <textarea className="w-full h-16 resize-none border-2 border-gray-400 p-1 text-xs" placeholder={t.guestPlaceholder}></textarea>
              <button className="bg-purple-600 text-white font-bold text-xs px-4 py-1 mt-1 border-2 border-black hover:bg-purple-800">{t.guestSubmit}</button>
            </div>
          </RetroWindow>
        </div>

      </div>
    </div>
  );
}
