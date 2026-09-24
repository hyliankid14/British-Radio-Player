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

    // Try common Android content URIs via Linking before showing alert
    const contentUris = [
      "content://com.android.externalstorage.documents/document/primary%3APodcasts%2FBritish%20Radio%20Player",
      "content://com.android.externalstorage.documents/tree/primary%3APodcasts%2FBritish%20Radio%20Player"
    ];
    for (const uri of contentUris) {
      try {
        if (await Linking.canOpenURL(uri)) {
          await Linking.openURL(uri);
          return;
        }
      } catch {
        // continue to next URI or fallback
      }
    }

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
