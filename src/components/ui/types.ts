import type { Workspace } from "../../features/workbench/useWorkbench";

/** 辅助页面通用 props：workspace 数据 + 刷新 + toast。 */
export interface PageProps {
  data: Workspace;
  refresh: () => void;
  toast: (text: string) => void;
}

/** 任意键值对象，用于后端返回的字典类型。 */
export type Dict = Record<string, unknown>;
