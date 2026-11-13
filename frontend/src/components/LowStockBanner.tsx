import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type StockFluid = {
  item_id: string;
  name: string;
  index_pct: number;
  bottle_ml?: number;
  stock_bottles?: number;
  min_stock?: number;
  price_per_bottle?: number;
};

export const DEFAULT_MIN_STOCK = 2;
export const minStock = (f: StockFluid) => f.min_stock ?? DEFAULT_MIN_STOCK;
/** Por agotarse: solo fluidos con inventario registrado y existencia ≤ mínimo. */
export const isLow = (f: StockFluid) => f.stock_bottles !== undefined && f.stock_bottles !== null && f.stock_bottles <= minStock(f);

/** Aviso en Inicio cuando algún arterial está por agotarse. */
export function LowStockBanner() {
  const [low, setLow] = useState<StockFluid[]>([]);

  useFocusEffect(
    useCallback(() => {
      api
        .get<{ items: StockFluid[] }>("/fluids")
        .then((r) => setLow((r.items || []).filter(isLow)))
        .catch(() => {});
    }, []),
  );

  if (low.length === 0) return null;
  return (
    <Pressable
      testID="low-stock-banner"
      onPress={() => router.push("/library/inventory")}
      style={({ pressed }) => [styles.box, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="warning-outline" size={20} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {low.length === 1 ? "1 arterial por agotarse" : `${low.length} arteriales por agotarse`}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {low.map((f) => `${f.name} (${f.stock_bottles} bot.)`).join(" · ")}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningBg,
    minHeight: 56,
  },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
});
