import { useEffect, useState } from "react";

import { api } from "@/src/api";
import { computeFactorF, FactorF } from "@/src/data/factorF";

export type CaseSheetInfo = {
  factor: FactorF | null;
  weight: string;
  height: string;
  sex: "male" | "female" | "";
};

/** Lee la hoja del caso para sugerir el Factor F y prellenar peso/estatura/sexo en las calculadoras. */
export function useCaseSheetInfo(caseId?: string): CaseSheetInfo | null {
  const [info, setInfo] = useState<CaseSheetInfo | null>(null);
  useEffect(() => {
    if (!caseId) return;
    api
      .get<{ case: any }>(`/cases/${caseId}`)
      .then((resp) => {
        const c = resp.case;
        const sh = c.case_sheet || {};
        setInfo({
          factor: computeFactorF(sh.condiciones),
          weight: String(sh.peso || "").trim(),
          height: String(sh.altura || "").trim(),
          sex: c.sex || "",
        });
      })
      .catch(() => {});
  }, [caseId]);
  return info;
}
