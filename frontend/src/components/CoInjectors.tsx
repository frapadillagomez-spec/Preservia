import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type CoInjector = { name: string; reason: string; volume_ml: number };

const OZ_ML = 29.5735;

type Props = { items: CoInjector[]; onChange: (items: CoInjector[]) => void };

/** Registro de co-inyectores: nombre, razón de uso y volumen (se resta al agua de la bomba). */
export function CoInjectors({ items, onChange }: Props) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [vol, setVol] = useState("");
  const [unit, setUnit] = useState<"ml" | "oz">("ml");
  const [err, setErr] = useState("");

  const add = () => {
    const v = parseFloat(vol.replace(",", "."));
    if (!name.trim()) return setErr("Escribe el nombre del co-inyector");
    if (!reason.trim()) return setErr("Escribe la razón de uso");
    if (isNaN(v) || v <= 0) return setErr("Ingresa un volumen mayor que 0");
    setErr("");
    onChange([...items, { name: name.trim(), reason: reason.trim(), volume_ml: Math.round((unit === "oz" ? v * OZ_ML : v) * 10) / 10 }]);
    setName("");
    setReason("");
    setVol("");
  };

  const total = items.reduce((s, i) => s + i.volume_ml, 0);

  return (
    <View testID="coinjectors" style={styles.box}>
      <Text style={styles.title}>Co-inyectores</Text>
      <Text style={styles.hint}>Su volumen se resta del volumen total para obtener el agua a agregar en la bomba.</Text>

      {items.map((c, i) => (
        <View key={`${c.name}-${i}`} testID={`coinj-item-${i}`} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{c.name} · {c.volume_ml} mL</Text>
            <Text style={styles.itemReason}>{c.reason}</Text>
          </View>
          <Pressable testID={`coinj-remove-${i}`} onPress={() => onChange(items.filter((_, j) => j !== i))} hitSlop={12} style={styles.remove}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      ))}
      {items.length > 0 && (
        <Text testID="coinj-total" style={styles.total}>Total co-inyectores: {Math.round(total)} mL</Text>
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
});
