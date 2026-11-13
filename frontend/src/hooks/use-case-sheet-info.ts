import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { computeFactorF, FactorF, findGeneralCondition, GeneralCondition } from "@/src/data/factorF";

export type CaseSheetInfo = {
  factor: FactorF | null;
  general: GeneralCondition | null;
  weight: string;
  height: string;
  sex: "male" | "female" | "";
  logbook: { product: string; form: string; quantity: number; unit: string; source?: string; category?: string }[];
};

/** Lee la hoja del caso para sugerir el Factor F y prellenar peso/estatura/sexo en las calculadoras. */
export function useCaseSheetInfo(caseId?: string): CaseSheetInfo | null {
  const [info, setInfo] = useState<CaseSheetInfo | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!caseId) return;
      api
        .get<{ case: any }>(`/cases/${caseId}`)
        .then((resp) => {
          const c = resp.case;
          const sh = c.case_sheet || {};
          setInfo({
            factor: computeFactorF(sh.condiciones),
            general: findGeneralCondition(sh.condicion_general),
            weight: String(sh.peso || "").trim(),
            height: String(sh.altura || "").trim(),
            sex: c.sex || "",
            logbook: Array.isArray(c.logbook) ? c.logbook : [],
          });
        })
        .catch(() => {});
    }, [caseId]),
  );
  return info;
}
