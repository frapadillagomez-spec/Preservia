// Sincronización de la cola de cambios hechos sin conexión.
import { ApiError, rawRequest } from "@/src/api";
import { ensureLoaded, getQueue, mapId, notify, PendingOp, removeOp, replaceQueue, resolvePath } from "@/src/offline/store";

export type Conflict = { op: PendingOp; caseName: string; serverUpdatedAt: string; description: string };
export type SyncState = { running: boolean; conflict: Conflict | null; lastError: string | null; lastSyncAt: string | null };

const state: SyncState = { running: false, conflict: null, lastError: null, lastSyncAt: null };
let resolveConflict: ((choice: "mine" | "server") => void) | null = null;

export const getSyncState = () => state;

export function chooseConflict(choice: "mine" | "server") {
  resolveConflict?.(choice);
}

const describe = (ops: PendingOp[]) => {
  const parts = new Set<string>();
  for (const op of ops) {
    if (op.path.endsWith("/sheet")) parts.add("la Hoja del caso (incluye firma)");
    else if (op.method === "PATCH") parts.add("el estado del caso");
    else if (op.method === "PUT") parts.add("los datos del caso");
  }
  return [...parts].join(" y ") || "el caso";
};

const caseIdOf = (path: string) => path.split("/")[2];

/** Sube los cambios pendientes en orden. Se detiene si no hay red. */
export async function syncNow(): Promise<void> {
  await ensureLoaded();
  if (state.running || !getQueue().length) return;
  state.running = true;
  state.lastError = null;
  notify();
  const confirmed = new Set<string>(); // casos ya resueltos o tocados en esta sincronización
  try {
    while (getQueue().length) {
      const op = getQueue()[0];
      const path = resolvePath(op.path);
      const cid = path.startsWith("/cases/") ? caseIdOf(path) : "";
      // Base más antigua de las ediciones pendientes de este caso (se revisa antes del primer envío del caso).
      const base =
        cid && !confirmed.has(cid)
          ? getQueue()
              .filter((o) => caseIdOf(resolvePath(o.path)) === cid && o.base_updated_at)
              .map((o) => o.base_updated_at as string)
              .sort()[0]
          : undefined;

      if (cid && base && !confirmed.has(cid)) {
        const srv = await rawRequest<{ case: any }>(`/cases/${cid}`).catch((e: ApiError) => {
          if (e.status === 0) throw e;
          return null;
        });
        if (srv?.case?.updated_at && srv.case.updated_at > base) {
          const choice = await new Promise<"mine" | "server">((resolve) => {
            resolveConflict = resolve;
            state.conflict = {
              op,
              caseName: srv.case.deceased_name || srv.case.case_number || "Caso",
              serverUpdatedAt: srv.case.updated_at,
              description: describe(
                getQueue().filter((o) => caseIdOf(resolvePath(o.path)) === cid && (o.method === "PUT" || o.method === "PATCH")),
              ),
            };
            notify();
          });
          resolveConflict = null;
          state.conflict = null;
          if (choice === "server") {
            // Se descartan las ediciones pendientes de ese caso; notas, bitácora y cálculos se conservan.
            await replaceQueue(
              getQueue().filter((o) => !(caseIdOf(resolvePath(o.path)) === cid && (o.method === "PUT" || o.method === "PATCH"))),
            );
            continue;
          }
        }
        confirmed.add(cid);
      }

      try {
        const resp: any = await rawRequest(path, { method: op.method, body: op.body });
        if (op.local_id) {
          const real = resp?.case?.case_id || resp?.note?.note_id || resp?.entry?.log_id || resp?.calculation?.calc_id;
          if (real) await mapId(op.local_id, real);
          if (resp?.case?.case_id) confirmed.add(resp.case.case_id);
        }
        if (cid) confirmed.add(cid);
        await removeOp(op.op_id);
      } catch (e: any) {
        if (e?.status === 0) throw e;
        // El servidor rechazó el cambio (datos inválidos o caso borrado): se descarta para no bloquear la cola.
        state.lastError = `No se pudo sincronizar un cambio: ${e?.detail || "error"}`;
        await removeOp(op.op_id);
      }
    }
    state.lastSyncAt = new Date().toISOString();
  } catch {
    /* sin red: se reintenta después */
  } finally {
    state.running = false;
    notify();
  }
}
