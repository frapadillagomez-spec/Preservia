import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PinPad } from "@/src/components/PinPad";
import { useToast } from "@/src/components/Toast";
import { bioAvailable, bioLabel, lockSettings, PIN_LENGTH } from "@/src/lock/lockSettings";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Flow = null | "enable" | "change" | "disable";

/** Ajustes de seguridad en Perfil: activar PIN, cambiarlo, Face ID / huella. */
export function LockSettingsCard() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [bio, setBio] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const [bioName, setBioName] = useState("biometría");
  const [flow, setFlow] = useState<Flow>(null);

  const refresh = async () => {
    setEnabled(await lockSettings.isEnabled());
    setBio(await lockSettings.bioEnabled());
    setBioOk(await bioAvailable());
    setBioName(await bioLabel());
  };
  useEffect(() => {
    refresh();
  }, []);

  const done = async (msg: string) => {
    setFlow(null);
    await refresh();
    toast.show(msg, "success");
  };

  return (
    <View testID="lock-settings" style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="lock-closed-outline" size={20} color={colors.onSurface} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Bloqueo con PIN</Text>
          <Text style={styles.sub}>Pide un PIN de {PIN_LENGTH} dígitos al abrir la app</Text>
        </View>
        <Switch testID="lock-toggle" value={enabled} onValueChange={(v) => setFlow(v ? "enable" : "disable")} />
      </View>
      {enabled && (
        <>
          <View style={[styles.row, styles.border]}>
            <Ionicons name={bioName === "huella" ? "finger-print-outline" : "scan-outline"} size={20} color={colors.onSurface} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Desbloquear con {bioName}</Text>
              <Text style={styles.sub}>{bioOk ? "El PIN sigue disponible como respaldo" : "No disponible en este dispositivo"}</Text>
            </View>
            <Switch
              testID="lock-bio-toggle"
              value={bio && bioOk}
              disabled={!bioOk}
              onValueChange={async (v) => {
                await lockSettings.setBio(v);
                setBio(v);
              }}
            />
          </View>
          <Pressable testID="lock-change" onPress={() => setFlow("change")} style={[styles.row, styles.border]}>
            <Ionicons name="keypad-outline" size={20} color={colors.onSurface} />
            <Text style={[styles.label, { flex: 1 }]}>Cambiar PIN</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        </>
      )}
      <PinFlow
        flow={flow}
        onCancel={() => setFlow(null)}
        onDone={done}
      />
    </View>
  );
}

function PinFlow({ flow, onCancel, onDone }: { flow: Flow; onCancel: () => void; onDone: (msg: string) => void }) {
  const insets = useSafeAreaInsets();
  // Pasos: verify (PIN actual) -> new -> confirm
  const [step, setStep] = useState<"verify" | "new" | "confirm">("new");
  const [pin, setPin] = useState("");
  const [first, setFirst] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setStep(flow === "enable" ? "new" : "verify");
    setPin("");
    setFirst("");
    setError("");
  }, [flow]);

  const onChange = async (v: string) => {
    setPin(v);
    setError("");
    if (v.length < PIN_LENGTH) return;
    setPin("");
    if (step === "verify") {
      if (!(await lockSettings.checkPin(v))) return setError("PIN incorrecto");
      if (flow === "disable") {
        await lockSettings.disable();
        return onDone("Bloqueo con PIN desactivado");
      }
      return setStep("new");
    }
    if (step === "new") {
      setFirst(v);
      return setStep("confirm");
    }
    if (v !== first) {
      setStep("new");
      return setError("Los PIN no coinciden, inténtalo de nuevo");
    }
    await lockSettings.enable(v);
    onDone(flow === "change" ? "PIN actualizado" : "Bloqueo con PIN activado");
  };

  const title = step === "verify" ? "Ingresa tu PIN actual" : step === "new" ? "Crea un PIN de 4 dígitos" : "Confirma tu PIN";

  return (
    <Modal visible={!!flow} animationType="slide" onRequestClose={onCancel}>
      <View testID="pin-flow" style={[styles.modal, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.modalHead}>
          <Pressable testID="pin-flow-cancel" onPress={onCancel} hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <Text style={styles.modalTitle}>{title}</Text>
        <Text style={styles.modalSub}>No lo compartas; si lo olvidas tendrás que reinstalar la app.</Text>
        <PinPad value={pin} onChange={onChange} error={error} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingVertical: spacing.sm },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  modal: { flex: 1, backgroundColor: colors.surface, alignItems: "center", paddingHorizontal: spacing.lg },
  modalHead: { alignSelf: "stretch", alignItems: "flex-end" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl, marginTop: spacing.lg, textAlign: "center" },
  modalSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.xs, marginBottom: spacing.xl, textAlign: "center" },
});
