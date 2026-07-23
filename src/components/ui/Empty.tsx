import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";

/** 空状态：图标 + 文案 + 可选操作。 */
export interface EmptyProps {
  text: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function Empty({ text, action, icon }: EmptyProps) {
  return (
    <div className="empty">
      {icon ?? <BookOpen size={28} strokeWidth={1.3} />}
      <div>{text}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export default Empty;
