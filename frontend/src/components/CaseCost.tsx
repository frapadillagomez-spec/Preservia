import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Cost = {
  currency: string;
  total: number;
  groups: { key: string; label: string; total: number; items: { label: string; cost: number }[] }[];
  missing: string[];
  service_price?: number;
  margin?: number;
  margin_pct?: number | null;
};

export const mxn = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Costo en fluidos del caso (MXN): arterial, co-inyectores, cavidades y otros. */
export function CaseCost({ caseId, refreshKey }: { caseId: string; refreshKey?: string }) {
  const [data, setData] = useState<Cost | null>(null);
  const [err, setErr] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCost = useCallback(() => {
    setErr("");
    api
      .get<Cost>(`/cases/${caseId}/cost`)
      .then((d) => {
        setData(d);
        setPrice(d.service_price !== undefined ? String(d.service_price) : "");
      })
      .catch((e: any) => setErr(e?.status === 0 ? "Sin conexión: el costo necesita internet" : e?.detail || "No se pudo calcular el costo"));
  }, [caseId]);

  const savePrice = async () => {
    const t = price.trim().replace(",", ".");
    const v = t === "" ? null : Number(t);
    if (v !== null && !(v >= 0)) {
      setErr("Escribe un precio válido");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/cases/${caseId}/service-price`, { price: v });
      fetchCost();
    } catch (e: any) {
      setErr(e?.status === 0 ? "Sin conexión: guarda el precio con internet" : e?.detail || "No se pudo guardar el precio");
    } finally {
      setSaving(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchCost();
      // refreshKey vuelve a calcular tras confirmar/anular una mezcla
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchCost, refreshKey]),
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
      {data && (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Precio del servicio (MXN)</Text>
          <View style={styles.priceRow}>
            <TextInput
              testID="service-price-input"
              value={price}
              onChangeText={setPrice}
              placeholder="Ej. 6500"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <Pressable testID="service-price-save" onPress={savePrice} disabled={saving} style={styles.saveBtn}>
              {saving ? <ActivityIndicator color={colors.onSurfaceInverse} /> : <Text style={styles.saveText}>Guardar</Text>}
            </Pressable>
          </View>
          {data.service_price !== undefined && (
            <View testID="case-margin" style={styles.row}>
              <Text style={styles.groupLabel}>Margen (servicio − fluidos)</Text>
              <Text style={[styles.groupTotal, (data.margin ?? 0) < 0 && { color: colors.error }]}>
                {mxn(data.margin ?? 0)}
                {data.margin_pct !== null && data.margin_pct !== undefined ? ` · ${data.margin_pct}%` : ""}
              </Text>
            </View>
          )}
          <Text style={styles.sub}>Solo el precio del servicio aparece en el PDF del caso.</Text>
        </View>
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
  priceRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    backgroundColor: colors.surface,
  },
  saveBtn: { minHeight: 44, minWidth: 88, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceInverse, justifyContent: "center", alignItems: "center" },
  saveText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.sm },
});
