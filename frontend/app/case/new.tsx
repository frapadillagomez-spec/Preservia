import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

export default function NewCase() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [name, setName] = useState("");
  const [caseRef, setCaseRef] = useState("");
  const [deceased, setDeceased] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.show("El nombre del caso es obligatorio", "error");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.post("/cases", {
        name: name.trim(),
        case_ref: caseRef.trim(),
        deceased_name: deceased.trim(),
      });
      toast.show("Caso creado", "success");
      router.replace(`/case/${resp.case.case_id}`);
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo crear el caso", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Nuevo caso</Text>
        <Pressable testID="new-case-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Field
            testID="case-name-input"
            label="Nombre del caso *"
            icon="briefcase-outline"
            value={name}
            onChangeText={setName}
            placeholder="Ej. Caso 2026-042"
          />
          <Field
            testID="case-ref-input"
            label="ID / Referencia"
            icon="pricetag-outline"
            value={caseRef}
            onChangeText={setCaseRef}
            placeholder="Referencia interna (opcional)"
          />
          <Field
            testID="case-deceased-input"
            label="Nombre del fallecido"
            icon="person-outline"
            value={deceased}
            onChangeText={setDeceased}
            placeholder="Opcional"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="create-case-button" label="Crear caso" onPress={submit} loading={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl },
  scroll: { padding: spacing.lg, paddingTop: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
});
