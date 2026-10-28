// Almacén sin conexión: caché de lecturas, cola de cambios pendientes y mapa de ids locales.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CALC_LABELS, computeLocal, kfSummaryLocal } from "@/src/offline/compute";

export type PendingOp = {
  op_id: string;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  body: any;
  created_at: string;
  /** updated_at del caso visto por última vez en el servidor (para detectar conflictos). */
  base_updated_at?: string | null;
  /** id local generado para casos/notas/bitácora/cálculos creados sin conexión. */
  local_id?: string;
};

const CACHE_PREFIX = "off_cache:";
const QUEUE_KEY = "off_queue";
const IDMAP_KEY = "off_idmap";

let queue: PendingOp[] = [];
let idMap: Record<string, string> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const ensureLoaded = () => {
  if (!loaded) {
    loaded = (async () => {
      try {
        queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || "[]");
        idMap = JSON.parse((await AsyncStorage.getItem(IDMAP_KEY)) || "{}");
      } catch {
        queue = [];
        idMap = {};
      }
    })();
  }
  return loaded;
};

export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const notify = () => listeners.forEach((fn) => fn());

export const getQueue = () => queue;

// Último resultado de red conocido por las peticiones (complementa a NetInfo).
let apiOffline = false;
export const isApiOffline = () => apiOffline;
export const setApiOffline = (v: boolean) => {
  if (apiOffline !== v) {
    apiOffline = v;
    notify();
  }
};
const saveQueue = async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
};

export const newLocalId = (prefix: string) =>
  `local_${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Traduce ids locales ya sincronizados a sus ids reales del servidor. */
export const resolvePath = (path: string) => path.replace(/local_[a-z]+_[a-z0-9]+/g, (m) => idMap[m] || m);
export const hasLocalId = (path: string) => /local_[a-z]+_[a-z0-9]+/.test(resolvePath(path));

export async function mapId(localId: string, realId: string) {
  idMap[localId] = realId;
  await AsyncStorage.setItem(IDMAP_KEY, JSON.stringify(idMap));
}

// ---------- caché ----------
const CACHEABLE = [/^\/cases$/, /^\/cases\/[^/]+$/, /^\/cases\/[^/]+\/attachments$/, /^\/catalog\/documents$/, /^\/library\/documents$/, /^\/stats$/, /^\/coinjectors$/, /^\/fluids$/];
export const isCacheable = (path: string) => CACHEABLE.some((re) => re.test(path));

export async function cacheSet(path: string, data: any) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data));
  } catch {
    /* almacenamiento lleno: se ignora */
  }
}
export async function cacheGet(path: string): Promise<any | undefined> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + path);
  return raw ? JSON.parse(raw) : undefined;
}

// ---------- cola ----------
const OFFLINE_OPS: { method: string; re: RegExp }[] = [
  { method: "POST", re: /^\/cases$/ },
  { method: "PUT", re: /^\/cases\/[^/]+$/ },
  { method: "PUT", re: /^\/cases\/[^/]+\/sheet$/ },
  { method: "PATCH", re: /^\/cases\/[^/]+\/status$/ },
  { method: "POST", re: /^\/cases\/[^/]+\/notes$/ },
  { method: "POST", re: /^\/cases\/[^/]+\/logbook$/ },
  { method: "POST", re: /^\/cases\/[^/]+\/calculations$/ },
];
export const isQueueable = (method: string, path: string) => OFFLINE_OPS.some((o) => o.method === method && o.re.test(path));

const caseIdOf = (path: string) => path.split("/")[2];
const nowIso = () => new Date().toISOString();

/** Guarda un cambio pendiente y devuelve la respuesta que daría el servidor. */
export async function enqueue(method: PendingOp["method"], path: string, body: any): Promise<any> {
  await ensureLoaded();
  const p = resolvePath(path);
  const op: PendingOp = { op_id: newLocalId("op"), method, path: p, body, created_at: nowIso() };
  const isCaseEdit = (method === "PUT" || method === "PATCH") && p.startsWith("/cases/");
  if (isCaseEdit) {
    const cached = await cacheGet(`/cases/${caseIdOf(p)}`);
    op.base_updated_at = cached?.case?.updated_at ?? null;
  }
  if (method === "POST" && p === "/cases") op.local_id = newLocalId("case");
  if (method === "POST" && /\/notes$/.test(p)) op.local_id = newLocalId("note");
  if (method === "POST" && /\/logbook$/.test(p)) op.local_id = newLocalId("log");
  if (method === "POST" && /\/calculations$/.test(p)) {
    op.local_id = newLocalId("calc");
    computeLocal(body.type, body.inputs || {}); // valida antes de encolar
  }
  queue.push(op);
  await saveQueue();
  return syntheticResponse(op);
}

export async function removeOp(opId: string) {
  queue = queue.filter((o) => o.op_id !== opId);
  await saveQueue();
}
export async function replaceQueue(next: PendingOp[]) {
  queue = next;
  await saveQueue();
}

function newCase(op: PendingOp) {
  const b = op.body || {};
  return {
    case_id: op.local_id,
    case_number: "Pendiente",
    name: (b.name || "").trim() || (b.deceased_name || "").trim() || "Caso nuevo",
    case_ref: b.case_ref || "",
    deceased_name: b.deceased_name || "",
    sex: b.sex || "",
    date: b.date || op.created_at,
    date_of_death: b.date_of_death || null,
    embalming_date: op.created_at,
    embalming_start: b.embalming_start || null,
    embalming_end: b.embalming_end || null,
    status: b.status || "active",
    calculations: [],
    logbook: [],
    notes: [],
    case_sheet: null,
    created_at: op.created_at,
    updated_at: op.created_at,
    calc_count: 0,
    note_count: 0,
    _pending: true,
  };
}

function syntheticResponse(op: PendingOp) {
  const b = op.body || {};
  if (op.path === "/cases") return { case: newCase(op) };
  if (/\/notes$/.test(op.path)) return { note: { note_id: op.local_id, text: b.text, photos: b.photos || [], date: b.date || op.created_at, created_at: op.created_at, _pending: true } };
  if (/\/logbook$/.test(op.path)) {
    return { entry: { log_id: op.local_id, product: String(b.product || "").trim(), form: b.form, quantity: b.quantity, unit: b.unit, created_at: op.created_at, _pending: true } };
  }
  if (/\/calculations$/.test(op.path)) {
    const c = computeLocal(b.type, b.inputs || {});
    return { calculation: { calc_id: op.local_id, type: b.type, label: CALC_LABELS[b.type] || b.type, inputs: b.inputs, ...c, created_at: op.created_at, _pending: true } };
  }
  return { ok: true, _pending: true };
}

/** Aplica sobre un caso los cambios pendientes que le corresponden. */
function applyToCase(c: any, ops: PendingOp[]) {
  let touched = false;
  for (const op of ops) {
    const id = caseIdOf(op.path);
    if (op.path === "/cases" || resolvePath(`/cases/${id}`) !== `/cases/${c.case_id}`) continue;
    touched = true;
    const b = op.body || {};
    if (op.method === "PUT" && op.path.endsWith("/sheet")) c.case_sheet = b.sheet ?? b;
    else if (op.method === "PUT") Object.assign(c, b);
    else if (op.method === "PATCH") c.status = b.status;
    else if (op.path.endsWith("/notes")) {
      c.notes = [syntheticResponse(op).note, ...(c.notes || [])];
      c.note_count = (c.note_count || 0) + 1;
    } else if (op.path.endsWith("/logbook")) c.logbook = [...(c.logbook || []), syntheticResponse(op).entry];
    else if (op.path.endsWith("/calculations")) {
      c.calculations = [...(c.calculations || []), syntheticResponse(op).calculation];
      c.calc_count = (c.calc_count || 0) + 1;
    }
    c.updated_at = op.created_at;
    c._pending = true;
  }
  if (touched && c.calculations) c.kf_summary = kfSummaryLocal(c);
  return c;
}

/** Superpone los cambios pendientes sobre una lectura (del servidor o de la caché). */
export function overlay(path: string, data: any): any {
  if (!queue.length) return data;
  const p = resolvePath(path);
  if (p === "/cases") {
    const created = queue.filter((o) => o.path === "/cases" && !idMap[o.local_id!]).map((o) => applyToCase(newCase(o), queue));
    const list = (data?.cases || []).map((c: any) => applyToCase({ ...c }, queue));
    return { ...data, cases: [...created.reverse(), ...list] };
  }
  const m = p.match(/^\/cases\/([^/]+)$/);
  if (m && data?.case) return { ...data, case: applyToCase(JSON.parse(JSON.stringify(data.case)), queue) };
  return data;
}

/** Lectura para un caso creado sin conexión que aún no existe en el servidor. */
export function localRead(path: string): any | undefined {
  const p = resolvePath(path);
  const m = p.match(/^\/cases\/(local_case_[a-z0-9]+)(\/attachments)?$/);
  if (!m) return undefined;
  if (m[2]) return { attachments: [] };
  const op = queue.find((o) => o.local_id === m[1]);
  return op ? { case: applyToCase(newCase(op), queue) } : undefined;
}
