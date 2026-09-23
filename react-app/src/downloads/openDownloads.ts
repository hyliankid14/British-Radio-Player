import { Alert, Linking, Platform } from "react-native";
import { NativeAndroid } from "../native/nativeAndroid";

/**
 * Opens the OS view of the folder where downloaded episodes are stored.
 *
 * - Android: the public `Podcasts/British Radio Player` folder via the system file manager.
 * - iOS: the Files app, where the app's Documents folder is listed (file sharing enabled).
 */
export async function openDownloadsFolder(): Promise<void> {
  if (Platform.OS === "android") {
    if (NativeAndroid.openDownloadsFolder()) return;
    const path = NativeAndroid.getDownloadsFolderPath() ?? "Podcasts/British Radio Player";
    Alert.alert(
      "Downloads folder",
      `Downloaded episodes are stored at:\n\n${path}\n\nOpen this path in your file manager to view them.`
    );
    return;
  }

  try {
    await Linking.openURL("shareddocuments://");
  } catch {
    Alert.alert(
      "Downloads",
      "Open the Files app and browse On My iPhone › British Radio Player to find your downloads."
    );
  }
}
