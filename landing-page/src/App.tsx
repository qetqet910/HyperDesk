import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Landing from './pages/Landing';
import Docs from './pages/Docs';
import Navbar from './components/Navbar';
import { Lang } from './types';

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path);
    window.scrollTo(0, 0);
  };

  return (
    <div className="relative min-h-screen font-mono text-black selection:bg-[#FF00FF] selection:text-white">
      <Navbar lang={lang} setLang={setLang} navigate={navigate} currentPath={currentPath} />
      
      <main className="overflow-hidden bg-[#FFFF99]">
        <AnimatePresence mode="wait">
          {currentPath === '/docs' ? (
            <motion.div key="docs" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.2 }}>
              <Docs lang={lang} />
            </motion.div>
          ) : (
            <motion.div key="landing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.2 }}>
              <Landing lang={lang} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
