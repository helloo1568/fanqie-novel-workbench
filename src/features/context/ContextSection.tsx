import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface ContextSectionProps {
  title: string;
  count: number;
  allTo: string;
  children: ReactNode;
}

export function ContextSection({ title, count, allTo, children }: ContextSectionProps) {
  const headingId = useId();
  return <section className="context-section" aria-labelledby={headingId}>
    <div className="context-section-head">
      <h3 id={headingId}>{title}<span>{count}</span></h3>
      <Link to={allTo}>查看全部</Link>
    </div>
    {count ? <ul className="context-items">{children}</ul> : <p className="context-empty">当前章节暂无相关内容</p>}
  </section>;
}

export default ContextSection;
