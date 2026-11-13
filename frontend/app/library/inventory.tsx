import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Fluid = { item_id: string; name: string; index_pct: number; bottle_ml?: number; stock_bottles?: number };

const n = (s: string) => parseFloat((s || "").replace(",", "."));

/** Inventario de fluidos arteriales: botellas en existencia por fluido. */
export default function Inventory() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const showToast = toast.show;
  const [items, setItems] = useState<Fluid[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", index: "", bottle: "473", stock: "" });

  const load = useCallback(() => {
    api
      .get<{ items: Fluid[] }>("/fluids")
      .then((r) => setItems(r.items || []))
      .catch((e: any) => {
        setItems((prev) => prev ?? []);
        showToast(e?.detail || "No se pudo cargar el inventario", "error");
      });
  }, [showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (f: Fluid, body: { delta?: number; set?: number }) => {
    try {
      const r = await api.patch<{ item: Fluid }>(`/fluids/${f.item_id}/stock`, body);
      setItems((list) => (list || []).map((x) => (x.item_id === f.item_id ? { ...x, stock_bottles: r.item.stock_bottles } : x)));
      setEdit((e) => ({ ...e, [f.item_id]: "" }));
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo actualizar (requiere conexión)", "error");
    }
  };

  const add = async () => {
    const idx = n(form.index);
    if (!form.name.trim() || !(idx > 0 && idx <= 100)) {
      toast.show("Escribe nombre e Index (0–100 %)", "error");
      return;
    }
    try {
      await api.post("/fluids", {
        name: form.name.trim(),
        index_pct: idx,
        bottle_ml: n(form.bottle) > 0 ? n(form.bottle) : 473,
        stock_bottles: n(form.stock) >= 0 ? n(form.stock) : 0,
      });
      setForm({ name: "", index: "", bottle: "473", stock: "" });
      setAdding(false);
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar (requiere conexión)", "error");
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="inv-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Inventario de fluidos</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text style={styles.hint}>
          Las botellas se descuentan (fracción exacta) al tocar “Confirmar mezcla” en el Reporte del caso.
        </Text>
        {items === null ? (
          <ActivityIndicator color={colors.onSurface} style={{ marginTop: spacing.xl }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Aún no tienes fluidos. Agrega uno abajo.</Text>
        ) : (
          items.map((f) => {
            const stock = f.stock_bottles ?? 0;
            return (
              <View key={f.item_id} testID={`inv-item-${f.item_id}`} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.name}</Text>
                  <Text style={styles.sub}>Index {f.index_pct}% · botella {f.bottle_ml || 473} mL</Text>
                  <Text testID={`inv-stock-${f.item_id}`} style={[styles.stock, stock <= 1 && { color: colors.error }]}>
                    {stock} botella{stock === 1 ? "" : "s"}
                    {stock <= 1 ? " · existencia baja" : ""}
                  </Text>
                </View>
                <View style={styles.controls}>
                  <Pressable testID={`inv-minus-${f.item_id}`} onPress={() => patch(f, { delta: -1 })} style={styles.round}>
                    <Ionicons name="remove" size={20} color={colors.onSurface} />
                  </Pressable>
                  <Pressable testID={`inv-plus-${f.item_id}`} onPress={() => patch(f, { delta: 1 })} style={styles.round}>
                    <Ionicons name="add" size={20} color={colors.onSurface} />
                  </Pressable>
                </View>
                <View style={styles.setRow}>
                  <TextInput
                    testID={`inv-set-input-${f.item_id}`}
                    value={edit[f.item_id] ?? ""}
                    onChangeText={(t) => setEdit((e) => ({ ...e, [f.item_id]: t }))}
                    placeholder="Fijar existencia"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                  <Pressable
                    testID={`inv-set-${f.item_id}`}
                    disabled={!(n(edit[f.item_id] ?? "") >= 0)}
                    onPress={() => patch(f, { set: n(edit[f.item_id] ?? "") })}
                    style={styles.setBtn}
                  >
                    <Text style={styles.setText}>Fijar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {adding ? (
          <View style={styles.addBox}>
            <Field testID="inv-new-name" label="Nombre del arterial" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Ej. Introfiant" />
            <Field testID="inv-new-index" label="Index (%)" value={form.index} onChangeText={(t) => setForm({ ...form, index: t })} keyboardType="decimal-pad" placeholder="Ej. 25" />
            <Field testID="inv-new-bottle" label="Tamaño de botella (mL)" value={form.bottle} onChangeText={(t) => setForm({ ...form, bottle: t })} keyboardType="decimal-pad" />
            <Field testID="inv-new-stock" label="Botellas en existencia" value={form.stock} onChangeText={(t) => setForm({ ...form, stock: t })} keyboardType="decimal-pad" placeholder="Ej. 12" />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button testID="inv-cancel" label="Cancelar" variant="ghost" onPress={() => setAdding(false)} style={{ flex: 1 }} />
              <Button testID="inv-save" label="Guardar" icon="checkmark" onPress={add} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <Button testID="inv-add" label="Agregar fluido" icon="add-circle-outline" variant="outline" onPress={() => setAdding(true)} style={{ marginTop: spacing.md }} />
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
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginVertical: spacing.lg },
  card: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  name: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  stock: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg, marginTop: spacing.xs },
  controls: { flexDirection: "row", gap: spacing.sm },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  setRow: { flexDirection: "row", gap: spacing.sm, width: "100%" },
  input: {
    flex: 1,
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
  setBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceInverse, justifyContent: "center" },
  setText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.sm },
  addBox: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
});
