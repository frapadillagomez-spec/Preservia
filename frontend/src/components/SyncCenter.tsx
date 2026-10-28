import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Ionicons from "@react-native-vector-icons/ionicons";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { rawRequest } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { ensureLoaded, getQueue, isApiOffline, subscribe } from "@/src/offline/store";
import { chooseConflict, getSyncState, syncNow } from "@/src/offline/sync";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { fmtDateTimeMx } from "@/src/utils/mxtime";

/** Comprueba si el servidor vuelve a responder. */
const ping = () => rawRequest("/cases").catch(() => {});

/** Banner de conexión / pendientes (en el flujo, sin tapar botones), sincronización automática y conflictos. */
export function SyncLayout({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [netOnline, setOnline] = useState(true);
  const [, force] = useState(0);
  const lastError = useRef<string | null>(null);

  useEffect(() => {
    ensureLoaded().then(() => {
      force((n) => n + 1);
      syncNow();
    });
    let lastLen = getQueue().length;
    const unsub = subscribe(() => {
      force((n) => n + 1);
      const err = getSyncState().lastError;
      if (err && err !== lastError.current) toastRef.current.show(err, "error");
      lastError.current = err;
      const len = getQueue().length;
      if (len > lastLen) syncNow(); // nuevo cambio pendiente: intentar subirlo ya
      lastLen = len;
    });
    const unNet = NetInfo.addEventListener((s) => {
      const on = s.isConnected !== false && s.isInternetReachable !== false;
      setOnline(on);
      if (on) syncNow();
    });
    const appSub = AppState.addEventListener("change", (st) => {
      if (st === "active") syncNow();
    });
    const timer = setInterval(() => {
      if (getQueue().length) syncNow();
      else if (isApiOffline()) ping();
    }, 10000);
    return () => {
      unsub();
      unNet();
      appSub.remove();
      clearInterval(timer);
    };
  }, []);

  const pending = getQueue().length;
  const { running, conflict } = getSyncState();
  const online = netOnline && !isApiOffline();
  const show = !online || pending > 0;

  return (
    <>
      {show && (
        <Pressable
          testID="sync-pill"
          onPress={() => (getQueue().length ? syncNow() : ping())}
          style={[styles.banner, { paddingTop: insets.top + 6 }, !online && styles.bannerOffline]}
        >
          <Ionicons
            name={!online ? "cloud-offline-outline" : running ? "sync-outline" : "cloud-upload-outline"}
            size={16}
            color={colors.onSurfaceInverse}
          />
          <Text style={styles.pillText}>
            {!online ? "Sin conexión" : running ? "Sincronizando…" : "Toca para sincronizar"}
            {pending > 0 ? ` · ${pending} pendiente${pending === 1 ? "" : "s"}` : ""}
          </Text>
        </Pressable>
      )}
      <SafeAreaInsetsContext.Provider value={show ? { ...insets, top: 0 } : insets}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>

      <Modal visible={!!conflict} transparent animationType="fade" onRequestClose={() => chooseConflict("mine")}>
        <View style={styles.backdrop}>
          <View testID="sync-conflict" style={styles.card}>
            <Ionicons name="git-compare-outline" size={28} color={colors.onSurface} />
            <Text style={styles.title}>Conflicto en “{conflict?.caseName}”</Text>
            <Text style={styles.body}>
              Mientras estabas sin conexión cambiaste {conflict?.description}, pero el caso también se modificó en el servidor
              {conflict ? ` (${fmtDateTimeMx(conflict.serverUpdatedAt)})` : ""}. ¿Qué versión quieres conservar?
            </Text>
            <Button testID="conflict-keep-mine" label="Conservar mis cambios" icon="phone-portrait-outline" onPress={() => chooseConflict("mine")} />
            <View style={{ height: spacing.sm }} />
            <Button testID="conflict-use-server" label="Usar la versión del servidor" variant="outline" icon="cloud-outline" onPress={() => chooseConflict("server")} />
            <Text style={styles.note}>Las notas, la bitácora y los cálculos nuevos se suben en ambos casos.</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    minHeight: 44,
  },
  bannerOffline: { backgroundColor: colors.error },
  pillText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.sm },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 22, marginBottom: spacing.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.sm },
});
