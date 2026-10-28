// Ajustes del bloqueo con PIN / biometría.
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";

import { storage } from "@/src/utils/storage";

const ENABLED_KEY = "lock_enabled";
const BIO_KEY = "lock_bio";
const PIN_KEY = "lock_pin_hash";
const SALT_KEY = "lock_pin_salt";
const TRIES_KEY = "lock_tries";
const COOLDOWN_KEY = "lock_cooldown_until";
export const PIN_LENGTH = 4;
/** Tiempo en segundo plano tras el cual se vuelve a pedir el PIN. */
export const RELOCK_MS = 60 * 1000;

const hash = (pin: string, salt: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);

export const lockSettings = {
  isEnabled: async () => (await storage.getItem<boolean>(ENABLED_KEY, false)) === true,
  bioEnabled: async () => (await storage.getItem<boolean>(BIO_KEY, false)) === true,
  setBio: (v: boolean) => storage.setItem(BIO_KEY, v),
  checkPin: async (pin: string) => {
    const salt = (await storage.secureGet<string>(SALT_KEY, "")) || "";
    const saved = await storage.secureGet<string>(PIN_KEY, "");
    if (!saved) {
      // Migración: versiones previas guardaban el PIN sin cifrar.
      const legacy = await storage.secureGet<string>("lock_pin", "");
      if (legacy && legacy === pin) {
        await lockSettings.enable(pin);
        await storage.secureRemove("lock_pin");
        return true;
      }
      return false;
    }
    return saved === (await hash(pin, salt));
  },
  enable: async (pin: string) => {
    const salt = Crypto.randomUUID();
    await storage.secureSet(SALT_KEY, salt);
    await storage.secureSet(PIN_KEY, await hash(pin, salt));
    await storage.setItem(ENABLED_KEY, true);
  },
  disable: async () => {
    await storage.setItem(ENABLED_KEY, false);
    await storage.setItem(BIO_KEY, false);
    await storage.secureRemove(PIN_KEY);
    await storage.secureRemove(SALT_KEY);
  },
  // Intentos fallidos y bloqueo temporal persistentes (no se reinician al reabrir la app).
  getTries: async () => (await storage.getItem<number>(TRIES_KEY, 0)) || 0,
  setTries: (n: number) => storage.setItem(TRIES_KEY, n),
  getCooldownUntil: async () => (await storage.getItem<number>(COOLDOWN_KEY, 0)) || 0,
  setCooldownUntil: (t: number) => storage.setItem(COOLDOWN_KEY, t),
  getLockouts: async () => (await storage.getItem<number>("lock_lockouts", 0)) || 0,
  setLockouts: (n: number) => storage.setItem("lock_lockouts", n),
};

/** ¿El dispositivo tiene Face ID / huella configurado? */
export async function bioAvailable() {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function bioLabel() {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "huella";
  } catch {
    /* sin biometría */
  }
  return "biometría";
}

export async function authenticateBio() {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloquear Preservia",
      cancelLabel: "Usar PIN",
      disableDeviceFallback: true,
    });
    return r.success;
  } catch {
    return false;
  }
}
