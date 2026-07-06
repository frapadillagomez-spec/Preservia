import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "preservia_token";

export type ApiError = { status: number; detail: string };

async function request<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail =
      (data && (data.detail || data.message)) || `Error ${res.status}`;
    throw { status: res.status, detail } as ApiError;
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string, auth = true) => request<T>(path, { method: "GET", auth }),
  post: <T = any>(path: string, body?: any, auth = true) =>
    request<T>(path, { method: "POST", body, auth }),
  put: <T = any>(path: string, body?: any, auth = true) =>
    request<T>(path, { method: "PUT", body, auth }),
  del: <T = any>(path: string, auth = true) => request<T>(path, { method: "DELETE", auth }),
};
