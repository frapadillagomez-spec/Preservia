// Utilidades de fecha/hora en horario de México (UTC-6, sin horario de verano).
// México central abolió el horario de verano en 2022, por lo que el offset es fijo.

export const MX_OFFSET = "-06:00";
const MX_MS = 6 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Devuelve un Date cuyos campos UTC representan la hora de pared en México. */
function toMx(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() - MX_MS);
}

/** Momento actual expresado como hora de pared de México. */
function mxNow(): Date {
  return new Date(Date.now() - MX_MS);
}

/** ISO UTC (almacenamiento) -> ["AAAA-MM-DD", "HH:MM"] en horario de México. */
export function splitMx(iso?: string | null): [string, string] {
  const d = toMx(iso);
  if (!d) return ["", ""];
  return [
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  ];
}

/** ISO UTC -> "HH:MM" en horario de México. */
export function timeMx(iso?: string | null): string {
  return splitMx(iso)[1];
}

/** ISO UTC -> "AAAA-MM-DD" en horario de México. */
export function dateMx(iso?: string | null): string {
  return splitMx(iso)[0];
}

/** Fecha (AAAA-MM-DD) + hora (HH:MM) escritas por el usuario en México -> ISO UTC. */
export function mxToISO(dateStr: string, timeStr: string): string | null {
  if (!dateStr.trim()) return null;
  const dt = new Date(`${dateStr.trim()}T${(timeStr.trim() || "00:00")}:00${MX_OFFSET}`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Fecha y hora actuales de México como ["AAAA-MM-DD", "HH:MM"]. */
export function nowMxParts(): [string, string] {
  const d = mxNow();
  return [
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  ];
}

const MONTHS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];

/** ISO UTC -> "dd mmm aaaa" en horario de México. */
export function fmtDateMx(iso?: string | null): string {
  const d = toMx(iso);
  if (!d) return "";
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ISO UTC -> "dd mmm aaaa, HH:MM" en horario de México. */
export function fmtDateTimeMx(iso?: string | null): string {
  const d = toMx(iso);
  if (!d) return "";
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
