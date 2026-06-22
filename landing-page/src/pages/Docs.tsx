import { Lang } from "../types";

const docsContent = {
  en: {
    title: "DOCUMENTATION",
    desc: "Everything you need to know about HyperDesk.",
    sections: [
      {
        id: "intro",
        title: "Introduction",
        content: "HyperDesk is a Multi-View VDI & VM Monitoring Tool based on Tauri and Rust. It embeds Hyper-V virtual machines and remote desktop (RDP, Horizon) sessions into a single interface."
      },
      {
        id: "install",
        title: "Prerequisites",
        content: "• Rust (1.80+)\n• Node.js (LTS recommended)\n• WebView2 Runtime (Built-in on Windows 10/11)\n• Administrator Privileges (Required for external process window control)"
      },
      {
        id: "architecture",
        title: "Architecture & Window Swallowing",
        content: "HyperDesk utilizes the Win32 API (`SetParent`, `SetWindowPos`, `EnumWindows`) to render external processes. By avoiding `AttachThreadInput` and configuring independent message queues, it achieves a Deadlock-Free design. Even if an external process triggers an authentication modal, the main UI will not freeze."
      }
    ]
  },
  ko: {
    title: "기술 문서",
    desc: "HyperDesk의 구조와 설치 방법에 대해 알아봅니다.",
    sections: [
      {
        id: "intro",
        title: "소개",
        content: "HyperDesk는 Hyper-V 가상 머신과 원격 데스크톱(RDP, Horizon) 세션을 단일 인터페이스에서 통합 모니터링하는 데스크톱 애플리케이션입니다."
      },
      {
        id: "install",
        title: "설치 조건 (Prerequisites)",
        content: "• Rust (1.80 이상)\n• Node.js (LTS 권장)\n• WebView2 런타임 (Windows 10/11 기본 탑재)\n• 관리자 권한 (외부 윈도우 프로세스를 제어하기 위해 앱 실행 시 요구됨)"
      },
      {
        id: "architecture",
        title: "아키텍처 및 Window Swallowing",
        content: "Win32 API(`SetParent`, `SetWindowPos`)를 활용하여 구현되었습니다. `AttachThreadInput`를 배제하고 독립적인 메시지 큐를 구성하여 Deadlock-Free 설계를 달성했습니다. 외부 프로세스에서 모달 창이 발생해도 메인 UI의 프리징 현상이 발생하지 않습니다."
      }
    ]
  }
};

export default function Docs({ lang }: { lang: Lang }) {
  const t = docsContent[lang];

  return (
    <div className="min-h-screen bg-[#FFFF99] bg-[linear-gradient(black_1px,transparent_1px),linear-gradient(90deg,black_1px,transparent_1px)] bg-[size:40px_40px] pt-32 pb-20 px-6 font-mono text-black">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-8 relative z-10">
        
        {/* Sidebar */}
        <aside className="w-full md:w-72 flex-shrink-0">
          <div className="sticky top-32 border-4 border-black bg-[#C0C0C0] p-1 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <div className="border-b-4 border-black bg-[#000080] p-1 mb-2">
              <h3 className="text-sm font-black text-white uppercase tracking-widest px-2">INDEX.INI</h3>
            </div>
            <div className="bg-white border-2 border-black p-4">
              <ul className="space-y-4">
                {t.sections.map((sec) => (
                  <li key={sec.id}>
                    <a href={`#${sec.id}`} className="block text-black font-black hover:bg-[#FF00FF] hover:text-white p-2 border-2 border-dashed border-transparent hover:border-black transition-colors uppercase shadow-[2px_2px_0_0_transparent] hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                      ▶ {sec.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1">
          <div className="border-4 border-black bg-[#C0C0C0] shadow-[12px_12px_0_0_rgba(0,0,0,1)] mb-8 flex flex-col">
            <div className="border-b-4 border-black bg-[#000080] p-2 flex justify-between items-center">
              <h1 className="font-black text-white tracking-widest uppercase text-sm">DOCS_VIEWER.EXE</h1>
              <div className="w-6 h-6 border-2 border-black bg-[#C0C0C0] shadow-[inset_-2px_-2px_0px_0px_rgba(0,0,0,0.5),inset_2px_2px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center font-bold text-black cursor-pointer active:shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.5)]">
                X
              </div>
            </div>
            <div className="p-8 bg-white border-4 border-white m-1 border-t-black border-l-black border-b-[#808080] border-r-[#808080] shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,1)] flex-1">
              <h1 className="text-4xl md:text-5xl font-black text-black mb-6 uppercase leading-tight bg-[#00FFFF] border-4 border-black inline-block px-4 py-2 shadow-[6px_6px_0_0_rgba(0,0,0,1)] -rotate-1">{t.title}</h1>
              <br />
              <p className="text-xl text-black font-bold mb-16 bg-[#FFFF00] inline-block p-3 border-4 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">{t.desc}</p>
              
              <div className="space-y-16">
                {t.sections.map((sec) => (
                  <section key={sec.id} id={sec.id} className="scroll-mt-40">
                    <h2 className="text-2xl font-black text-white mb-6 bg-[#FF00FF] p-3 border-4 border-black inline-block uppercase shadow-[6px_6px_0_0_rgba(0,0,0,1)]">{sec.title}</h2>
                    <div className="prose prose-lg max-w-none font-bold">
                      {sec.content.split('\n').map((line, i) => (
                        <p key={i} className="text-black leading-relaxed mb-4 p-4 border-4 border-black bg-white shadow-[6px_6px_0_0_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all">
                          {line}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
