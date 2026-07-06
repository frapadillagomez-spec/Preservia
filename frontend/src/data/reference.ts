import { Ionicons } from "@expo/vector-icons";

export type RefSection = { heading?: string; body?: string; bullets?: string[] };
export type RefTable = { columns: string[]; rows: string[][] };
export type RefArticle = {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  summary: string;
  sections: RefSection[];
  table?: { title: string; data: RefTable };
};

export const REFERENCE: RefArticle[] = [
  {
    id: "volume",
    title: "Volumen de solución arterial",
    icon: "flask-outline",
    summary: "Cómo estimar el volumen total de solución según el peso corporal.",
    sections: [
      {
        body: "El volumen de solución arterial necesario se estima a partir del peso corporal del fallecido. La regla estándar de referencia es aproximadamente 1 galón (3.785 L) de solución por cada 50 libras (≈22.7 kg) de peso.",
      },
      {
        heading: "Fórmula",
        body: "Galones = peso (lb) ÷ 50\nLitros = galones × 3.785\n(peso en lb = peso en kg × 2.205)",
      },
      {
        heading: "Consideraciones",
        bullets: [
          "Aumentar el volumen en casos con edema, obesidad o descomposición avanzada.",
          "Reducir en casos de deshidratación o cuerpos de bajo peso.",
          "Es una estimación inicial; ajusta según la respuesta de los tejidos durante la inyección.",
        ],
      },
    ],
  },
  {
    id: "lbm",
    title: "Masa magra corporal (Boer)",
    icon: "body-outline",
    summary: "Cálculo de la masa magra usando la fórmula de Boer.",
    sections: [
      {
        body: "La masa magra corporal (MMC) representa el peso sin grasa. Es útil como referencia fisiológica para dosificación y valoración del caso.",
      },
      {
        heading: "Fórmula de Boer",
        body: "Hombres: MMC = 0.407 × peso(kg) + 0.267 × estatura(cm) − 19.2\nMujeres: MMC = 0.252 × peso(kg) + 0.473 × estatura(cm) − 48.3",
      },
      {
        heading: "Interpretación",
        bullets: [
          "Grasa estimada = peso total − masa magra.",
          "Mayor proporción de grasa puede requerir ajustes en el índice de la solución.",
        ],
      },
    ],
  },
  {
    id: "concentration",
    title: "Concentración y dilución",
    icon: "beaker-outline",
    summary: "Cómo obtener el índice deseado mezclando fluido concentrado y agua.",
    sections: [
      {
        body: "Para lograr una concentración (índice) determinada se combina fluido concentrado con agua. Se basa en la relación de dilución C₁V₁ = C₂V₂.",
      },
      {
        heading: "Fórmula",
        body: "Fluido concentrado (mL) = (índice deseado % ÷ índice del fluido %) × volumen total (L) × 1000\nAgua (mL) = volumen total (mL) − fluido concentrado (mL)",
      },
      {
        heading: "Ejemplo",
        body: "Para 4 L al 2% usando un fluido índice 25%:\nConcentrado = (2 ÷ 25) × 4 × 1000 = 320 mL\nAgua = 4000 − 320 = 3680 mL",
      },
    ],
    table: {
      title: "Índices recomendados según el caso",
      data: {
        columns: ["Tipo de caso", "Índice sugerido"],
        rows: [
          ["Estándar / normal", "1.5% – 2.0%"],
          ["Edematoso", "1.0% – 1.5%"],
          ["Deshidratado", "2.0% – 2.5%"],
          ["Ictericia", "2.0% – 3.0%"],
          ["Descomposición avanzada", "3.0% – 5.0%"],
        ],
      },
    },
  },
  {
    id: "documentation",
    title: "Buenas prácticas de documentación",
    icon: "clipboard-outline",
    summary: "Recomendaciones para registrar casos de forma completa y trazable.",
    sections: [
      {
        heading: "Qué registrar",
        bullets: [
          "Datos del caso: referencia, fecha y responsable.",
          "Cálculos aplicados y valores obtenidos.",
          "Observaciones del estado del cuerpo y tratamiento realizado.",
          "Fotografías de respaldo cuando el protocolo lo permita.",
        ],
      },
      {
        heading: "Consejos",
        bullets: [
          "Documenta durante el procedimiento, no después.",
          "Genera el reporte PDF al cerrar cada caso.",
          "Mantén un lenguaje objetivo y profesional.",
        ],
      },
    ],
  },
];

export function getArticle(id: string): RefArticle | undefined {
  return REFERENCE.find((a) => a.id === id);
}
