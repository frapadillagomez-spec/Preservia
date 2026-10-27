import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type KFSummary = {
  k: { value: number; label: string; min: number; max: number } | null;
  f: { value: number; dominant_label: string; secondary_label: string | null; adjustment_pct: number } | null;
  f_applied: number;
  lbm: { kg: number; method: string; source: string } | null;
  volume_l: number | null;
  missing: string[];
};

/** Tarjeta final del caso: K, F, masa magra y volumen recomendado (V = K × MM × F). */
export function KFSummaryCard({ s }: { s: KFSummary }) {
  return (
    <View testID="kf-summary-card" style={styles.card}>
      <View style={styles.headRow}>
        <Ionicons name="analytics-outline" size={18} color={colors.onSurface} />
        <Text style={styles.title}>Resumen K y F</Text>
      </View>

      <View style={styles.volBox}>
        <Text style={styles.volLabel}>Volumen recomendado</Text>
        <Text testID="kf-summary-volume" style={styles.volValue}>
          {s.volume_l !== null ? `${s.volume_l.toFixed(2)} L` : "—"}
        </Text>
        {s.volume_l !== null && s.k && s.lbm && (
          <Text style={styles.formula}>
            {s.k.value.toFixed(3)} L/kg × {s.lbm.kg.toFixed(1)} kg × {s.f_applied.toFixed(3)}
          </Text>
        )}
      </View>

      <View style={styles.grid}>
        <Item
          testID="kf-summary-k"
          label="Factor K"
          value={s.k ? `${s.k.value.toFixed(3)} L/kg` : "—"}
          sub={s.k ? s.k.label : "Sin condición general"}
        />
        <Item
          testID="kf-summary-f"
          label="Factor F"
          value={s.f_applied.toFixed(3)}
          sub={
            s.f
              ? `${s.f.dominant_label}${s.f.secondary_label ? ` · ${s.f.adjustment_pct > 0 ? "+" : ""}${s.f.adjustment_pct}% ${s.f.secondary_label}` : ""}`
              : "Sin condiciones (F = 1)"
          }
        />
        <Item
          testID="kf-summary-lbm"
          label="Masa magra"
          value={s.lbm ? `${s.lbm.kg.toFixed(1)} kg` : "—"}
          sub={s.lbm ? `${s.lbm.method} · ${s.lbm.source}` : "Sin datos"}
        />
      </View>

      {s.missing.length > 0 && (
        <Text testID="kf-summary-missing" style={styles.missing}>
          Falta: {s.missing.join(", ")}. Complétalo en la Hoja del caso.
        </Text>
      )}
    </View>
  );
}

function Item({ label, value, sub, testID }: { label: string; value: string; sub: string; testID: string }) {
  return (
    <View testID={testID} style={styles.item}>
      <Text style={styles.itemLabel}>{label}</Text>
      <Text style={styles.itemValue}>{value}</Text>
      <Text style={styles.itemSub} numberOfLines={3}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  volBox: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  volLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm, textTransform: "uppercase", letterSpacing: 1 },
  volValue: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.xxl, marginTop: spacing.xs },
  formula: { color: colors.onSurfaceSecondary, fontFamily: font.mono, fontSize: fontSize.sm, marginTop: spacing.xs },
  grid: { gap: spacing.sm },
  item: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  itemLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm },
  itemValue: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg, marginTop: 2 },
  itemSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2, lineHeight: 18 },
  missing: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.md, lineHeight: 18 },
});
