import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { mxn } from "@/src/components/CaseCost";
import { isLow, minStock, StockFluid } from "@/src/components/LowStockBanner";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { fmtDateMx } from "@/src/utils/mxtime";

type Fluid = StockFluid & { kind?: string; unit?: string; lots?: { lot_id: string; lot: string; stock: number }[] };
type Supplier = { supplier_id: string; name: string; phone: string };
const KINDS = [
  { key: "arterial", label: "Arterial" },
  { key: "coinyector", label: "Co-inyector" },
  { key: "cavidad", label: "Cavidad" },
  { key: "topico", label: "Tópico" },
  { key: "putrefacto", label: "Putrefacto / gas" },
  { key: "otro", label: "Otro" },
];
const EMPTY_FORM = { name: "", index: "", bottle: "473", stock: "", lot: "", kind: "arterial" };
type Purchase = { purchase_id: string; fluid_name: string; bottles: number; total: number; unit_price: number; supplier?: string; lot?: string; date: string };

const n = (s: string) => parseFloat((s || "").replace(",", "."));

/** Inventario de fluidos arteriales: botellas en existencia por fluido. */
export default function Inventory() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const showToast = toast.show;
  const [items, setItems] = useState<Fluid[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [cfg, setCfg] = useState<Record<string, { min: string; price: string }>>({});
  const [openCfg, setOpenCfg] = useState<string | null>(null);
  const [shopping, setShopping] = useState(false);
  const [order, setOrder] = useState<Record<string, string>>({});
  const [buyFor, setBuyFor] = useState<string | null>(null);
  const [buy, setBuy] = useState({ bottles: "", total: "", supplier: "", lot: "" });
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orderTo, setOrderTo] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.get<{ items: Supplier[] }>("/suppliers").then((r) => setSuppliers(r.items || [])).catch(() => {});
    }, []),
  );

  const loadPurchases = useCallback(() => {
    api.get<{ items: Purchase[] }>("/purchases").then((r) => setPurchases(r.items || [])).catch(() => {});
  }, []);
  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  const savePurchase = async (f: Fluid) => {
    if (!(n(buy.bottles) > 0) || !(n(buy.total) >= 0)) {
      showToast("Escribe botellas y total pagado", "error");
      return;
    }
    try {
      const r = await api.post<{ stock: number; price_per_bottle: number }>("/purchases", {
        fluid_id: f.item_id,
        bottles: n(buy.bottles),
        total: n(buy.total),
        supplier: buy.supplier.trim(),
        lot: buy.lot.trim(),
      });
      setItems((list) => (list || []).map((x) => (x.item_id === f.item_id ? { ...x, stock_bottles: r.stock, price_per_bottle: r.price_per_bottle } : x)));
      setBuy({ bottles: "", total: "", supplier: "", lot: "" });
      setBuyFor(null);
      loadPurchases();
      showToast(`Compra registrada: ahora ${r.stock} botellas a ${mxn(r.price_per_bottle)} c/u`, "success");
    } catch (e: any) {
      showToast(e?.detail || "No se pudo registrar (requiere conexión)", "error");
    }
  };

  const removePurchase = (p: Purchase) => {
    const msg = `¿Eliminar la compra de ${p.bottles} botellas de ${p.fluid_name}? Se restarán del inventario.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doRemovePurchase(p);
      return;
    }
    Alert.alert("Eliminar compra", msg, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => doRemovePurchase(p) },
    ]);
  };

  const doRemovePurchase = async (p: Purchase) => {
    try {
      await api.del(`/purchases/${p.purchase_id}`);
      loadPurchases();
      load();
    } catch (e: any) {
      showToast(e?.detail || "No se pudo eliminar", "error");
    }
  };

  const saveCfg = async (f: Fluid) => {
    const c = cfg[f.item_id] || { min: "", price: "" };
    try {
      const r = await api.patch<{ item: Fluid }>(`/fluids/${f.item_id}`, {
        min_stock: c.min === "" ? undefined : n(c.min),
        price_per_bottle: c.price === "" ? undefined : n(c.price),
      });
      setItems((list) => (list || []).map((x) => (x.item_id === f.item_id ? { ...x, ...r.item } : x)));
      setOpenCfg(null);
      showToast("Ajustes guardados", "success");
    } catch (e: any) {
      showToast(e?.detail || "No se pudo guardar (requiere conexión)", "error");
    }
  };

  const sendOrder = () => {
    const lines = (items || [])
      .filter((f) => n(order[f.item_id] ?? "") > 0)
      .map((f) => `• ${f.name}${(f.kind || "arterial") === "arterial" ? ` (Index ${f.index_pct}%` : " ("}${(f.kind || "arterial") === "arterial" ? ", " : ""}${f.bottle_ml || 473} ${f.unit === "g" ? "g" : "mL"}): ${n(order[f.item_id])} envase${n(order[f.item_id]) === 1 ? "" : "s"}`);
    if (lines.length === 0) {
      showToast("Escribe cuántas botellas pedir de al menos un fluido", "error");
      return;
    }
    const phone = suppliers.find((s) => s.supplier_id === orderTo)?.phone || "";
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(["*Pedido de fluidos*", ...lines].join("\n"))}`);
  };

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

  const patchLot = async (f: Fluid, lotId: string, delta: number) => {
    try {
      await api.patch(`/fluids/${f.item_id}/lots/${lotId}`, { delta });
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo actualizar (requiere conexión)", "error");
    }
  };

  const addLot = async (f: Fluid) => {
    const lot = (edit[f.item_id] ?? "").trim();
    const stock = n(edit[`${f.item_id}_s`] ?? "") || 0;
    if (!lot) return toast.show("Escribe el número de lote", "error");
    try {
      await api.post(`/fluids/${f.item_id}/lots`, { lot, stock });
      setEdit((e) => ({ ...e, [f.item_id]: "", [`${f.item_id}_s`]: "" }));
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo agregar el lote", "error");
    }
  };

  const add = async () => {
    const idx = n(form.index);
    if (!form.name.trim() || (form.kind === "arterial" && !(idx > 0 && idx <= 100))) {
      toast.show(form.kind === "arterial" ? "Escribe nombre e Index (0–100 %)" : "Escribe el nombre", "error");
      return;
    }
    if (n(form.stock) > 0 && !form.lot.trim()) {
      toast.show("Escribe el número de lote de la existencia", "error");
      return;
    }
    try {
      await api.post("/fluids", {
        name: form.name.trim(),
        kind: form.kind,
        unit: form.kind === "topico" ? "g" : "ml",
        index_pct: form.kind === "arterial" ? idx : 0,
        bottle_ml: n(form.bottle) > 0 ? n(form.bottle) : 473,
        stock_bottles: n(form.stock) >= 0 ? n(form.stock) : 0,
        lot: form.lot.trim() || "Sin lote",
      });
      setForm({ ...EMPTY_FORM });
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
          Las botellas se descuentan (fracción exacta) al tocar “Confirmar mezcla” en el Reporte del caso. Verás un aviso en Inicio cuando un fluido llegue a su mínimo (2 si no lo cambias).
        </Text>
        {items === null ? (
          <ActivityIndicator color={colors.onSurface} style={{ marginTop: spacing.xl }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Aún no tienes fluidos. Agrega uno abajo.</Text>
        ) : (
          items.map((f) => {
            const stock = f.stock_bottles ?? 0;
            const low = isLow(f);
            return (
              <View key={f.item_id} testID={`inv-item-${f.item_id}`} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.name}</Text>
                  <Text style={styles.sub}>
                    {KINDS.find((k) => k.key === (f.kind || "arterial"))?.label}
                    {(f.kind || "arterial") === "arterial" ? ` · Index ${f.index_pct}%` : ""} · envase {f.bottle_ml || 473} {f.unit === "g" ? "g" : "mL"} · mínimo {minStock(f)}
                    {f.price_per_bottle !== undefined ? ` · ${mxn(f.price_per_bottle)}/botella` : ""}
                  </Text>
                  <Text testID={`inv-stock-${f.item_id}`} style={[styles.stock, low && { color: colors.error }]}>
                    {stock} botella{stock === 1 ? "" : "s"}
                    {low ? " · por agotarse" : ""}
                  </Text>
                </View>
                <View style={styles.lotsBox}>
                  {(f.lots || []).map((l) => (
                    <View key={l.lot_id} testID={`inv-lot-${l.lot_id}`} style={styles.lotRow}>
                      <Pressable
                        testID={`inv-lot-trace-${l.lot_id}`}
                        onPress={() => router.push(`/library/traceability?lot=${encodeURIComponent(l.lot)}&product=${encodeURIComponent(f.name)}`)}
                        style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                      >
                        <Text style={[styles.orderName, { textDecorationLine: "underline" }]} numberOfLines={1}>Lote {l.lot}</Text>
                      </Pressable>
                      <Text style={styles.lotStock}>{l.stock}</Text>
                      <Pressable testID={`inv-lot-minus-${l.lot_id}`} onPress={() => patchLot(f, l.lot_id, -1)} style={styles.round}>
                        <Ionicons name="remove" size={18} color={colors.onSurface} />
                      </Pressable>
                      <Pressable testID={`inv-lot-plus-${l.lot_id}`} onPress={() => patchLot(f, l.lot_id, 1)} style={styles.round}>
                        <Ionicons name="add" size={18} color={colors.onSurface} />
                      </Pressable>
                    </View>
                  ))}
                  <View style={styles.setRow}>
                    <TextInput
                      testID={`inv-newlot-${f.item_id}`}
                      value={edit[f.item_id] ?? ""}
                      onChangeText={(t) => setEdit((e) => ({ ...e, [f.item_id]: t }))}
                      placeholder="N.º de lote nuevo"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      style={styles.input}
                    />
                    <TextInput
                      testID={`inv-newlot-stock-${f.item_id}`}
                      value={edit[`${f.item_id}_s`] ?? ""}
                      onChangeText={(t) => setEdit((e) => ({ ...e, [`${f.item_id}_s`]: t }))}
                      placeholder="Envases"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="decimal-pad"
                      style={[styles.input, { flexGrow: 0, flexShrink: 0, width: 90 }]}
                    />
                    <Pressable testID={`inv-newlot-save-${f.item_id}`} onPress={() => addLot(f)} style={styles.setBtn}>
                      <Text style={styles.setText}>Agregar</Text>
                    </Pressable>
                  </View>
                </View>
                {openCfg === f.item_id ? (
                  <View style={styles.cfgBox}>
                    <View style={styles.setRow}>
                      <TextInput
                        testID={`inv-min-${f.item_id}`}
                        value={cfg[f.item_id]?.min ?? String(minStock(f))}
                        onChangeText={(t) => setCfg((c) => ({ ...c, [f.item_id]: { min: t, price: c[f.item_id]?.price ?? String(f.price_per_bottle ?? "") } }))}
                        placeholder="Mínimo"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        keyboardType="decimal-pad"
                        style={styles.input}
                      />
                      <TextInput
                        testID={`inv-price-${f.item_id}`}
                        value={cfg[f.item_id]?.price ?? String(f.price_per_bottle ?? "")}
                        onChangeText={(t) => setCfg((c) => ({ ...c, [f.item_id]: { min: c[f.item_id]?.min ?? String(minStock(f)), price: t } }))}
                        placeholder="Precio/botella MXN"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        keyboardType="decimal-pad"
                        style={styles.input}
                      />
                    </View>
                    <Text style={styles.sub}>Mínimo de botellas para avisar · precio por botella (MXN)</Text>
                    <Button testID={`inv-cfg-save-${f.item_id}`} label="Guardar ajustes" onPress={() => saveCfg(f)} style={{ marginTop: spacing.sm }} />
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: spacing.lg }}>
                    <Pressable testID={`inv-cfg-${f.item_id}`} onPress={() => setOpenCfg(f.item_id)} style={styles.cfgLink}>
                      <Ionicons name="settings-outline" size={16} color={colors.onSurface} />
                      <Text style={styles.cfgText}>Mínimo y precio</Text>
                    </Pressable>
                    <Pressable testID={`inv-buy-${f.item_id}`} onPress={() => { setBuy({ bottles: "", total: "", supplier: "", lot: "" }); setBuyFor(buyFor === f.item_id ? null : f.item_id); }} style={styles.cfgLink}>
                      <Ionicons name="bag-add-outline" size={16} color={colors.onSurface} />
                      <Text style={styles.cfgText}>Registrar compra</Text>
                    </Pressable>
                  </View>
                )}
                {buyFor === f.item_id && (
                  <View style={styles.cfgBox}>
                    <View style={styles.setRow}>
                      <TextInput
                        testID={`buy-bottles-${f.item_id}`}
                        value={buy.bottles}
                        onChangeText={(t) => setBuy({ ...buy, bottles: t })}
                        placeholder="Botellas"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        keyboardType="decimal-pad"
                        style={styles.input}
                      />
                      <TextInput
                        testID={`buy-total-${f.item_id}`}
                        value={buy.total}
                        onChangeText={(t) => setBuy({ ...buy, total: t })}
                        placeholder="Total pagado MXN"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        keyboardType="decimal-pad"
                        style={styles.input}
                      />
                    </View>
                    <TextInput
                      testID={`buy-lot-${f.item_id}`}
                      value={buy.lot}
                      onChangeText={(t) => setBuy({ ...buy, lot: t })}
                      placeholder="Número de lote de la compra"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      style={[styles.input, { marginTop: spacing.sm }]}
                    />
                    {suppliers.length > 0 && (
                      <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                        {suppliers.map((s) => (
                          <Pressable key={s.supplier_id} testID={`buy-sup-${s.supplier_id}`} onPress={() => setBuy({ ...buy, supplier: s.name })} style={[styles.kchip, buy.supplier === s.name && styles.kchipOn]}>
                            <Text style={[styles.kchipText, buy.supplier === s.name && styles.kchipTextOn]}>{s.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <TextInput
                      testID={`buy-supplier-${f.item_id}`}
                      value={buy.supplier}
                      onChangeText={(t) => setBuy({ ...buy, supplier: t })}
                      placeholder="Proveedor (opcional)"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      style={[styles.input, { marginTop: spacing.sm }]}
                    />
                    <Text style={styles.sub}>Suma las botellas al inventario y actualiza el precio por botella.</Text>
                    <Button testID={`buy-save-${f.item_id}`} label="Guardar compra" icon="checkmark" onPress={() => savePurchase(f)} style={{ marginTop: spacing.sm }} />
                  </View>
                )}
              </View>
            );
          })
        )}

        {adding ? (
          <View style={styles.addBox}>
            <Field testID="inv-new-name" label="Nombre del producto" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Ej. Introfiant" />
            <Text style={styles.sub}>Tipo de producto</Text>
            <View style={[styles.chipRow, { marginBottom: spacing.md }]}>
              {KINDS.map((k) => (
                <Pressable key={k.key} testID={`inv-kind-${k.key}`} onPress={() => setForm({ ...form, kind: k.key, bottle: k.key === "topico" ? "100" : form.bottle })} style={[styles.kchip, form.kind === k.key && styles.kchipOn]}>
                  <Text style={[styles.kchipText, form.kind === k.key && styles.kchipTextOn]}>{k.label}</Text>
                </Pressable>
              ))}
            </View>
            {form.kind === "arterial" && (
              <Field testID="inv-new-index" label="Index (%)" value={form.index} onChangeText={(t) => setForm({ ...form, index: t })} keyboardType="decimal-pad" placeholder="Ej. 25" />
            )}
            <Field testID="inv-new-bottle" label={form.kind === "topico" ? "Tamaño del envase (g)" : "Tamaño del envase (mL)"} value={form.bottle} onChangeText={(t) => setForm({ ...form, bottle: t })} keyboardType="decimal-pad" />
            <Field testID="inv-new-lot" label="Número de lote" value={form.lot} onChangeText={(t) => setForm({ ...form, lot: t })} placeholder="Ej. A-2311" />
            <Field testID="inv-new-stock" label="Envases en existencia de ese lote" value={form.stock} onChangeText={(t) => setForm({ ...form, stock: t })} keyboardType="decimal-pad" placeholder="Ej. 12" />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button testID="inv-cancel" label="Cancelar" variant="ghost" onPress={() => setAdding(false)} style={{ flex: 1 }} />
              <Button testID="inv-save" label="Guardar" icon="checkmark" onPress={add} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <Button testID="inv-add" label="Agregar producto" icon="add-circle-outline" variant="outline" onPress={() => setAdding(true)} style={{ marginTop: spacing.md }} />
        )}

        {!!items?.length && (
          <View style={styles.addBox}>
            <Pressable testID="inv-shopping-toggle" onPress={() => setShopping((s) => !s)} style={styles.cfgLink}>
              <Ionicons name="cart-outline" size={18} color={colors.onSurface} />
              <Text style={styles.name}>Lista de compras</Text>
              <Ionicons name={shopping ? "chevron-up" : "chevron-down"} size={18} color={colors.onSurfaceTertiary} style={{ marginLeft: "auto" }} />
            </Pressable>
            {shopping && (
              <>
                <Text style={styles.sub}>Escribe cuántas botellas pedir. Los fluidos por agotarse aparecen primero.</Text>
                {[...items].sort((a, b) => Number(isLow(b)) - Number(isLow(a))).map((f) => (
                  <View key={f.item_id} style={styles.orderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderName}>{f.name}</Text>
                      <Text style={[styles.sub, isLow(f) && { color: colors.error }]}>
                        Existencia {f.stock_bottles ?? "—"}{isLow(f) ? " · por agotarse" : ""}
                      </Text>
                    </View>
                    <TextInput
                      testID={`inv-order-${f.item_id}`}
                      value={order[f.item_id] ?? ""}
                      onChangeText={(t) => setOrder((o) => ({ ...o, [f.item_id]: t }))}
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="decimal-pad"
                      style={[styles.input, { flexGrow: 0, flexShrink: 0, width: 80, textAlign: "center" }]}
                    />
                  </View>
                ))}
                <Text style={styles.sub}>Enviar a:</Text>
                <View style={styles.chipRow}>
                  {suppliers.map((s) => (
                    <Pressable key={s.supplier_id} testID={`inv-order-sup-${s.supplier_id}`} onPress={() => setOrderTo(orderTo === s.supplier_id ? null : s.supplier_id)} style={[styles.kchip, orderTo === s.supplier_id && styles.kchipOn]}>
                      <Text style={[styles.kchipText, orderTo === s.supplier_id && styles.kchipTextOn]}>{s.name}</Text>
                    </Pressable>
                  ))}
                  <Pressable testID="inv-suppliers" onPress={() => router.push("/library/suppliers")} style={styles.kchip}>
                    <Text style={styles.kchipText}>+ Proveedores</Text>
                  </Pressable>
                </View>
                <Button testID="inv-order-send" label={orderTo ? `Enviar a ${suppliers.find((s) => s.supplier_id === orderTo)?.name}` : "Enviar por WhatsApp"} icon="logo-whatsapp" onPress={sendOrder} style={{ marginTop: spacing.sm }} />
              </>
            )}
          </View>
        )}

        {purchases.length > 0 && (
          <View testID="inv-purchases" style={styles.addBox}>
            <Text style={styles.name}>Historial de compras</Text>
            {purchases.slice(0, 30).map((p) => (
              <View key={p.purchase_id} testID={`purchase-${p.purchase_id}`} style={styles.orderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderName}>{p.fluid_name} · {p.bottles} env.{p.lot ? ` · Lote ${p.lot}` : ""}</Text>
                  <Text style={styles.sub}>
                    {fmtDateMx(p.date)} · {mxn(p.total)} ({mxn(p.unit_price)} c/u){p.supplier ? ` · ${p.supplier}` : ""}
                  </Text>
                </View>
                <Pressable testID={`purchase-del-${p.purchase_id}`} onPress={() => removePurchase(p)} hitSlop={10} style={styles.round}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))}
            <Text style={styles.sub}>Eliminar una compra resta sus botellas del inventario.</Text>
          </View>
        )}

        <Button
          testID="inv-prices"
          label="Precios de co-inyectores y cavidades"
          icon="pricetags-outline"
          variant="ghost"
          onPress={() => router.push("/library/prices")}
          style={{ marginTop: spacing.md }}
        />
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
  lotsBox: { width: "100%", gap: spacing.xs },
  lotRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lotStock: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.base, minWidth: 44, textAlign: "right" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kchip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  kchipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  kchipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  kchipTextOn: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
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
  setBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceInverse, justifyContent: "center" },
  setText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.sm },
  addBox: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  cfgBox: { width: "100%" },
  cfgLink: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  cfgText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  orderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  orderName: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
});
