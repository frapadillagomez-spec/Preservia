import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { durationBetween, fmtDateTimeMx } from "@/src/utils/mxtime";

/** Botones Iniciar / Terminar: registra automáticamente el tiempo del embalsamamiento. */
export function EmbalmingTimer({
  caseId,
  start,
  end,
  onChange,
}: {
  caseId: string;
  start?: string | null;
  end?: string | null;
  onChange: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = !!start && !end;

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      await api.post(`/cases/${caseId}/embalming`, { action });
      toast.show(action === "start" ? "Embalsamamiento iniciado" : "Embalsamamiento terminado", "success");
      onChange();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo registrar la hora", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="emb-timer" style={styles.box}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>
          {running ? "En curso desde " : start ? "Inicio " : "Embalsamamiento sin iniciar"}
          {start ? fmtDateTimeMx(start) : ""}
        </Text>
        {!!end && (
          <Text testID="emb-duration" style={styles.value}>
            Término {fmtDateTimeMx(end)} · {durationBetween(start, end) || "—"}
          </Text>
        )}
      </View>
      {running ? (
        <Pressable testID="emb-stop" disabled={busy} onPress={() => act("stop")} style={[styles.btn, styles.stop]}>
          <Ionicons name="stop" size={16} color={colors.onSurfaceInverse} />
          <Text style={styles.btnText}>Terminar</Text>
        </Pressable>
      ) : (
        <Pressable testID="emb-start" disabled={busy} onPress={() => act("start")} style={styles.btn}>
          <Ionicons name="play" size={16} color={colors.onSurfaceInverse} />
          <Text style={styles.btnText}>{start ? "Reiniciar" : "Iniciar"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  label: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  value: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceInverse },
  stop: { backgroundColor: colors.error },
  btnText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.sm },
});
