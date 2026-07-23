import { ApiError, errorMessage } from "./lib/errors";

function responseErrorMessage(text: string, statusText: string, status: number): string {
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const message = body.error ?? body.message;
      if (typeof message === "string" && message.trim()) return message;
    } catch {
      if (text.trim()) return text.trim();
    }
  }
  return statusText || `请求失败：${status}`;
}

export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, path, errorMessage(error), { cause: error });
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, path, responseErrorMessage(text, response.statusText, response.status));
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ApiError(response.status, path, "服务器返回了无效的 JSON", { cause: error });
  }
}

export const api = requestJson;

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const remove = (path: string) => api<void>(path, { method: "DELETE" });
