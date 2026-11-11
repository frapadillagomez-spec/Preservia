// Cálculos en el teléfono (sin conexión). Réplica exacta de compute() del backend.
import { computeFactorF, F_MAX, F_MIN, findGeneralCondition, K_MAX, K_MIN } from "@/src/data/factorF";

const METHOD_LABELS: Record<string, string> = {
  janmahasatian: "Janmahasatian",
  boer: "Boer",
  james: "James",
  average: "Promedio (3 metodos)",
};
export const CALC_LABELS: Record<string, string> = {
  volume: "Volumen de solucion",
  lbm: "Masa magra corporal",
  concentration: "Concentracion / Dilucion",
  injection: "Volumen de inyeccion",
  kvolume: "Volumen por Factor K",
};
const FACTORS: Record<string, number> = { normal: 1.0, jaundice: 1.15, edema: 0.85 };
const CASE_LABELS: Record<string, string> = {
  normal: "Normal",
  jaundice: "Ictericia",
  edema: "Edema",
  sheet: "Factor F (hoja del caso)",
};

const r = (v: number, d = 0) => {
  const p = 10 ** d;
  return Math.round(v * p + (v >= 0 ? 1e-9 : -1e-9)) / p;
};
const num = (v: any, name: string) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (isNaN(n)) throw new Error(`Datos de calculo invalidos: '${name}'`);
  return n;
};
const clampF = (v: any) => r(Math.min(Math.max(parseFloat(String(v ?? 1)) || 1, F_MIN), F_MAX), 3);

export function computeLbm(sex: string, w: number, h: number, method = "average") {
  const m = METHOD_LABELS[method] ? method : "average";
  const female = String(sex).toLowerCase().startsWith("f");
  const hm = h / 100;
  const bmi = hm > 0 ? w / (hm * hm) : 0;
  let boer, james, janma;
  if (female) {
    boer = 0.252 * w + 0.473 * h - 48.3;
    james = h > 0 ? 1.07 * w - 148 * (w / h) ** 2 : 0;
    janma = bmi > 0 ? (9270 * w) / (8780 + 244 * bmi) : 0;
  } else {
    boer = 0.407 * w + 0.267 * h - 19.2;
    james = h > 0 ? 1.1 * w - 128 * (w / h) ** 2 : 0;
    janma = bmi > 0 ? (9270 * w) / (6680 + 216 * bmi) : 0;
  }
  const c = { boer: Math.max(boer, 0), james: Math.max(james, 0), janmahasatian: Math.max(janma, 0) };
  const sel = m === "average" ? (c.boer + c.james + c.janmahasatian) / 3 : (c as any)[m];
  return { lbm: Math.max(sel, 0), method: m, components: c };
}

export function computeLocal(type: string, inputs: Record<string, any>): { results: Record<string, any>; summary: string } {
  const caseType = String(inputs.case_type ?? "normal").toLowerCase();
  const factorOf = () => (caseType === "sheet" ? clampF(inputs.factor_f) : FACTORS[caseType] ?? 1.0);
  if (type === "volume") {
    const w = num(inputs.weight_kg, "weight_kg");
    const basis = String(inputs.basis ?? "total").toLowerCase();
    let lbm: number | null = null;
    let lbmLabel = "";
    let eff = w;
    if (basis === "lean") {
      const info = computeLbm(String(inputs.sex ?? "male"), w, num(inputs.height_cm, "height_cm"), String(inputs.lbm_method ?? "average"));
      lbm = info.lbm;
      lbmLabel = METHOD_LABELS[info.method];
      eff = Math.max(lbm, 0);
    }
    const factor = factorOf();
    const gallons = ((eff * 2.20462) / 50) * factor;
    const results: Record<string, any> = {
      liters: r(gallons * 3.78541, 2),
      gallons: r(gallons, 2),
      weight_kg: r(w, 1),
      case_type: CASE_LABELS[caseType] ?? "Normal",
      adjustment: `x${factor}`,
      basis: basis === "lean" ? "Masa magra" : "Peso total",
    };
    if (lbm !== null) {
      results.lbm_kg = r(lbm, 1);
      results.lbm_method = lbmLabel;
    }
    const bt = lbm !== null ? ` (masa magra ${results.lbm_kg} kg)` : "";
    return { results, summary: `${results.liters} L de solucion arterial (~${results.gallons} gal) - ${results.case_type}${bt}` };
  }
  if (type === "lbm") {
    const w = num(inputs.weight_kg, "weight_kg");
    const info = computeLbm(String(inputs.sex ?? "male"), w, num(inputs.height_cm, "height_cm"), String(inputs.method ?? "average"));
    const fat = Math.max(w - info.lbm, 0);
    const results = {
      lbm_kg: r(info.lbm, 1),
      method: METHOD_LABELS[info.method],
      boer_kg: r(info.components.boer, 1),
      james_kg: r(info.components.james, 1),
      janmahasatian_kg: r(info.components.janmahasatian, 1),
      fat_kg: r(fat, 1),
      fat_pct: w ? r((fat / w) * 100, 1) : 0,
    };
    return { results, summary: `Masa magra: ${results.lbm_kg} kg (${results.method})` };
  }
  if (type === "injection") {
    const w = num(inputs.weight_kg, "weight_kg");
    const h = num(inputs.height_cm, "height_cm");
    const c1 = num(inputs.fluid_index_pct, "fluid_index_pct");
    const c2 = num(inputs.desired_index_pct, "desired_index_pct");
    const v1 = inputs.concentrate_ml !== undefined ? num(inputs.concentrate_ml, "concentrate_ml") : 473;
    if (c1 <= 0) throw new Error("El indice del fluido debe ser mayor que 0");
    if (c2 <= 0) throw new Error("El indice deseado debe ser mayor que 0");
    if (c2 > c1) throw new Error("El indice deseado no puede superar el indice del fluido");
    if (v1 <= 0) throw new Error("El volumen de concentrado (V1) debe ser mayor que 0");
    const info = computeLbm(String(inputs.sex ?? "male"), w, h, String(inputs.lbm_method ?? "average"));
    if (String(inputs.mode ?? "").toLowerCase() === "kf") {
      const k = num(inputs.k_factor, "k_factor");
      if (!(k >= K_MIN && k <= K_MAX)) throw new Error(`El Factor K debe estar entre ${K_MIN} y ${K_MAX} L/kg`);
      const f = num(inputs.factor_f, "factor_f");
      if (!(f >= F_MIN && f <= F_MAX)) throw new Error(`El Factor F debe estar entre ${F_MIN} y ${F_MAX}`);
      const tot = Math.max(info.lbm, 0) * k * f * 1000;
      const conc = (c2 * tot) / c1;
      const form = (c2 / 100) * tot;
      const coinj = (Array.isArray(inputs.coinjectors) ? inputs.coinjectors : []).map((c: any) => {
        const v = parseFloat(String(c?.volume_ml ?? 0));
        if (!(v > 0) || !String(c?.name || "").trim()) throw new Error("Cada co-inyector necesita nombre y un volumen mayor que 0");
        return { name: String(c.name).trim(), reason: String(c.reason || "").trim(), volume_ml: r(v, 1) };
      });
      const coMl = coinj.reduce((s: number, c: any) => s + c.volume_ml, 0);
      if (conc + coMl > tot) throw new Error("El concentrado y los co-inyectores superan el volumen total de inyección");
      const v1L = r(conc / 1000, 2);
      const fluidName = String(inputs.fluid_name || "").trim().slice(0, 80);
      const instruction = `Agregar ${v1L.toFixed(2)} L de Arterial ${fluidName ? fluidName + " " : ""}Index ${c1}% a la bomba de inyección`;
      const res: Record<string, any> = {
        v1_l: v1L,
        fluid_name: fluidName,
        instruction,
        lbm_kg: r(info.lbm, 1),
        lbm_method: METHOD_LABELS[info.method],
        k_factor: r(k, 3),
        factor_f: r(f, 3),
        total_l: r(tot / 1000, 2),
        total_ml: r(tot, 0),
        concentrate_ml: r(conc, 0),
        water_ml: r(tot - conc - coMl, 0),
        coinjectors_ml: r(coMl, 0),
        coinjectors: coinj,
        formaldehyde_ml: r(form, 0),
        water_injection_ml: r(Math.max(tot - form, 0), 0),
        bottles: r(conc / 473, 2),
        desired_index_pct: c2,
        fluid_index_pct: c1,
        case_type: "Factor K y F (hoja del caso)",
        adjustment: `K ${k.toFixed(3)} x F ${f.toFixed(3)}`,
      };
      return {
        results: res,
        summary: `${instruction}. Vtotal = ${res.total_l} L (MM ${info.lbm.toFixed(1)} kg x K ${k.toFixed(3)} x F ${f.toFixed(3)}); V1 = Vtotal x Cpi / C1 = ${res.total_l} L x ${c2}% / ${c1}% = ${v1L.toFixed(2)} L${coinj.length ? ` + co-inyectores ${res.coinjectors_ml.toFixed(0)} mL` : ""} + agua ${res.water_ml.toFixed(0)} mL`,
      };
    }
    const factor = factorOf();
    const total = ((c1 * v1) / c2) * factor;
    let rec = ((info.lbm * 2.20462) / 50) * 3785.41 * factor;
    const kIn = inputs.k_factor;
    const hasK = kIn !== undefined && kIn !== null && kIn !== "";
    if (hasK) {
      const k = num(kIn, "k_factor");
      if (!(k >= K_MIN && k <= K_MAX)) throw new Error(`El Factor K debe estar entre ${K_MIN} y ${K_MAX} L/kg`);
      rec = k * info.lbm * factor * 1000;
    }
    const v2b = (c1 * 473) / c2;
    const form = (c1 / 100) * v1;
    const results: Record<string, any> = {
      lbm_kg: r(info.lbm, 1),
      lbm_method: METHOD_LABELS[info.method],
      total_l: r(total / 1000, 2),
      total_ml: r(total, 0),
      concentrate_ml: r(v1, 0),
      water_ml: r(Math.max(total - v1, 0), 0),
      formaldehyde_ml: r(form, 0),
      water_injection_ml: r(Math.max(total - form, 0), 0),
      bottles: r(v1 / 473, 2),
      recommended_l: r(rec / 1000, 2),
      recommended_bottles: r(v2b > 0 ? rec / v2b : 0, 1),
      desired_index_pct: c2,
      fluid_index_pct: c1,
      case_type: CASE_LABELS[caseType] ?? "Normal",
      adjustment: `x${factor}`,
    };
    if (hasK) results.k_factor = r(num(kIn, "k_factor"), 3);
    return {
      results,
      summary: `V2 = ${results.total_l} L: formaldehido ${results.formaldehyde_ml.toFixed(0)} mL + agua ${results.water_injection_ml.toFixed(0)} mL - ${results.case_type} (x${factor})`,
    };
  }
  if (type === "kvolume") {
    const w = num(inputs.weight_kg, "weight_kg");
    const h = num(inputs.height_cm, "height_cm");
    const k = num(inputs.k_factor, "k_factor");
    if (!(k >= K_MIN && k <= K_MAX)) throw new Error(`El Factor K debe estar entre ${K_MIN} y ${K_MAX} L/kg`);
    const f = caseType === "sheet" ? clampF(inputs.factor_f) : FACTORS[caseType] ?? 1.0;
    const info = computeLbm(String(inputs.sex ?? "male"), w, h, String(inputs.lbm_method ?? "average"));
    const lbm = Math.max(info.lbm, 0);
    const liters = k * lbm * f;
    const results = {
      volume_l: r(liters, 2),
      gallons: r(liters / 3.78541, 2),
      k_factor: r(k, 3),
      factor_f: f,
      lbm_kg: r(lbm, 1),
      lbm_method: METHOD_LABELS[info.method],
      case_type: CASE_LABELS[caseType] ?? "Normal",
    };
    return {
      results,
      summary: `V = K x MM x F = ${k.toFixed(3)} L/kg x ${lbm.toFixed(1)} kg x ${f.toFixed(3)} = ${results.volume_l} L`,
    };
  }
  if (type === "concentration") {
    const t = num(inputs.total_solution_l, "total_solution_l");
    const d = num(inputs.desired_index_pct, "desired_index_pct");
    const fi = num(inputs.fluid_index_pct, "fluid_index_pct");
    if (fi <= 0) throw new Error("El indice del fluido debe ser mayor que 0");
    const conc = (d / fi) * t * 1000;
    const total = t * 1000;
    const results = { concentrate_ml: r(conc, 0), water_ml: r(Math.max(total - conc, 0), 0), total_ml: r(total, 0) };
    return { results, summary: `${results.concentrate_ml.toFixed(0)} mL concentrado + ${results.water_ml.toFixed(0)} mL agua` };
  }
  throw new Error("Tipo de calculo desconocido");
}

/** Réplica de case_kf_summary() del backend. */
export function kfSummaryLocal(c: any) {
  const sheet = c.case_sheet || {};
  const g = findGeneralCondition(sheet.condicion_general);
  const k = g ? { value: g.avg, label: g.label, min: g.min, max: g.max } : null;
  const ff = computeFactorF(sheet.condiciones);
  const f = ff
    ? { value: ff.f, dominant_label: ff.dominant.label, secondary_label: ff.secondary?.label ?? null, adjustment_pct: ff.adjustmentPct }
    : null;
  let lbm: { kg: number; method: string; source: string } | null = null;
  const calcs = [...(c.calculations || [])].reverse();
  for (const calc of calcs) {
    const res = calc.results || {};
    if (typeof res.lbm_kg === "number" && res.lbm_kg > 0) {
      lbm = { kg: r(res.lbm_kg, 1), method: res.lbm_method || res.method || "", source: "Último cálculo guardado" };
      break;
    }
  }
  if (!lbm) {
    const w = parseFloat(String(sheet.peso || "").replace(",", "."));
    const h = parseFloat(String(sheet.altura || "").replace(",", "."));
    if (w > 0 && h > 0 && (c.sex === "male" || c.sex === "female")) {
      const info = computeLbm(c.sex, w, h, "average");
      lbm = { kg: r(info.lbm, 1), method: METHOD_LABELS[info.method], source: "Peso y altura de la hoja" };
    }
  }
  const fApplied = f ? f.value : 1.0;
  const missing: string[] = [];
  if (!k) missing.push("condición general (Factor K)");
  if (!lbm) missing.push("masa magra (peso, altura y sexo, o un cálculo guardado)");
  return { k, f, f_applied: fApplied, lbm, volume_l: k && lbm ? r(k.value * lbm.kg * fApplied, 2) : null, missing };
}
