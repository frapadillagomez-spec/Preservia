import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Props = {
  f: {
    k_avg: number | null;
    f_avg: number | null;
    k_cases: number;
    f_cases: number;
    top_general: { label: string; count: number }[];
    top_conditions: { label: string; count: number }[];
    top_coinjectors: { name: string; count: number; avg_ml: number }[];
  };
};

/** Historial: K y F promedio, condiciones y co-inyectores más usados. */
export function FactorsSection({ f }: Props) {
  return (
    <View testID="stats-factors">
      <Text style={styles.sectionLabel}>Factores K y F</Text>
      <View style={styles.row}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>K promedio</Text>
          <Text testID="stats-k-avg" style={styles.cardNum}>{f.k_avg !== null ? f.k_avg.toFixed(3) : "—"}</Text>
          <Text style={styles.cardSub}>L/kg · {f.k_cases} caso{f.k_cases === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>F promedio</Text>
          <Text testID="stats-f-avg" style={styles.cardNum}>{f.f_avg !== null ? f.f_avg.toFixed(3) : "—"}</Text>
          <Text style={styles.cardSub}>{f.f_cases} caso{f.f_cases === 1 ? "" : "s"}</Text>
        </View>
      </View>

      <List title="Condición general más frecuente" testID="stats-top-general" rows={f.top_general.map((g) => ({ label: g.label, value: `${g.count}` }))} empty="Aún no hay condiciones generales registradas" />
      <List title="Condiciones del cuerpo más frecuentes" testID="stats-top-conditions" rows={f.top_conditions.map((g) => ({ label: g.label, value: `${g.count}` }))} empty="Aún no hay condiciones registradas" />
      <List
        title="Co-inyectores más usados"
        testID="stats-top-coinjectors"
        rows={f.top_coinjectors.map((c) => ({ label: c.name, value: `${c.count} · ~${c.avg_ml} mL` }))}
        empty="Aún no hay co-inyectores en cálculos guardados"
      />
    </View>
  );
}

export type MixMonth = {
  key: string;
  label: string;
  mixes: number;
  total_bottles: number;
  fluids: { name: string; mixes: number; bottles: number; liters: number }[];
};

/** Historial de mezclas confirmadas: arteriales y botellas más usados por mes. */
export function MixHistory({ months }: { months: MixMonth[] }) {
  return (
    <View testID="stats-mixes">
      <Text style={styles.sectionLabel}>Historial de mezclas</Text>
      {months.length === 0 ? (
        <View style={styles.list}>
          <Text style={styles.empty}>Aún no hay mezclas confirmadas. Usa “Confirmar mezcla” en el Reporte del caso.</Text>
        </View>
      ) : (
        months.map((m) => (
          <List
            key={m.key}
            testID={`stats-mix-${m.key}`}
            title={`${m.label} · ${m.mixes} mezcla${m.mixes === 1 ? "" : "s"} · ${m.total_bottles} botellas`}
            rows={m.fluids.map((f) => ({ label: f.name, value: `${f.bottles} bot · ${f.liters} L` }))}
            empty=""
          />
        ))
      )}
    </View>
  );
}

function List({ title, rows, empty, testID }: { title: string; rows: { label: string; value: string }[]; empty: string; testID: string }) {
  return (
    <View testID={testID} style={styles.list}>
      <Text style={styles.listTitle}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        rows.map((r, i) => (
          <View key={`${r.label}-${i}`} style={[styles.listRow, i > 0 && styles.listRowBorder]}>
            <Ionicons name="ellipse" size={8} color={colors.onSurfaceTertiary} />
            <Text style={styles.listLabel} numberOfLines={2}>{r.label}</Text>
            <Text style={styles.listValue}>{r.value}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  row: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  card: { flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  cardLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm },
  cardNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.xxl, marginTop: spacing.xs },
  cardSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  list: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  listTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  listRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  listRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  listLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm },
  listValue: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.sm },
});
