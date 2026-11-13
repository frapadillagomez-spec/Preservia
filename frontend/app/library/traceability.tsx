import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { CAT_LABEL, LogCategory } from "@/src/components/ProductLogModal";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { fmtDateMx } from "@/src/utils/mxtime";

type Use = {
  case_id: string;
  case_number: string;
  deceased_name: string;
  date: string;
  quantity: number;
  unit: string;
  category: LogCategory;
  used_at: string;
};
type Group = { product: string; lot: string; cases: number; uses: Use[] };

/** Trazabilidad: en qué casos se usó cada lote (para retiros del fabricante). */
export default function Traceability() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lot?: string; product?: string }>();
  const [q, setQ] = useState(params.lot || "");
  const [product, setProduct] = useState(params.product || "");
  const [items, setItems] = useState<Group[] | null>(null);
  const [err, setErr] = useState("");

  const search = useCallback(() => {
    setErr("");
    setItems(null);
    api
      .get<{ items: Group[] }>(`/lots/trace?q=${encodeURIComponent(q.trim())}&product=${encodeURIComponent(product.trim())}`)
      .then((r) => setItems(r.items || []))
      .catch((e: any) => {
        setItems([]);
        setErr(e?.status === 0 ? "Sin conexión: la búsqueda necesita internet" : e?.detail || "No se pudo buscar");
      });
  }, [q, product]);

  useEffect(() => {
    search();
    // búsqueda inicial con los parámetros recibidos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = (g: Group) => {
    const lines = g.uses.map(
      (u) => `• ${u.case_number || u.case_id} · ${u.deceased_name || "Sin nombre"} · ${fmtDateMx(u.used_at || u.date)} · ${u.quantity} ${u.unit === "ml" ? "mL" : u.unit}`,
    );
    const text = [`*Trazabilidad* · ${g.product} · Lote ${g.lot}`, `${g.cases} caso${g.cases === 1 ? "" : "s"}:`, ...lines].join("\n");
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="trace-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Trazabilidad por lote</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text style={styles.hint}>Busca un número de lote o un producto para ver en qué casos se usó.</Text>
        <View style={styles.row}>
          <TextInput
            testID="trace-lot"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={search}
            placeholder="N.º de lote"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
          />
          <TextInput
            testID="trace-product"
            value={product}
            onChangeText={setProduct}
            onSubmitEditing={search}
            placeholder="Producto"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
          />
          <Pressable testID="trace-search" onPress={search} style={styles.searchBtn}>
            <Ionicons name="search" size={20} color={colors.onSurfaceInverse} />
          </Pressable>
        </View>

        {items === null ? (
          <ActivityIndicator color={colors.onSurface} style={{ marginTop: spacing.xl }} />
        ) : items.length === 0 ? (
          <Text testID="trace-empty" style={styles.empty}>{err || "No se encontraron casos con ese lote."}</Text>
        ) : (
          items.map((g) => (
            <View key={`${g.product}|${g.lot}`} testID={`trace-group-${g.lot}`} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{g.product}</Text>
                  <Text style={styles.sub}>Lote {g.lot} · {g.cases} caso{g.cases === 1 ? "" : "s"}</Text>
                </View>
                <Pressable testID={`trace-share-${g.lot}`} onPress={() => share(g)} hitSlop={8} style={styles.icon}>
                  <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
                </Pressable>
              </View>
              {g.uses.map((u, i) => (
                <Pressable
                  key={`${u.case_id}-${i}`}
                  testID={`trace-case-${u.case_id}`}
                  onPress={() => router.push(`/case/${u.case_id}`)}
                  style={({ pressed }) => [styles.use, pressed && { opacity: 0.7 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.useTitle} numberOfLines={1}>
                      {u.case_number || "Caso"} · {u.deceased_name || "Sin nombre"}
                    </Text>
                    <Text style={styles.sub}>
                      {fmtDateMx(u.used_at || u.date)} · {CAT_LABEL[u.category] || "Bitácora"} · {u.quantity} {u.unit === "ml" ? "mL" : u.unit}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          ))
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    backgroundColor: colors.surfaceSecondary,
  },
  searchBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginTop: spacing.lg },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  name: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  use: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  useTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
});
