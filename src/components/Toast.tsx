import { useEffect } from "react";

export interface ToastProps {
  text: string;
  close?: () => void;
  duration?: number;
}

export function Toast({ text, close, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (!close || duration <= 0) return;
    const timer = window.setTimeout(close, duration);
    return () => window.clearTimeout(timer);
  }, [close, duration]);
  return <div className="toast" role="status" aria-live="polite">{text}</div>;
}

export default Toast;
