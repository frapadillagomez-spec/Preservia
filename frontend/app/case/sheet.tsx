import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Opt = { key: string; label: string };

const TIPO_CASO: Opt[] = [
  { key: "necropsiado", label: "Necropsiado" },
  { key: "normal", label: "Normal" },
  { key: "estudio_clinico", label: "Estudio clínico" },
];
const COMPLEXION: Opt[] = [
  { key: "normal", label: "Normal" },
  { key: "emaciada", label: "Emaciada" },
  { key: "delgada", label: "Delgada" },
  { key: "mediana", label: "Mediana" },
  { key: "robusta", label: "Robusta" },
  { key: "obesa", label: "Obesa" },
];
const SELLO: Opt[] = [
  { key: "barba", label: "Barba" },
  { key: "bigote", label: "Bigote" },
];
const SIGNOS: Opt[] = [
  { key: "amoratamiento_rostro", label: "Amoratamiento en el rostro" },
  { key: "amoratamiento_declives", label: "Amoratamiento en zonas declives" },
  { key: "inflamacion_abdominal", label: "Inflamación abdominal" },
  { key: "fluidos_orificios", label: "Fluidos por orificios naturales" },
  { key: "fluidos_suturas", label: "Fluidos por suturas" },
  { key: "gases_ofensivos", label: "Cuadro de gases ofensivos" },
  { key: "retencion_liquidos", label: "Retención de líquidos" },
  { key: "gas_tejido", label: "Gas en tejido" },
  { key: "ictericia", label: "Ictericia" },
];
const CARAC: Opt[] = [
  { key: "amputacion", label: "Amputación" },
  { key: "cicatriz", label: "Cicatriz" },
  { key: "traumas", label: "Traumas" },
  { key: "ulceras", label: "Úlceras de decúbito" },
  { key: "tumor", label: "Tumor" },
  { key: "desprendimiento_piel", label: "Desprendimiento de piel" },
  { key: "refrigerado", label: "Refrigerado" },
];
const EQUIPO: Opt[] = [
  { key: "cateter_dialisis", label: "Catéter de diálisis" },
  { key: "marcapasos", label: "Marcapasos" },
  { key: "grapas", label: "Grapas quirúrgicas" },
  { key: "osteosintesis", label: "Material de osteosíntesis" },
  { key: "respiratorio", label: "Material respiratorio" },
  { key: "sonda_urinaria", label: "Sonda urinaria" },
  { key: "traqueotomia", label: "Traqueotomía" },
];
const SERVICIO: Opt[] = [
  { key: "normal", label: "Embalsamamiento normal" },
  { key: "especial", label: "Embalsamamiento especial" },
  { key: "largo_plazo", label: "Embalsamamiento a largo plazo" },
  { key: "reconstruccion", label: "Reconstrucción" },
  { key: "auxilio_estetico", label: "Auxilio estético" },
  { key: "custodia", label: "Custodia y refrigeración" },
  { key: "ninguno", label: "Ningún servicio" },
];

type Sheet = Record<string, any>;

const EMPTY: Sheet = {
  fecha_ingreso: "",
  no_servicio: "",
  nombre_difunto: "",
  funeraria: "",
  responsable_funeraria: "",
  ingreso_sala: "",
  inicio_emb: "",
  termino_emb: "",
  tipo_caso: [],
  tipo_caso_otro: "",
  complexion: "",
  sello_facial: [],
  sello_facial_otro: "",
  signos: [],
  signos_otros: "",
  caracteristicas: [],
  caracteristicas_lesiones: "",
  caracteristicas_otros: "",
  equipo_medico: [],
  equipo_medico_otros: "",
  altura: "",
  ancho: "",
  peso: "",
  tipo_servicio: [],
  reacciones: "",
  sugerencias: "",
  sala_velacion: "",
  domicilio: "",
  otro_lugar: "",
  fecha_egreso: "",
  hora_egreso: "",
  responsable_entrega: "",
  titular_responsable: "",
  tecnico_responsable: "",
  gerente_turno: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
function timeOf(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateOf(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CaseSheet() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();

  const [sheet, setSheet] = useState<Sheet>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const resp = await api.get<{ case: any }>(`/cases/${caseId}`);
      const c = resp.case;
      const existing = c.case_sheet;
      if (existing && typeof existing === "object") {
        setSheet({ ...EMPTY, ...existing });
      } else {
        setSheet({
          ...EMPTY,
          nombre_difunto: c.deceased_name || "",
          fecha_ingreso: dateOf(c.embalming_date || c.date),
          inicio_emb: timeOf(c.embalming_start),
          termino_emb: timeOf(c.embalming_end),
        });
      }
    } catch {
      toast.show("No se pudo cargar la hoja", "error");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: string, v: any) => setSheet((s) => ({ ...s, [k]: v }));
  const toggle = (k: string, val: string) =>
    setSheet((s) => {
      const arr: string[] = Array.isArray(s[k]) ? s[k] : [];
      return { ...s, [k]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/cases/${caseId}/sheet`, { sheet });
      toast.show("Hoja del caso guardada", "success");
      router.back();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar la hoja", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hoja del caso</Text>
          <Text style={styles.subtitle}>Análisis del caso — Embalsamamiento</Text>
        </View>
        <Pressable testID="sheet-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {loading ? null : (
            <>
              <SectionLabel text="Ingreso" />
              <TextField label="Fecha de ingreso (AAAA-MM-DD)" testID="s-fecha_ingreso" value={sheet.fecha_ingreso} onChangeText={(v) => set("fecha_ingreso", v)} placeholder="2026-06-01" />
              <TextField label="No. de servicio" testID="s-no_servicio" value={sheet.no_servicio} onChangeText={(v) => set("no_servicio", v)} placeholder="Ej. 1024" />
              <TextField label="Nombre del difunto" testID="s-nombre_difunto" value={sheet.nombre_difunto} onChangeText={(v) => set("nombre_difunto", v)} placeholder="Nombre completo" />
              <TextField label="Funeraria" testID="s-funeraria" value={sheet.funeraria} onChangeText={(v) => set("funeraria", v)} placeholder="Nombre de la funeraria" />
              <TextField label="Responsable de la funeraria" testID="s-responsable_funeraria" value={sheet.responsable_funeraria} onChangeText={(v) => set("responsable_funeraria", v)} placeholder="Nombre" />

              <SectionLabel text="Horarios" />
              <View style={styles.row3}>
                <SmallField label="Ingreso a sala" testID="s-ingreso_sala" value={sheet.ingreso_sala} onChangeText={(v) => set("ingreso_sala", v)} placeholder="HH:MM" />
                <SmallField label="Inicio emb." testID="s-inicio_emb" value={sheet.inicio_emb} onChangeText={(v) => set("inicio_emb", v)} placeholder="HH:MM" />
                <SmallField label="Término emb." testID="s-termino_emb" value={sheet.termino_emb} onChangeText={(v) => set("termino_emb", v)} placeholder="HH:MM" />
              </View>

              <SectionLabel text="Tipo de caso" />
              <Chips options={TIPO_CASO} selected={sheet.tipo_caso} onToggle={(k) => toggle("tipo_caso", k)} group="tipo_caso" />
              <TextField label="Otro (tipo de caso)" testID="s-tipo_caso_otro" value={sheet.tipo_caso_otro} onChangeText={(v) => set("tipo_caso_otro", v)} placeholder="Especifica" />

              <SectionLabel text="Complexión" />
              <Chips options={COMPLEXION} selected={sheet.complexion ? [sheet.complexion] : []} onToggle={(k) => set("complexion", sheet.complexion === k ? "" : k)} group="complexion" />

              <SectionLabel text="Uso de sello facial" />
              <Chips options={SELLO} selected={sheet.sello_facial} onToggle={(k) => toggle("sello_facial", k)} group="sello" />
              <TextField label="Otro (sello facial)" testID="s-sello_facial_otro" value={sheet.sello_facial_otro} onChangeText={(v) => set("sello_facial_otro", v)} placeholder="Especifica" />

              <SectionLabel text="Signos tempranos de descomposición" />
              <Chips options={SIGNOS} selected={sheet.signos} onToggle={(k) => toggle("signos", k)} group="signos" />
              <TextField label="Otros signos" testID="s-signos_otros" value={sheet.signos_otros} onChangeText={(v) => set("signos_otros", v)} placeholder="Especifica" />

              <SectionLabel text="Características" />
              <Chips options={CARAC} selected={sheet.caracteristicas} onToggle={(k) => toggle("caracteristicas", k)} group="carac" />
              <TextField label="Lesiones" testID="s-caracteristicas_lesiones" value={sheet.caracteristicas_lesiones} onChangeText={(v) => set("caracteristicas_lesiones", v)} placeholder="Describe" />
              <TextField label="Otras características" testID="s-caracteristicas_otros" value={sheet.caracteristicas_otros} onChangeText={(v) => set("caracteristicas_otros", v)} placeholder="Especifica" />

              <SectionLabel text="Equipo médico" />
              <Chips options={EQUIPO} selected={sheet.equipo_medico} onToggle={(k) => toggle("equipo_medico", k)} group="equipo" />
              <TextField label="Otros (equipo médico)" testID="s-equipo_medico_otros" value={sheet.equipo_medico_otros} onChangeText={(v) => set("equipo_medico_otros", v)} placeholder="Especifica" />

              <SectionLabel text="Medidas" />
              <View style={styles.row3}>
                <SmallField label="Altura" testID="s-altura" value={sheet.altura} onChangeText={(v) => set("altura", v)} placeholder="cm" />
                <SmallField label="Ancho" testID="s-ancho" value={sheet.ancho} onChangeText={(v) => set("ancho", v)} placeholder="cm" />
                <SmallField label="Peso" testID="s-peso" value={sheet.peso} onChangeText={(v) => set("peso", v)} placeholder="kg" />
              </View>

              <SectionLabel text="Tipo de servicio realizado" />
              <Chips options={SERVICIO} selected={sheet.tipo_servicio} onToggle={(k) => toggle("tipo_servicio", k)} group="servicio" />

              <SectionLabel text="Observaciones" />
              <MultiField label="Posibles reacciones del caso" testID="s-reacciones" value={sheet.reacciones} onChangeText={(v) => set("reacciones", v)} placeholder="Describe posibles reacciones…" />
              <MultiField label="Sugerencias y comentarios" testID="s-sugerencias" value={sheet.sugerencias} onChangeText={(v) => set("sugerencias", v)} placeholder="Comentarios del embalsamador…" />

              <SectionLabel text="Entrega del caso" />
              <TextField label="Sala de velación" testID="s-sala_velacion" value={sheet.sala_velacion} onChangeText={(v) => set("sala_velacion", v)} placeholder="Nombre / número" />
              <TextField label="Domicilio" testID="s-domicilio" value={sheet.domicilio} onChangeText={(v) => set("domicilio", v)} placeholder="Dirección" />
              <TextField label="Otro lugar" testID="s-otro_lugar" value={sheet.otro_lugar} onChangeText={(v) => set("otro_lugar", v)} placeholder="Especifica" />
              <View style={styles.row2}>
                <SmallField label="Fecha de egreso" testID="s-fecha_egreso" value={sheet.fecha_egreso} onChangeText={(v) => set("fecha_egreso", v)} placeholder="AAAA-MM-DD" />
                <SmallField label="Hora de egreso" testID="s-hora_egreso" value={sheet.hora_egreso} onChangeText={(v) => set("hora_egreso", v)} placeholder="HH:MM" />
              </View>
              <TextField label="Responsable de la entrega" testID="s-responsable_entrega" value={sheet.responsable_entrega} onChangeText={(v) => set("responsable_entrega", v)} placeholder="Nombre" />

              <SectionLabel text="Responsables" />
              <TextField label="Titular o responsable" testID="s-titular_responsable" value={sheet.titular_responsable} onChangeText={(v) => set("titular_responsable", v)} placeholder="Nombre" />
              <TextField label="Técnico responsable del servicio" testID="s-tecnico_responsable" value={sheet.tecnico_responsable} onChangeText={(v) => set("tecnico_responsable", v)} placeholder="Nombre" />
              <TextField label="Gerente de turno" testID="s-gerente_turno" value={sheet.gerente_turno} onChangeText={(v) => set("gerente_turno", v)} placeholder="Nombre" />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="sheet-save-button" label="Guardar hoja" onPress={save} loading={busy} />
      </View>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function TextField(props: { label: string; testID: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        style={styles.input}
      />
    </View>
  );
}

function SmallField(props: { label: string; testID: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        style={styles.input}
      />
    </View>
  );
}

function MultiField(props: { label: string; testID: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        multiline
        style={[styles.input, styles.multiline]}
      />
    </View>
  );
}

function Chips({ options, selected, onToggle, group }: { options: Opt[]; selected: string[]; onToggle: (k: string) => void; group: string }) {
  const sel = Array.isArray(selected) ? selected : [];
  return (
    <View style={styles.chipsWrap}>
      {options.map((o) => {
        const active = sel.includes(o.key);
        return (
          <Pressable
            key={o.key}
            testID={`chip-${group}-${o.key}`}
            onPress={() => onToggle(o.key)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Ionicons
              name={active ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={active ? colors.onSurfaceInverse : colors.onSurfaceSecondary}
            />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  sectionLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  fieldLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
  },
  multiline: { minHeight: 84, textAlignVertical: "top" },
  row2: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  row3: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
});
