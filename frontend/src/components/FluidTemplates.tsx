import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Fluid = { item_id: string; name: string; index_pct: number; bottle_ml?: number };

/** Plantillas de fluidos arteriales: elegir el índice C1 (y tamaño de botella) con un toque o guardar el actual. */
export function FluidTemplates({
  c1,
  bottleMl,
  onPick,
}: {
  c1: string;
  bottleMl: string;
  onPick: (index: string, name: string, bottleMl: string) => void;
}) {
  const [items, setItems] = useState<Fluid[]>([]);
  const [manage, setManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api
      .get<{ items: Fluid[] }>("/fluids")
      .then((r) => {
        setItems((r.items || []).filter((f: any) => !f.kind || f.kind === "arterial"));
        if (!r.items?.length) setManage(false);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const idx = parseFloat(c1.replace(",", "."));
    if (!name.trim()) return setErr("Escribe el nombre del fluido");
    if (!(idx > 0 && idx <= 100)) return setErr("Primero escribe un índice C1 válido");
    const bottle = parseFloat((bottleMl || "").replace(",", "."));
    try {
      await api.post("/fluids", { name: name.trim(), index_pct: idx, bottle_ml: bottle > 0 ? bottle : 473 });
      setName("");
      setErr("");
      setSaving(false);
      load();
    } catch (e: any) {
      setErr(e?.detail || "No se pudo guardar (requiere conexión)");
    }
  };

  return (
    <View testID="fluid-templates" style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Mis fluidos arteriales</Text>
        {items.length > 0 && (
          <Pressable testID="fluid-manage" onPress={() => setManage((m) => !m)} hitSlop={12} style={styles.link}>
            <Text style={styles.linkText}>{manage ? "Listo" : "Editar"}</Text>
          </Pressable>
        )}
      </View>
      {items.length === 0 && <Text style={styles.hint}>Guarda tus fluidos con su índice para elegirlos con un toque.</Text>}
      <View style={styles.chips}>
        {items.map((f) => (
          <Pressable
            key={f.item_id}
            testID={`fluid-${f.item_id}`}
            onPress={() => (manage ? api.del(`/fluids/${f.item_id}`).then(load).catch(() => setErr("No se pudo eliminar")) : onPick(String(f.index_pct), f.name, String(f.bottle_ml || 473)))}
            style={[styles.chip, manage && styles.chipManage]}
          >
            <Ionicons name={manage ? "close-circle" : "flask-outline"} size={16} color={manage ? colors.error : colors.onSurfaceSecondary} />
            <Text style={styles.chipText}>{f.name} · {f.index_pct}% · {f.bottle_ml || 473} mL</Text>
          </Pressable>
        ))}
      </View>
      {saving ? (
        <View>
          <Field testID="fluid-name" label={`Nombre del fluido (C1 ${c1 || "—"}% · botella ${bottleMl || 473} mL)`} value={name} onChangeText={setName} placeholder="Ej. Arterial 25 índice" />
          {!!err && <Text testID="fluid-error" style={styles.err}>{err}</Text>}
          <View style={styles.row}>
            <Button testID="fluid-cancel" label="Cancelar" variant="ghost" onPress={() => { setSaving(false); setErr(""); }} style={{ flex: 1 }} />
            <Button testID="fluid-save" label="Guardar" icon="checkmark" onPress={save} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Pressable testID="fluid-save-open" onPress={() => setSaving(true)} style={styles.addRow}>
          <Ionicons name="add-circle-outline" size={18} color={colors.onSurface} />
          <Text style={styles.linkText}>Guardar el C1 actual como plantilla</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surfaceSecondary },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.xs },
  link: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  linkText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipManage: { borderColor: colors.error },
  chipText: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.sm },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, marginTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  err: { color: colors.error, fontFamily: font.medium, fontSize: fontSize.sm, marginBottom: spacing.sm },
});
