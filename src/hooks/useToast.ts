import { useState, useCallback, useRef } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "success") => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
    timersRef.current.set(id, timer);
  }, []);

  return { toasts, addToast, removeToast };
}
