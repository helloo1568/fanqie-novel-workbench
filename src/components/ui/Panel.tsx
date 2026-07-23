import type { ReactNode } from "react";

/** 面板：标题 + 副标题/徽标 + 内容区。 */
export interface PanelProps {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

export function Panel({ title, meta, actions, children, className = "", style, bodyStyle }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()} style={style}>
      {(title || meta || actions) && (
        <div className="panel-head">
          {title && <h3>{title}</h3>}
          {meta}
          {actions && <div className="panel-head-actions">{actions}</div>}
        </div>
      )}
      <div className="panel-body" style={bodyStyle}>{children}</div>
    </section>
  );
}

export default Panel;
