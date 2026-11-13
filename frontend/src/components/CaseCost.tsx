import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Cost = {
  currency: string;
  total: number;
  groups: { key: string; label: string; total: number; items: { label: string; cost: number }[] }[];
  missing: string[];
};

export const mxn = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Costo en fluidos del caso (MXN): arterial, co-inyectores, cavidades y otros. */
export function CaseCost({ caseId, refreshKey }: { caseId: string; refreshKey?: string }) {
  const [data, setData] = useState<Cost | null>(null);
  const [err, setErr] = useState("");

  useFocusEffect(
    useCallback(() => {
      setErr("");
      api
        .get<Cost>(`/cases/${caseId}/cost`)
        .then(setData)
        .catch((e: any) => setErr(e?.status === 0 ? "Sin conexión: el costo necesita internet" : e?.detail || "No se pudo calcular el costo"));
      // refreshKey vuelve a calcular tras confirmar/anular una mezcla
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId, refreshKey]),
  );

  return (
    <View testID="case-cost" style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Costo en fluidos</Text>
        {data && <Text testID="case-cost-total" style={styles.total}>{mxn(data.total)} MXN</Text>}
      </View>
      {!data && !err && <ActivityIndicator color={colors.onSurface} />}
      {!!err && <Text style={styles.sub}>{err}</Text>}
      {data && data.groups.length === 0 && (
        <Text style={styles.sub}>Aún no hay costos: confirma la mezcla y registra precios en Biblioteca.</Text>
      )}
      {data?.groups.map((g) => (
        <View key={g.key} testID={`case-cost-${g.key}`} style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            <Text style={styles.groupTotal}>{mxn(g.total)}</Text>
          </View>
          {g.items.map((it, i) => (
            <View key={`${it.label}-${i}`} style={styles.row}>
              <Text style={styles.item} numberOfLines={1}>{it.label}</Text>
              <Text style={styles.item}>{mxn(it.cost)}</Text>
            </View>
          ))}
        </View>
      ))}
      {data && data.missing.length > 0 && (
        <Text testID="case-cost-missing" style={[styles.sub, { color: colors.warning }]}>
          Sin precio: {data.missing.join(", ")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.surface, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  total: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  group: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  groupLabel: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  groupTotal: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.sm },
  item: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, flexShrink: 1 },
});
