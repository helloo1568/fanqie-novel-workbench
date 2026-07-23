import type { ReactNode } from "react";
import { BookOpen, LoaderCircle } from "lucide-react";

export interface AsyncStateProps {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyText?: string;
  loadingText?: string;
  children: ReactNode;
  onRetry?: () => void;
}

export function AsyncState({ loading, error, empty, emptyText = "暂无内容", loadingText = "正在加载…", children, onRetry }: AsyncStateProps) {
  if (loading) return <div className="async-state" role="status"><LoaderCircle className="async-state-spinner" size={24} aria-hidden="true"/><span>{loadingText}</span></div>;
  if (error) return <div className="async-state" role="alert"><span>{error instanceof Error ? error.message : String(error)}</span>{onRetry && <button className="btn" type="button" onClick={onRetry}>重试</button>}</div>;
  if (empty) return <div className="async-state"><BookOpen size={24} aria-hidden="true"/><span>{emptyText}</span></div>;
  return <>{children}</>;
}

export default AsyncState;
