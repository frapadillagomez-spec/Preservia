import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Supplier = { supplier_id: string; name: string; phone: string; notes?: string };

/** Proveedores con teléfono para pedir fluidos por WhatsApp con un toque. */
export default function Suppliers() {
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const [items, setItems] = useState<Supplier[]>([]);
  const [form, setForm] = useState({ name: "", phone: "52", notes: "" });

  const load = useCallback(() => {
    api.get<{ items: Supplier[] }>("/suppliers").then((r) => setItems(r.items || [])).catch(() => show("No se pudieron cargar", "error"));
  }, [show]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      await api.post("/suppliers", form);
      setForm({ name: "", phone: "52", notes: "" });
      show("Proveedor guardado", "success");
      load();
    } catch (e: any) {
      show(e?.detail || "No se pudo guardar (requiere conexión)", "error");
    }
  };

  const remove = (s: Supplier) => {
    const go = () => api.del(`/suppliers/${s.supplier_id}`).then(load).catch(() => show("No se pudo eliminar", "error"));
    if (Platform.OS === "web") {
      if (window.confirm(`¿Eliminar a ${s.name}?`)) go();
      return;
    }
    Alert.alert("Eliminar proveedor", `¿Eliminar a ${s.name}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: go },
    ]);
  };

  const order = (s: Supplier) =>
    Linking.openURL(`https://wa.me/${s.phone}?text=${encodeURIComponent(`Hola ${s.name}, quisiera hacer un pedido de fluidos:`)}`);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="sup-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Proveedores</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        {items.length === 0 && <Text style={styles.sub}>Aún no tienes proveedores.</Text>}
        {items.map((s) => (
          <View key={s.supplier_id} testID={`sup-${s.supplier_id}`} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.sub}>+{s.phone}{s.notes ? ` · ${s.notes}` : ""}</Text>
            </View>
            <Pressable testID={`sup-wa-${s.supplier_id}`} onPress={() => order(s)} style={styles.icon}>
              <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
            </Pressable>
            <Pressable testID={`sup-del-${s.supplier_id}`} onPress={() => remove(s)} style={styles.icon}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          </View>
        ))}
        <Text style={styles.section}>Agregar proveedor</Text>
        <Field testID="sup-name" label="Nombre" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Ej. Distribuidora Norte" />
        <Field testID="sup-phone" label="WhatsApp (con lada del país)" value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} keyboardType="phone-pad" placeholder="52 55 1234 5678" />
        <Field testID="sup-notes" label="Notas (opcional)" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} placeholder="Productos que maneja" />
        <Button testID="sup-save" label="Guardar proveedor" icon="checkmark" onPress={save} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  section: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base, marginTop: spacing.xl, marginBottom: spacing.sm },
});
