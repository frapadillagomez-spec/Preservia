import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { ComponentProps } from "react";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Unit = { key: string; label: string; factor?: number };
type Category = { key: string; label: string; icon: ComponentProps<typeof Ionicons>["name"]; units: Unit[] };

// factor = cuántas unidades base hay en 1 unidad (base: g, mL, kPa, m, mL/min, s). Temperatura aparte.
const CATEGORIES: Category[] = [
  {
    key: "mass", label: "Masa", icon: "barbell-outline",
    units: [
      { key: "mg", label: "mg", factor: 0.001 },
      { key: "g", label: "g", factor: 1 },
      { key: "kg", label: "kg", factor: 1000 },
      { key: "oz", label: "oz", factor: 28.349523125 },
      { key: "lb", label: "lb", factor: 453.59237 },
    ],
  },
  {
    key: "volume", label: "Volumen", icon: "flask-outline",
    units: [
      { key: "ml", label: "mL", factor: 1 },
      { key: "cc", label: "cm³ (cc)", factor: 1 },
      { key: "l", label: "L", factor: 1000 },
      { key: "floz", label: "oz fl (US)", factor: 29.5735295625 },
      { key: "pt", label: "pinta (US)", factor: 473.176473 },
      { key: "qt", label: "cuarto (US)", factor: 946.352946 },
      { key: "gal", label: "galón (US)", factor: 3785.411784 },
    ],
  },
  {
    key: "pressure", label: "Presión", icon: "speedometer-outline",
    units: [
      { key: "psi", label: "psi", factor: 6.894757293 },
      { key: "kpa", label: "kPa", factor: 1 },
      { key: "bar", label: "bar", factor: 100 },
      { key: "mmhg", label: "mmHg", factor: 0.1333223684 },
      { key: "cmh2o", label: "cmH₂O", factor: 0.0980665 },
      { key: "atm", label: "atm", factor: 101.325 },
    ],
  },
  {
    key: "length", label: "Longitud", icon: "resize-outline",
    units: [
      { key: "mm", label: "mm", factor: 0.001 },
      { key: "cm", label: "cm", factor: 0.01 },
      { key: "m", label: "m", factor: 1 },
      { key: "in", label: "pulgada", factor: 0.0254 },
      { key: "ft", label: "pie", factor: 0.3048 },
    ],
  },
  {
    key: "flow", label: "Caudal", icon: "water-outline",
    units: [
      { key: "mlmin", label: "mL/min", factor: 1 },
      { key: "lmin", label: "L/min", factor: 1000 },
      { key: "lh", label: "L/h", factor: 1000 / 60 },
      { key: "ozmin", label: "oz fl/min", factor: 29.5735295625 },
      { key: "galmin", label: "gal/min", factor: 3785.411784 },
      { key: "galh", label: "gal/h", factor: 3785.411784 / 60 },
    ],
  },
  {
    key: "temp", label: "Temperatura", icon: "thermometer-outline",
    units: [
      { key: "c", label: "°C" },
      { key: "f", label: "°F" },
      { key: "k", label: "K" },
    ],
  },
  {
    key: "time", label: "Tiempo", icon: "time-outline",
    units: [
      { key: "s", label: "segundo", factor: 1 },
      { key: "min", label: "minuto", factor: 60 },
      { key: "h", label: "hora", factor: 3600 },
      { key: "d", label: "día", factor: 86400 },
    ],
  },
];

const toCelsius = (v: number, u: string) => (u === "f" ? ((v - 32) * 5) / 9 : u === "k" ? v - 273.15 : v);
const fromCelsius = (c: number, u: string) => (u === "f" ? (c * 9) / 5 + 32 : u === "k" ? c + 273.15 : c);

function convert(cat: Category, v: number, from: string, to: string) {
  if (cat.key === "temp") return fromCelsius(toCelsius(v, from), to);
  const f = cat.units.find((u) => u.key === from)!.factor!;
  const t = cat.units.find((u) => u.key === to)!.factor!;
  return (v * f) / t;
}

function fmt(n: number) {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.001 || a >= 1e9)) return n.toExponential(3);
  return n.toLocaleString("es-MX", { maximumFractionDigits: a < 1 ? 4 : 3 });
}

export default function Converter() {
  const insets = useSafeAreaInsets();
  const [catKey, setCatKey] = useState(CATEGORIES[0].key);
  const cat = CATEGORIES.find((c) => c.key === catKey)!;
  const [from, setFrom] = useState(cat.units[0].key);
  const [value, setValue] = useState("1");

  const pickCat = (c: Category) => {
    setCatKey(c.key);
    setFrom(c.units[0].key);
  };

  const v = parseFloat(value.replace(",", "."));
  const rows = useMemo(
    () => (isNaN(v) ? [] : cat.units.filter((u) => u.key !== from).map((u) => ({ u, r: convert(cat, v, from, u.key) }))),
    [cat, v, from],
  );
  const fromLabel = cat.units.find((u) => u.key === from)?.label;

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="conv-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Conversor de unidades</Text>
        <View style={{ width: 26 }} />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              testID={`conv-cat-${c.key}`}
              onPress={() => pickCat(c)}
              style={[styles.chip, catKey === c.key && styles.chipActive]}
            >
              <Ionicons name={c.icon} size={16} color={catKey === c.key ? colors.onSurfaceInverse : colors.onSurfaceSecondary} />
              <Text style={[styles.chipText, catKey === c.key && styles.chipTextActive]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Field
          testID="conv-value"
          label={`Valor (${fromLabel})`}
          value={value}
          onChangeText={setValue}
          keyboardType={cat.key === "temp" ? "numbers-and-punctuation" : "decimal-pad"}
          placeholder="Ej. 1"
        />
        <Text style={styles.label}>Convertir de</Text>
        <View style={styles.unitRow}>
          {cat.units.map((u) => (
            <Pressable
              key={u.key}
              testID={`conv-from-${u.key}`}
              onPress={() => setFrom(u.key)}
              style={[styles.unit, from === u.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, from === u.key && styles.chipTextActive]}>{u.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Equivalencias</Text>
        {rows.length === 0 ? (
          <Text style={styles.empty}>Escribe un número para ver las equivalencias.</Text>
        ) : (
          rows.map(({ u, r }) => (
            <View key={u.key} testID={`conv-result-${u.key}`} style={styles.resultRow}>
              <Text style={styles.resultUnit}>{u.label}</Text>
              <Text style={styles.resultNum} selectable>{fmt(r)}</Text>
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
  catRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.sm },
  unitRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  unit: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  resultUnit: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base },
  resultNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg },
});
