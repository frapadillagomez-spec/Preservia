// Factor de corrección F por condición del cuerpo (mismo cálculo que el backend).
export type BodyCondition = { key: string; label: string; min: number; max: number; avg: number };

export const BODY_CONDITIONS: BodyCondition[] = [
  { key: "rutinario", label: "Caso rutinario, vascularización conservada", min: 1.0, max: 1.0, avg: 1.0 },
  { key: "delgado", label: "Adulto delgado, sin deshidratación", min: 0.95, max: 1.0, avg: 0.975 },
  { key: "obesidad_moderada", label: "Obesidad moderada", min: 0.9, max: 1.0, avg: 0.95 },
  { key: "obesidad_severa", label: "Obesidad severa o mórbida", min: 0.85, max: 0.95, avg: 0.9 },
  { key: "caquexia", label: "Caquexia o emaciación", min: 0.9, max: 1.0, avg: 0.95 },
  { key: "deshidratacion_leve", label: "Deshidratación leve", min: 1.0, max: 1.1, avg: 1.05 },
  { key: "deshidratacion_intensa", label: "Deshidratación intensa o momificación parcial", min: 1.1, max: 1.2, avg: 1.15 },
  { key: "edema_localizado", label: "Edema localizado", min: 0.9, max: 1.0, avg: 0.95 },
  { key: "edema_generalizado", label: "Edema generalizado", min: 0.8, max: 0.9, avg: 0.85 },
  { key: "anasarca", label: "Anasarca severa", min: 0.75, max: 0.85, avg: 0.8 },
  { key: "ascitis", label: "Ascitis sin edema generalizado", min: 0.9, max: 1.0, avg: 0.95 },
  { key: "ictericia", label: "Ictericia sin edema", min: 1.0, max: 1.1, avg: 1.05 },
  { key: "refrigeracion", label: "Refrigeración prolongada", min: 1.05, max: 1.15, avg: 1.1 },
  { key: "intervalo_pm", label: "Intervalo post mortem prolongado", min: 1.1, max: 1.25, avg: 1.175 },
  { key: "putrefaccion_inicial", label: "Putrefacción inicial", min: 1.1, max: 1.2, avg: 1.15 },
  { key: "putrefaccion_avanzada", label: "Putrefacción moderada o avanzada", min: 1.2, max: 1.35, avg: 1.275 },
  { key: "diabetes_vascular", label: "Diabetes o enfermedad vascular periférica", min: 1.1, max: 1.2, avg: 1.15 },
  { key: "aterosclerosis", label: "Aterosclerosis severa", min: 1.1, max: 1.25, avg: 1.175 },
  { key: "insuficiencia_edema", label: "Insuficiencia renal o cardiaca con edema", min: 0.8, max: 0.95, avg: 0.875 },
  { key: "trauma_localizado", label: "Trauma localizado", min: 1.0, max: 1.15, avg: 1.075 },
  { key: "trauma_multiple", label: "Trauma múltiple o hemorragia extensa", min: 1.1, max: 1.25, avg: 1.175 },
  { key: "quemaduras", label: "Quemaduras extensas", min: 1.1, max: 1.3, avg: 1.2 },
  { key: "autopsiado", label: "Caso autopsiado", min: 1.15, max: 1.3, avg: 1.225 },
  { key: "donacion", label: "Donación de órganos o tejidos", min: 1.1, max: 1.25, avg: 1.175 },
];

export const F_MIN = 0.75;
export const F_MAX = 1.35;

export type FactorF = {
  f: number;
  dominant: BodyCondition;
  secondary: BodyCondition | null;
  adjustmentPct: number;
};

/** Condición dominante (mayor efecto |F-1|), ajustada ±5% / ±10% por la segunda. Acotado a 0.75–1.35. */
export function computeFactorF(keys: string[] | undefined): FactorF | null {
  const sel = BODY_CONDITIONS.filter((c) => (keys || []).includes(c.key));
  if (!sel.length) return null;
  const sorted = [...sel].sort((a, b) => Math.abs(b.avg - 1) - Math.abs(a.avg - 1));
  const dominant = sorted[0];
  const secondary = sorted[1] || null;
  let f = dominant.avg;
  let adjustmentPct = 0;
  if (secondary) {
    const dev = secondary.avg - 1;
    if (Math.abs(dev) > 1e-9) {
      adjustmentPct = (Math.abs(dev) <= 0.1 + 1e-9 ? 5 : 10) * (dev > 0 ? 1 : -1);
      f = f * (1 + adjustmentPct / 100);
    }
  }
  f = Math.round(Math.min(Math.max(f, F_MIN), F_MAX) * 1000 + 1e-6) / 1000;
  return { f, dominant, secondary, adjustmentPct };
}
