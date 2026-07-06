import { useFonts } from "expo-font";

// Loads Geist + Geist Mono static weights from local assets.
export const useAppFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    "Geist-400": require("../../assets/fonts/Geist-400.ttf"),
    "Geist-500": require("../../assets/fonts/Geist-500.ttf"),
    "Geist-600": require("../../assets/fonts/Geist-600.ttf"),
    "Geist-700": require("../../assets/fonts/Geist-700.ttf"),
    "GeistMono-400": require("../../assets/fonts/GeistMono-400.ttf"),
    "GeistMono-500": require("../../assets/fonts/GeistMono-500.ttf"),
    "GeistMono-600": require("../../assets/fonts/GeistMono-600.ttf"),
  });
