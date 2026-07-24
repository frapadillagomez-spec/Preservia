import { Redirect } from "expo-router";

// The welcome screen is shown every time the app is opened.
export default function Index() {
  return <Redirect href="/welcome" />;
}
