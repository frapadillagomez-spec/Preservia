import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandLogo } from "@/src/components/BrandLogo";
import { PinPad } from "@/src/components/PinPad";
import { authenticateBio, bioAvailable, bioLabel, lockSettings, PIN_LENGTH, RELOCK_MS } from "@/src/lock/lockSettings";
import { colors, font, fontSize, spacing } from "@/src/theme";

const MAX_TRIES = 5;
const COOLDOWN_S = 30;

/** Pide PIN (o Face ID / huella) al abrir la app y al volver tras 1 minuto en segundo plano. */
export function LockGate({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [bio, setBio] = useState<{ label: string } | null>(null);
  const bgAt = useRef<number | null>(null);

  const tryBio = useCallback(async () => {
    if (await authenticateBio()) {
      setLocked(false);
      setPin("");
      setError("");
      setTries(0);
      lockSettings.setTries(0);
    }
  }, []);

  const lockNow = useCallback(async () => {
    if (!(await lockSettings.isEnabled())) {
      setLocked(false);
      return;
    }
    setPin("");
    setError("");
    setTries(await lockSettings.getTries());
    const left = Math.ceil(((await lockSettings.getCooldownUntil()) - Date.now()) / 1000);
    setCooldown(left > 0 ? left : 0);
    setLocked(true);
    const useBio = (await lockSettings.bioEnabled()) && (await bioAvailable());
    setBio(useBio ? { label: await bioLabel() } : null);
    if (useBio && left <= 0) tryBio();
  }, [tryBio]);

  useEffect(() => {
    lockNow();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "background") bgAt.current = Date.now();
      if (st === "active" && bgAt.current && Date.now() - bgAt.current > RELOCK_MS) lockNow();
      if (st === "active") bgAt.current = null;
    });
    return () => sub.remove();
  }, [lockNow]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => {
      setCooldown((c) => {
        if (c <= 1) setError("");
        return c - 1;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onChange = async (v: string) => {
    setPin(v);
    setError("");
    if (v.length < PIN_LENGTH) return;
    if (await lockSettings.checkPin(v)) {
      setLocked(false);
      setPin("");
      setTries(0);
      lockSettings.setTries(0);
      lockSettings.setLockouts(0);
      return;
    }
    const n = tries + 1;
    setPin("");
    if (n >= MAX_TRIES) {
      // Espera creciente: 30 s, 60 s, 120 s… hasta 15 min.
      const lockouts = (await lockSettings.getLockouts()) + 1;
      const secs = Math.min(COOLDOWN_S * 2 ** (lockouts - 1), 900);
      lockSettings.setLockouts(lockouts);
      setTries(0);
      lockSettings.setTries(0);
      lockSettings.setCooldownUntil(Date.now() + secs * 1000);
      setCooldown(secs);
    } else {
      setTries(n);
      lockSettings.setTries(n);
      setError(`PIN incorrecto (${MAX_TRIES - n} intento${MAX_TRIES - n === 1 ? "" : "s"} más)`);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked !== false && (
        <View testID="lock-screen" style={[styles.overlay, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
          {locked && (
            <>
              <BrandLogo height={32} />
              <Text style={styles.title}>Ingresa tu PIN</Text>
              <Text style={styles.sub}>Tus casos están protegidos</Text>
              <PinPad
                value={pin}
                onChange={onChange}
                disabled={cooldown > 0}
                error={cooldown > 0 ? `Demasiados intentos. Espera ${cooldown} s.` : error}
                extra={bio ? { icon: bio.label === "huella" ? "finger-print-outline" : "scan-outline", label: `Usar ${bio.label}`, onPress: tryBio } : null}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, alignItems: "center", zIndex: 100 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl, marginTop: spacing.xl },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginTop: spacing.xs, marginBottom: spacing.xl },
});
