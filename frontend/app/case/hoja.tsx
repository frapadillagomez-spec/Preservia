import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

// --------------- Option definitions ---------------
const COMPLEXION_OPTIONS = [
  "Necropsiado", "Normal", "Estudio clínico", "Emaciada",
  "Delgada", "Mediana", "Robusta", "Obesa",
];

const VELLO_FACIAL_OPTIONS = ["Barba", "Bigote", "Otro"];

const SIGNOS_DESCOMPOSICION_OPTIONS = [
  "Amoratamiento rostro", "Amoratamiento zonas declives",
  "Inflamación abdominal", "Segregación fluidos orificios",
  "Segregación fluidos suturas", "Olores ofensivos",
  "Retención líquidos", "Gas en tejido", "Ictericia",
];

const CARACTERISTICAS_CUERPO_OPTIONS = [
  "Amputación", "Cicatriz", "Tatuajes", "Úlceras de decúbito",
  "Tumor", "Desprendimiento de piel", "Refrigerado",
];

const EQUIPO_MEDICO_OPTIONS = [
  "Catéter de diálisis", "Marcapasos", "Grapas quirúrgicas",
  "Material de osteosíntesis", "Material respiratorio",
  "Sonda urinaria", "Traqueotomía",
];

const TIPO_SERVICIO_OPTIONS = [
  "Embalsamamiento normal", "Embalsamamiento especial",
  "Embalsamamiento a largo plazo", "Reconstrucción",
  "Arreglo estético", "Custodia/refrigeración", "Ningún servicio",
];

// --------------- Types ---------------
type FormData = {
  fecha_ingreso: string;
  nombre_difunto: string;
  funeraria: string;
  responsable_funeraria: string;
  no_servicio: string;
  ingreso_sala: string;
  inicio_embalsamamiento: string;
  termino_embalsamamiento: string;
  complexion: string[];
  vello_facial: string[];
  vello_facial_otro: string;
  signos_descomposicion: string[];
  signos_descomposicion_otros: string;
  caracteristicas_cuerpo: string[];
  caracteristicas_lesiones: string;
  caracteristicas_otros: string;
  altura: string;
  ancho: string;
  peso: string;
  equipo_medico: string[];
  equipo_medico_otros: string;
  tipo_servicio: string[];
  posibles_reacciones: string;
  sugerencias_embalsamador: string;
  entrega_lugar: string;
  entrega_sala_velacion: string;
  entrega_domicilio: string;
  entrega_otro_lugar: string;
  fecha_egreso: string;
  hora_egreso: string;
  responsable_entrega: string;
  titular_responsable: string;
  tecnico_responsable: string;
  gerente_turno: string;
};

const EMPTY_FORM: FormData = {
  fecha_ingreso: "",
  nombre_difunto: "",
  funeraria: "",
  responsable_funeraria: "",
  no_servicio: "",
  ingreso_sala: "",
  inicio_embalsamamiento: "",
  termino_embalsamamiento: "",
  complexion: [],
  vello_facial: [],
  vello_facial_otro: "",
  signos_descomposicion: [],
  signos_descomposicion_otros: "",
  caracteristicas_cuerpo: [],
  caracteristicas_lesiones: "",
  caracteristicas_otros: "",
  altura: "",
  ancho: "",
  peso: "",
  equipo_medico: [],
  equipo_medico_otros: "",
  tipo_servicio: [],
  posibles_reacciones: "",
  sugerencias_embalsamador: "",
  entrega_lugar: "",
  entrega_sala_velacion: "",
  entrega_domicilio: "",
  entrega_otro_lugar: "",
  fecha_egreso: "",
  hora_egreso: "",
  responsable_entrega: "",
  titular_responsable: "",
  tecnico_responsable: "",
  gerente_turno: "",
};

// --------------- Checkbox component ---------------
function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };
  return (
    <View style={styles.checkGroup}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <View style={styles.checkGrid}>
        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              onPress={() => toggle(opt)}
              style={[styles.checkItem, checked && styles.checkItemActive]}
            >
              <Ionicons
                name={checked ? "checkbox" : "square-outline"}
                size={20}
                color={checked ? colors.onSurfaceInverse : colors.onSurfaceTertiary}
              />
              <Text style={[styles.checkLabel, checked && styles.checkLabelActive]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// --------------- Form field component ---------------
function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={colors.onSurfaceTertiary}
        multiline={multiline}
        keyboardType={keyboardType || "default"}
        style={[styles.fieldInput, multiline && { minHeight: 72, textAlignVertical: "top" }]}
      />
    </View>
  );
}

// --------------- Main screen ---------------
export default function HojaCasoScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { caseId, deceasedName, caseDate } = useLocalSearchParams<{
    caseId: string;
    deceasedName?: string;
    caseDate?: string;
  }>();

  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const updateField = (key: keyof FormData, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const load = useCallback(async () => {
    try {
      const resp = await api.get<{ hoja: any }>(`/cases/${caseId}/hoja`);
      if (resp.hoja) {
        setForm({
          ...EMPTY_FORM,
          ...resp.hoja,
          altura: resp.hoja.altura != null ? String(resp.hoja.altura) : "",
          ancho: resp.hoja.ancho != null ? String(resp.hoja.ancho) : "",
          peso: resp.hoja.peso != null ? String(resp.hoja.peso) : "",
        });
      } else {
        // Pre-fill from case data
        setForm({
          ...EMPTY_FORM,
          nombre_difunto: deceasedName || "",
          fecha_ingreso: caseDate || "",
        });
      }
    } catch {
      // Pre-fill from case data on error
      setForm({
        ...EMPTY_FORM,
        nombre_difunto: deceasedName || "",
        fecha_ingreso: caseDate || "",
      });
    } finally {
      setLoading(false);
    }
  }, [caseId, deceasedName, caseDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        altura: form.altura ? parseFloat(form.altura) : null,
        ancho: form.ancho ? parseFloat(form.ancho) : null,
        peso: form.peso ? parseFloat(form.peso) : null,
      };
      await api.post(`/cases/${caseId}/hoja`, payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show("Hoja guardada correctamente", "success");
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const generatePdf = async () => {
    setGeneratingPdf(true);
    try {
      const resp = await api.get<{ filename: string; pdf_base64: string }>(`/cases/${caseId}/hoja/pdf`);
      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = `data:application/pdf;base64,${resp.pdf_base64}`;
        link.download = resp.filename;
        link.click();
      } else {
        const uri = FileSystem.cacheDirectory + resp.filename;
        await FileSystem.writeAsStringAsync(uri, resp.pdf_base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
        }
      }
      toast.show("PDF generado", "success");
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo generar el PDF", "error");
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Hoja de Análisis de Caso
          </Text>
        </View>
        <Pressable onPress={generatePdf} hitSlop={12} disabled={generatingPdf}>
          {generatingPdf ? (
            <ActivityIndicator size="small" color={colors.onSurface} />
          ) : (
            <Ionicons name="download-outline" size={24} color={colors.onSurface} />
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 1. Información general */}
          <Text style={styles.sectionTitle}>1. Información General</Text>
          <View style={styles.card}>
            <FormField label="Fecha de ingreso" value={form.fecha_ingreso} onChangeText={(t) => updateField("fecha_ingreso", t)} />
            <FormField label="Nombre del difunto" value={form.nombre_difunto} onChangeText={(t) => updateField("nombre_difunto", t)} />
            <FormField label="Funeraria" value={form.funeraria} onChangeText={(t) => updateField("funeraria", t)} />
            <FormField label="Responsable de la funeraria" value={form.responsable_funeraria} onChangeText={(t) => updateField("responsable_funeraria", t)} />
            <FormField label="No. de servicio" value={form.no_servicio} onChangeText={(t) => updateField("no_servicio", t)} />
          </View>

          {/* 2. Tiempos */}
          <Text style={styles.sectionTitle}>2. Tiempos</Text>
          <View style={styles.card}>
            <FormField label="Ingreso a sala de emb." value={form.ingreso_sala} onChangeText={(t) => updateField("ingreso_sala", t)} />
            <FormField label="Inicio del emb." value={form.inicio_embalsamamiento} onChangeText={(t) => updateField("inicio_embalsamamiento", t)} />
            <FormField label="Término del emb." value={form.termino_embalsamamiento} onChangeText={(t) => updateField("termino_embalsamamiento", t)} />
          </View>

          {/* 3. Complexión */}
          <CheckboxGroup
            label="3. Complexión"
            options={COMPLEXION_OPTIONS}
            selected={form.complexion}
            onChange={(v) => updateField("complexion", v)}
          />

          {/* 4. Vello facial */}
          <CheckboxGroup
            label="4. Vello Facial"
            options={VELLO_FACIAL_OPTIONS}
            selected={form.vello_facial}
            onChange={(v) => updateField("vello_facial", v)}
          />
          {form.vello_facial.includes("Otro") && (
            <View style={styles.card}>
              <FormField label="Especifique" value={form.vello_facial_otro} onChangeText={(t) => updateField("vello_facial_otro", t)} />
            </View>
          )}

          {/* 5. Signos de descomposición */}
          <CheckboxGroup
            label="5. Signos de Descomposición"
            options={SIGNOS_DESCOMPOSICION_OPTIONS}
            selected={form.signos_descomposicion}
            onChange={(v) => updateField("signos_descomposicion", v)}
          />
          <View style={styles.card}>
            <FormField label="Otros signos" value={form.signos_descomposicion_otros} onChangeText={(t) => updateField("signos_descomposicion_otros", t)} placeholder="Especifique otros signos..." />
          </View>

          {/* 6. Características del cuerpo */}
          <CheckboxGroup
            label="6. Características del Cuerpo"
            options={CARACTERISTICAS_CUERPO_OPTIONS}
            selected={form.caracteristicas_cuerpo}
            onChange={(v) => updateField("caracteristicas_cuerpo", v)}
          />
          <View style={styles.card}>
            <FormField label="Lesiones" value={form.caracteristicas_lesiones} onChangeText={(t) => updateField("caracteristicas_lesiones", t)} placeholder="Describa lesiones..." />
            <FormField label="Otros" value={form.caracteristicas_otros} onChangeText={(t) => updateField("caracteristicas_otros", t)} placeholder="Otras características..." />
          </View>

          {/* 7. Medidas */}
          <Text style={styles.sectionTitle}>7. Medidas</Text>
          <View style={styles.card}>
            <FormField label="Altura (cm)" value={form.altura} onChangeText={(t) => updateField("altura", t)} keyboardType="numeric" />
            <FormField label="Ancho (cm)" value={form.ancho} onChangeText={(t) => updateField("ancho", t)} keyboardType="numeric" />
            <FormField label="Peso (kg)" value={form.peso} onChangeText={(t) => updateField("peso", t)} keyboardType="numeric" />
          </View>

          {/* 8. Equipo médico */}
          <CheckboxGroup
            label="8. Equipo Médico"
            options={EQUIPO_MEDICO_OPTIONS}
            selected={form.equipo_medico}
            onChange={(v) => updateField("equipo_medico", v)}
          />
          <View style={styles.card}>
            <FormField label="Otros equipos" value={form.equipo_medico_otros} onChangeText={(t) => updateField("equipo_medico_otros", t)} placeholder="Especifique otros equipos..." />
          </View>

          {/* 9. Tipo de servicio */}
          <CheckboxGroup
            label="9. Tipo de Servicio"
            options={TIPO_SERVICIO_OPTIONS}
            selected={form.tipo_servicio}
            onChange={(v) => updateField("tipo_servicio", v)}
          />

          {/* 10. Comentarios */}
          <Text style={styles.sectionTitle}>10. Comentarios</Text>
          <View style={styles.card}>
            <FormField label="Posibles reacciones" value={form.posibles_reacciones} onChangeText={(t) => updateField("posibles_reacciones", t)} multiline placeholder="Describa posibles reacciones..." />
            <FormField label="Sugerencias del embalsamador" value={form.sugerencias_embalsamador} onChangeText={(t) => updateField("sugerencias_embalsamador", t)} multiline placeholder="Sugerencias..." />
          </View>

          {/* 11. Entrega */}
          <Text style={styles.sectionTitle}>11. Entrega</Text>
          <View style={styles.card}>
            <FormField label="Sala de velación" value={form.entrega_sala_velacion} onChangeText={(t) => updateField("entrega_sala_velacion", t)} />
            <FormField label="Domicilio" value={form.entrega_domicilio} onChangeText={(t) => updateField("entrega_domicilio", t)} />
            <FormField label="Otro lugar" value={form.entrega_otro_lugar} onChangeText={(t) => updateField("entrega_otro_lugar", t)} />
            <FormField label="Fecha de egreso" value={form.fecha_egreso} onChangeText={(t) => updateField("fecha_egreso", t)} />
            <FormField label="Hora de egreso" value={form.hora_egreso} onChangeText={(t) => updateField("hora_egreso", t)} />
            <FormField label="Responsable de entrega" value={form.responsable_entrega} onChangeText={(t) => updateField("responsable_entrega", t)} />
            <FormField label="Titular/responsable" value={form.titular_responsable} onChangeText={(t) => updateField("titular_responsable", t)} />
            <FormField label="Técnico responsable" value={form.tecnico_responsable} onChangeText={(t) => updateField("tecnico_responsable", t)} />
            <FormField label="Gerente de turno" value={form.gerente_turno} onChangeText={(t) => updateField("gerente_turno", t)} />
          </View>

          {/* Save button */}
          <View style={styles.actionRow}>
            <Button
              testID="save-hoja-button"
              label="Guardar Hoja"
              icon="save-outline"
              onPress={save}
              loading={saving}
              style={{ flex: 1 }}
            />
            <Button
              testID="pdf-hoja-button"
              label="Generar PDF"
              icon="download-outline"
              variant="secondary"
              onPress={generatePdf}
              loading={generatingPdf}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 },
  sectionTitle: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.medium,
    fontSize: fontSize.base,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
  },
  checkGroup: { marginTop: spacing.lg, marginBottom: spacing.sm },
  checkGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  checkItemActive: {
    backgroundColor: colors.surfaceInverse,
    borderColor: colors.surfaceInverse,
  },
  checkLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
  },
  checkLabelActive: {
    color: colors.onSurfaceInverse,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
  },
});
