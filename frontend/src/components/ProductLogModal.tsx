import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { StockFluid } from "@/src/components/LowStockBanner";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type LogCategory = "bitacora" | "cavidad" | "topico" | "putrefacto";
export type LogEntry = {
  log_id: string;
  product: string;
  form: string;
  quantity: number;
  unit: string;
  category?: LogCategory;
  lot?: string;
  source?: string;
};
type Fluid = StockFluid & { kind?: string; unit?: string; lots?: { lot_id: string; lot: string; stock: number }[] };

const FORMS: Record<LogCategory, { key: string; label: string; units: string[] }[]> = {
  bitacora: [
    { key: "liquid", label: "Líquido", units: ["oz", "ml"] },
    { key: "powder", label: "Polvo", units: ["g"] },
  ],
  cavidad: [{ key: "liquid", label: "Líquido", units: ["oz", "ml"] }],
  topico: [
    { key: "powder", label: "Polvo", units: ["g"] },
    { key: "gel", label: "Gel", units: ["g"] },
    { key: "cream", label: "Crema", units: ["g"] },
  ],
  putrefacto: [{ key: "liquid", label: "Líquido", units: ["oz", "ml"] }],
};
const KIND_FOR: Record<LogCategory, string[]> = {
  bitacora: ["arterial", "coinyector", "otro"],
  cavidad: ["cavidad"],
  topico: ["topico"],
  putrefacto: ["putrefacto"],
};
export const CAT_LABEL: Record<LogCategory, string> = {
  bitacora: "Bitácora",
  cavidad: "Cavidad",
  topico: "Tópico",
  putrefacto: "Putrefacto / gas",
};
export const FORM_LABEL: Record<string, string> = { liquid: "Líquido", powder: "Polvo", gel: "Gel", cream: "Crema" };
const UNIT_LABEL: Record<string, string> = { oz: "Onzas (oz)", ml: "Mililitros (mL)", g: "Gramos (g)" };

/** Registro de producto usado (bitácora, cavidad, tópico, putrefacto) con lote del inventario. */
export function ProductLogModal({
  visible,
  caseId,
  categories,
  fichas,
  onClose,
  onSaved,
}: {
  visible: boolean;
  caseId: string;
  categories: LogCategory[];
  fichas: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [cat, setCat] = useState<LogCategory>(categories[0]);
  const [product, setProduct] = useState("");
  const [fluidId, setFluidId] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string | null>(null);
  const [lot, setLot] = useState("");
  const [form, setForm] = useState(FORMS[categories[0]][0].key);
  const [unit, setUnit] = useState(FORMS[categories[0]][0].units[0]);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [fluids, setFluids] = useState<Fluid[]>([]);

  useEffect(() => {
    if (!visible) return;
    setCat(categories[0]);
    setProduct("");
    setFluidId(null);
    setLotId(null);
    setLot("");
    setForm(FORMS[categories[0]][0].key);
    setUnit(FORMS[categories[0]][0].units[0]);
    setQty("");
    api.get<{ items: Fluid[] }>("/fluids").then((r) => setFluids(r.items || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pickCat = (c: LogCategory) => {
    setCat(c);
    setForm(FORMS[c][0].key);
    setUnit(FORMS[c][0].units[0]);
    setFluidId(null);
    setLotId(null);
  };
  const inv = useMemo(() => fluids.filter((f) => KIND_FOR[cat].includes(f.kind || "arterial")), [fluids, cat]);
  const chosen = fluids.find((f) => f.item_id === fluidId);
  const formDef = FORMS[cat].find((f) => f.key === form) || FORMS[cat][0];
  const q = parseFloat(qty.replace(",", "."));

  const save = async () => {
    if (!product.trim()) return toast.show("Selecciona o escribe un producto", "error");
    if (!(q > 0)) return toast.show("Ingresa una cantidad válida", "error");
    if (!lot.trim()) return toast.show("Ingresa el número de lote", "error");
    setSaving(true);
    try {
      await api.post(`/cases/${caseId}/logbook`, {
        product: product.trim(),
        form,
        quantity: q,
        unit,
        category: cat,
        lot: lot.trim(),
        fluid_id: fluidId,
        lot_id: lotId,
      });
      toast.show("Producto registrado", "success");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo registrar el producto", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !saving && onClose()}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Registrar producto · {CAT_LABEL[cat]}</Text>
            {categories.length > 1 && (
              <View style={styles.chips}>
                {categories.map((c) => (
                  <Chip key={c} testID={`log-cat-${c}`} label={CAT_LABEL[c]} on={cat === c} onPress={() => pickCat(c)} />
                ))}
              </View>
            )}

            <Text style={styles.sub}>Producto</Text>
            <TextInput
              testID="log-product-input"
              value={product}
              onChangeText={(t) => {
                setProduct(t);
                setFluidId(null);
                setLotId(null);
              }}
              placeholder="Escribe o elige del inventario"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
            />
            {(inv.length > 0 || fichas.length > 0) && (
              <ScrollView style={{ maxHeight: 110 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                <View style={styles.chips}>
                  {inv.map((f) => (
                    <Chip
                      key={f.item_id}
                      testID={`log-inv-${f.item_id}`}
                      icon="cube-outline"
                      label={f.name}
                      on={fluidId === f.item_id}
                      onPress={() => {
                        setProduct(f.name);
                        setFluidId(f.item_id);
                        const first = (f.lots || []).find((l) => l.stock > 0) || (f.lots || [])[0];
                        setLotId(first?.lot_id ?? null);
                        setLot(first?.lot ?? "");
                      }}
                    />
                  ))}
                  {fichas.map((p) => (
                    <Chip key={p} testID={`log-prod-${p}`} label={p} on={!fluidId && product === p} onPress={() => { setProduct(p); setFluidId(null); setLotId(null); }} />
                  ))}
                </View>
              </ScrollView>
            )}

            <Text style={styles.sub}>Número de lote</Text>
            {!!chosen?.lots?.length && (
              <View style={styles.chips}>
                {chosen.lots.map((l) => (
                  <Chip
                    key={l.lot_id}
                    testID={`log-lot-${l.lot_id}`}
                    label={`${l.lot} · ${l.stock}`}
                    on={lotId === l.lot_id}
                    onPress={() => {
                      setLotId(l.lot_id);
                      setLot(l.lot);
                    }}
                  />
                ))}
              </View>
            )}
            <TextInput
              testID="log-lot-input"
              value={lot}
              onChangeText={(t) => {
                setLot(t);
                setLotId(null);
              }}
              placeholder="Ej. A-2311"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
            />
            {!!fluidId && <Text style={styles.hint}>Se descontará del inventario de este lote.</Text>}

            {FORMS[cat].length > 1 && (
              <>
                <Text style={styles.sub}>Tipo</Text>
                <View style={styles.chips}>
                  {FORMS[cat].map((f) => (
                    <Chip key={f.key} testID={`log-form-${f.key}`} label={f.label} on={form === f.key} onPress={() => { setForm(f.key); setUnit(f.units[0]); }} />
                  ))}
                </View>
              </>
            )}
            <Text style={styles.sub}>Unidad</Text>
            <View style={styles.chips}>
              {formDef.units.map((u) => (
                <Chip key={u} testID={`log-unit-${u}`} label={UNIT_LABEL[u]} on={unit === u} onPress={() => setUnit(u)} />
              ))}
            </View>

            <Text style={styles.sub}>Cantidad</Text>
            <TextInput
              testID="log-qty-input"
              value={qty}
              onChangeText={setQty}
              placeholder="Ej. 16"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            {unit === "oz" && q > 0 && (
              <View testID="log-oz-ml" style={styles.ozRow}>
                <Text style={styles.hint}>{qty} oz ≈ {(q * 29.5735).toFixed(1)} mL</Text>
                <Pressable testID="log-use-ml" onPress={() => { setQty((q * 29.5735).toFixed(1)); setUnit("ml"); }} style={styles.ozBtn}>
                  <Text style={styles.ozBtnText}>Guardar en mL</Text>
                </Pressable>
              </View>
            )}
            <Button testID="log-save-button" label="Guardar" onPress={save} loading={saving} style={{ marginTop: spacing.lg }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chip({ label, on, onPress, testID, icon }: { label: string; on: boolean; onPress: () => void; testID?: string; icon?: any }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      {icon && <Ionicons name={icon} size={14} color={on ? colors.onSurfaceInverse : colors.onSurfaceSecondary} />}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, maxHeight: "90%", maxWidth: 480, width: "100%", alignSelf: "center" },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.lg, marginBottom: spacing.sm },
  sub: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, flex: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.xs,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextOn: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  ozRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  ozBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  ozBtnText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
});
