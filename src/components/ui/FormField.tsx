import type { ReactNode, TextareaHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

/** 单字段：label + 控件 + 提示/错误。 */
export interface FormFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function FormField({ label, hint, error, children, className = "", style }: FormFieldProps) {
  return (
    <div className={`field ${className}`.trim()} style={style}>
      <label>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="badge red field-error">{error}</span>}
    </div>
  );
}

/** 两列字段容器（移动端自动堆叠）。 */
export function FormRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>;
}

/** 标准 input 封装，自动套用 .input 样式。 */
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ""}`.trim()} />;
}

/** 标准 textarea 封装，自动套用 .textarea 样式。 */
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className || ""}`.trim()} />;
}

/** 标准 select 封装，自动套用 .select 样式。 */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className || ""}`.trim()} />;
}

export default FormField;
