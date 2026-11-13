import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { mxn } from "@/src/components/CaseCost";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Price = { item_id: string; name: string; price: number; size: number; unit: "ml" | "oz" | "g"; category: string };

const CATS = [
  { key: "coinyector", label: "Co-inyector" },
  { key: "cavidad", label: "Cavidad" },
  { key: "otro", label: "Otro" },
];
const UNITS = [
  { key: "ml", label: "mL" },
  { key: "oz", label: "oz" },
  { key: "g", label: "g" },
];
const n = (s: string) => parseFloat((s || "").replace(",", "."));

/** Precios de productos de la Bitácora (co-inyectores, cavidades y otros) para el costo por caso. */
export default function Prices() {
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const [items, setItems] = useState<Price[] | null>(null);
  const [form, setForm] = useState({ name: "", price: "", size: "", unit: "oz", category: "coinyector" });

  const load = useCallback(() => {
    api
      .get<{ items: Price[] }>("/prices")
      .then((r) => setItems(r.items || []))
      .catch((e: any) => {
        setItems((p) => p ?? []);
        show(e?.detail || "No se pudieron cargar los precios", "error");
      });
  }, [show]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.name.trim() || !(n(form.price) >= 0) || !(n(form.size) > 0)) {
      show("Escribe nombre, precio y presentación", "error");
      return;
    }
    try {
      await api.post("/prices", { name: form.name.trim(), price: n(form.price), size: n(form.size), unit: form.unit, category: form.category });
      setForm({ ...form, name: "", price: "", size: "" });
      show("Precio guardado", "success");
      load();
    } catch (e: any) {
      show(e?.detail || "No se pudo guardar (requiere conexión)", "error");
    }
  };

  const remove = (p: Price) =>
    api.del(`/prices/${p.item_id}`).then(load).catch(() => show("No se pudo eliminar", "error"));

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="prices-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Precios de productos</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text style={styles.hint}>
          Precio en MXN por presentación. Se usa con lo registrado en la Bitácora (mismo nombre del producto). El precio del arterial se pone en Inventario.
        </Text>
        {items === null ? (
          <ActivityIndicator color={colors.onSurface} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Aún no hay precios.</Text>
        ) : (
          items.map((p) => (
            <View key={p.item_id} testID={`price-item-${p.item_id}`} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.sub}>
                  {CATS.find((c) => c.key === p.category)?.label} · {mxn(p.price)} por {p.size} {p.unit === "ml" ? "mL" : p.unit}
                </Text>
              </View>
              <Pressable testID={`price-del-${p.item_id}`} onPress={() => remove(p)} hitSlop={10} style={styles.del}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}

        <Text style={styles.section}>Agregar o actualizar precio</Text>
        <Field testID="price-name" label="Producto (igual que en la Bitácora)" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Ej. Icteroclean" />
        <Text style={styles.label}>Tipo</Text>
        <View style={styles.chips}>
          {CATS.map((c) => (
            <Pressable key={c.key} testID={`price-cat-${c.key}`} onPress={() => setForm({ ...form, category: c.key })} style={[styles.chip, form.category === c.key && styles.chipOn]}>
              <Text style={[styles.chipText, form.category === c.key && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <Field testID="price-price" label="Precio (MXN)" value={form.price} onChangeText={(t) => setForm({ ...form, price: t })} keyboardType="decimal-pad" placeholder="Ej. 350" />
        <Field testID="price-size" label="Presentación (cantidad)" value={form.size} onChangeText={(t) => setForm({ ...form, size: t })} keyboardType="decimal-pad" placeholder="Ej. 16" />
        <View style={styles.chips}>
          {UNITS.map((u) => (
            <Pressable key={u.key} testID={`price-unit-${u.key}`} onPress={() => setForm({ ...form, unit: u.key })} style={[styles.chip, form.unit === u.key && styles.chipOn]}>
              <Text style={[styles.chipText, form.unit === u.key && styles.chipTextOn]}>{u.label}</Text>
            </Pressable>
          ))}
        </View>
        <Button testID="price-save" label="Guardar precio" icon="checkmark" onPress={save} style={{ marginTop: spacing.md }} />
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
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  del: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  section: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base, marginTop: spacing.xl, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextOn: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
});
