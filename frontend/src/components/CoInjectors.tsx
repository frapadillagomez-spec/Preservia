import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type CoInjector = { name: string; reason: string; volume_ml: number };
type CatalogItem = CoInjector & { item_id: string };

const OZ_ML = 29.5735;
// Productos de la bitácora que NO cuentan como co-inyectores.
const EXCLUDED = ["dermafix", "biofix", "oncoshield", "leakfix"];

export const toL = (ml: number) => `${(ml / 1000).toFixed(3)} L`;

/** Co-inyectores tomados de la bitácora: líquidos (mL u oz), excepto DermaFix, BioFix, OncoShield y LeakFix. */
export function coinjectorsFromLogbook(
  logbook: { product: string; form: string; quantity: number; unit: string }[],
): CoInjector[] {
  return logbook
    .filter((e) => {
      const key = String(e.product || "").toLowerCase().replace(/[\s\-_]/g, "");
      return (e.unit === "ml" || e.unit === "oz") && e.quantity > 0 && !EXCLUDED.some((x) => key.includes(x));
    })
    .map((e) => ({
      name: e.product,
      reason: "Registrado en bitácora",
      volume_ml: Math.round((e.unit === "oz" ? e.quantity * OZ_ML : e.quantity) * 10) / 10,
    }));
}

type Props = { items: CoInjector[]; onChange: (items: CoInjector[]) => void };

/** Registro de co-inyectores: nombre, razón de uso y volumen (se resta al agua de la bomba). */
export function CoInjectors({ items, onChange }: Props) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [vol, setVol] = useState("");
  const [unit, setUnit] = useState<"ml" | "oz">("ml");
  const [err, setErr] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [saveToCatalog, setSaveToCatalog] = useState(true);
  const [manage, setManage] = useState(false);

  const loadCatalog = useCallback(() => {
    api
      .get<{ items: CatalogItem[] }>("/coinjectors")
      .then((r) => {
        setCatalog(r.items || []);
        if (!r.items?.length) setManage(false);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const add = () => {
    const v = parseFloat(vol.replace(",", "."));
    if (!name.trim()) return setErr("Escribe el nombre del co-inyector");
    if (!reason.trim()) return setErr("Escribe la razón de uso");
    if (isNaN(v) || v <= 0) return setErr("Ingresa un volumen mayor que 0");
    setErr("");
    const item = { name: name.trim(), reason: reason.trim(), volume_ml: Math.round((unit === "oz" ? v * OZ_ML : v) * 10) / 10 };
    onChange([...items, item]);
    if (saveToCatalog) api.post("/coinjectors", item).then(loadCatalog).catch(() => {});
    setName("");
    setReason("");
    setVol("");
  };

  const pick = (c: CatalogItem) => {
    if (manage) {
      api
        .del(`/coinjectors/${c.item_id}`)
        .then(loadCatalog)
        .catch((e: any) => setErr(e?.detail || "No se pudo eliminar del catálogo"));
      return;
    }
    onChange([...items, { name: c.name, reason: c.reason, volume_ml: c.volume_ml }]);
  };

  const total = items.reduce((s, i) => s + i.volume_ml, 0);

  return (
    <View testID="coinjectors" style={styles.box}>
      <Text style={styles.title}>Co-inyectores</Text>
      <Text style={styles.hint}>Se toman de la bitácora del caso (excepto DermaFix, BioFix, OncoShield y LeakFix). Su volumen se resta del volumen total para obtener el agua a agregar en la bomba.</Text>

      {catalog.length > 0 && (
        <View style={{ marginBottom: spacing.md }}>
          <View style={styles.catHead}>
            <Text style={styles.catTitle}>{manage ? "Toca para quitar del catálogo" : "Catálogo · toca para agregar"}</Text>
            <Pressable testID="coinj-manage" onPress={() => setManage((m) => !m)} hitSlop={12} style={styles.manageBtn}>
              <Text style={styles.manageText}>{manage ? "Listo" : "Editar"}</Text>
            </Pressable>
          </View>
          <View style={styles.chips}>
            {catalog.map((c) => (
              <Pressable
                key={c.item_id}
                testID={`coinj-cat-${c.item_id}`}
                onPress={() => pick(c)}
                style={[styles.catChip, manage && styles.catChipManage]}
              >
                <Ionicons name={manage ? "close-circle" : "add-circle-outline"} size={16} color={manage ? colors.error : colors.onSurfaceSecondary} />
                <View>
                  <Text style={styles.catName}>{c.name} · {toL(c.volume_ml)}</Text>
                  {!!c.reason && <Text style={styles.catReason} numberOfLines={1}>{c.reason}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {items.map((c, i) => (
        <View key={`${c.name}-${i}`} testID={`coinj-item-${i}`} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{c.name} · {toL(c.volume_ml)}</Text>
            <Text style={styles.itemReason}>{c.reason}</Text>
          </View>
          <Pressable testID={`coinj-remove-${i}`} onPress={() => onChange(items.filter((_, j) => j !== i))} hitSlop={12} style={styles.remove}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      ))}
      {items.length > 0 && (
        <Text testID="coinj-total" style={styles.total}>Total co-inyectores: {toL(total)}</Text>
      )}

      <Field testID="coinj-name" label="Nombre del co-inyector" value={name} onChangeText={setName} placeholder="Ej. Co-inyector humectante" />
      <Field testID="coinj-reason" label="Razón de uso" value={reason} onChangeText={setReason} placeholder="Ej. Deshidratación" />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field testID="coinj-volume" label={`Volumen (${unit === "ml" ? "mL" : "oz"})`} value={vol} onChangeText={setVol} keyboardType="decimal-pad" placeholder={unit === "ml" ? "Ej. 473" : "Ej. 16"} />
        </View>
        <View style={styles.units}>
          {(["ml", "oz"] as const).map((u) => (
            <Pressable key={u} testID={`coinj-unit-${u}`} onPress={() => setUnit(u)} style={[styles.unit, unit === u && styles.unitActive]}>
              <Text style={[styles.unitText, unit === u && styles.unitTextActive]}>{u === "ml" ? "mL" : "oz"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {!!err && <Text testID="coinj-error" style={styles.err}>{err}</Text>}
      <Pressable testID="coinj-save-catalog" onPress={() => setSaveToCatalog((s) => !s)} style={styles.saveRow}>
        <Ionicons name={saveToCatalog ? "checkbox" : "square-outline"} size={20} color={saveToCatalog ? colors.onSurface : colors.onSurfaceTertiary} />
        <Text style={styles.saveText}>Guardar en mi catálogo de co-inyectores</Text>
      </Pressable>
      <Button testID="coinj-add" label="Agregar co-inyector" variant="outline" icon="add" onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surfaceSecondary },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2, marginBottom: spacing.md, lineHeight: 18 },
  item: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  itemName: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  itemReason: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  total: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.sm, marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  units: { flexDirection: "row", gap: 4, marginBottom: spacing.md },
  unit: { minWidth: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  unitActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  unitText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  unitTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  err: { color: colors.error, fontFamily: font.medium, fontSize: fontSize.sm, marginBottom: spacing.sm },
  catHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  catTitle: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  manageBtn: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  manageText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  chips: { gap: spacing.sm },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  catChipManage: { borderColor: colors.error },
  catName: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  catReason: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  saveRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, marginBottom: spacing.sm },
  saveText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm, flex: 1 },
});
