// Icon font loader. Fonts are loaded from a CDN only under Expo Go
// (StoreClient), where bundled .ttf assets can come back empty on Android.
// Native dev/prod builds and web pass an empty map, so useFonts resolves
// immediately (the @react-native-vector-icons config plugin bundles the font).
// IONICONS_VERSION must match @react-native-vector-icons/ionicons in package.json.
// Usage: const [loaded, error] = useIconFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

const IONICONS_VERSION = "14.0.0";

const iconFontMap = (): Record<string, string> => ({
  Ionicons: `https://cdn.jsdelivr.net/npm/@react-native-vector-icons/ionicons@${IONICONS_VERSION}/fonts/Ionicons.ttf`,
});

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? iconFontMap()
      : {},
  );
