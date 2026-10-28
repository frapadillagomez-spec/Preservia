import { storage } from "@/src/utils/storage";
import {
  cacheGet,
  cacheSet,
  enqueue,
  ensureLoaded,
  getQueue,
  hasLocalId,
  isCacheable,
  isQueueable,
  localRead,
  overlay,
  resolvePath,
  setApiOffline,
} from "@/src/offline/store";
import { computeLocal } from "@/src/offline/compute";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "preservia_token";
const TIMEOUT_MS = 15000;

export type ApiError = { status: number; detail: string; offline?: boolean };

const OFFLINE_MSG = "Sin conexión. Esta acción necesita internet.";

/** Petición directa al servidor (sin capa sin conexión). status 0 = sin red. */
export async function rawRequest<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    setApiOffline(true);
    throw { status: 0, detail: OFFLINE_MSG, offline: true } as ApiError;
  } finally {
    clearTimeout(timer);
  }
  setApiOffline(false);
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Error ${res.status}`;
    throw { status: res.status, detail } as ApiError;
  }
  return data as T;
}

const isOffline = (e: any) => !!e && e.status === 0;

async function request<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  await ensureLoaded();
  const method = opts.method || "GET";
  const p = resolvePath(path);

  if (method === "GET") {
    const local = localRead(p);
    if (local !== undefined) return local as T;
    try {
      const data = await rawRequest<T>(p, opts);
      if (isCacheable(p)) cacheSet(p, data);
      return overlay(p, data) as T;
    } catch (e) {
      if (!isOffline(e)) throw e;
      const cached = isCacheable(p) ? await cacheGet(p) : undefined;
      if (cached === undefined) throw { status: 0, detail: "Sin conexión y sin copia guardada en el teléfono.", offline: true };
      return overlay(p, cached) as T;
    }
  }

  // Cálculo sin guardar: si no hay señal se hace en el teléfono.
  if (method === "POST" && p === "/calculate") {
    try {
      return await rawRequest<T>(p, opts);
    } catch (e) {
      if (!isOffline(e)) throw e;
      try {
        return computeLocal(opts.body?.type, opts.body?.inputs || {}) as T;
      } catch (err: any) {
        throw { status: 400, detail: err?.message || "Datos de cálculo inválidos" };
      }
    }
  }

  if (isQueueable(method, p)) {
    // Con cambios pendientes, todo pasa por la cola para mantener el orden.
    if (getQueue().length > 0 || hasLocalId(p)) return (await enqueue(method as any, p, opts.body)) as T;
    try {
      return await rawRequest<T>(p, opts);
    } catch (e) {
      if (!isOffline(e)) throw e;
      return (await enqueue(method as any, p, opts.body)) as T;
    }
  }

  if (hasLocalId(p)) throw { status: 0, detail: "Este caso aún no se sincroniza. Inténtalo con conexión.", offline: true };
  return rawRequest<T>(p, opts);
}

export const api = {
  get: <T = any>(path: string, auth = true) => request<T>(path, { method: "GET", auth }),
  post: <T = any>(path: string, body?: any, auth = true) =>
    request<T>(path, { method: "POST", body, auth }),
  put: <T = any>(path: string, body?: any, auth = true) =>
    request<T>(path, { method: "PUT", body, auth }),
  patch: <T = any>(path: string, body?: any, auth = true) =>
    request<T>(path, { method: "PATCH", body, auth }),
  del: <T = any>(path: string, auth = true) => request<T>(path, { method: "DELETE", auth }),
};
