let platformOS: string = "unknown";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  platformOS = require("react-native").Platform?.OS ?? "unknown";
} catch {
  // Pure node / test environment
}

function resolveAsset(loader: () => any, fallbackId: string): any {
  try {
    return loader();
  } catch {
    return `ident:${fallbackId}`;
  }
}

/**
 * Pre-bundled custom station ident asset loaders for offline / iOS / fallback use.
 */
export const STATION_IDENT_ASSETS: Record<string, () => any> = {
  "1xtra": () => require("../../assets/idents/1xtra.png"),
  "asiannetwork": () => require("../../assets/idents/asiannetwork.png"),
  "radio1": () => require("../../assets/idents/radio1.png"),
  "radio1anthems": () => require("../../assets/idents/radio1anthems.png"),
  "radio1dance": () => require("../../assets/idents/radio1dance.png"),
  "radio2": () => require("../../assets/idents/radio2.png"),
  "radio3": () => require("../../assets/idents/radio3.png"),
  "radio3unwind": () => require("../../assets/idents/radio3unwind.png"),
  "radio4": () => require("../../assets/idents/radio4.png"),
  "radio4extra": () => require("../../assets/idents/radio4extra.png"),
  "radio5live": () => require("../../assets/idents/radio5live.png"),
  "radio5livesportsextra": () => require("../../assets/idents/radio5livesportsextra.png"),
  "radio5livesportsextra2": () => require("../../assets/idents/radio5livesportsextra2.png"),
  "radio5livesportsextra3": () => require("../../assets/idents/radio5livesportsextra3.png"),
  "radio6": () => require("../../assets/idents/radio6.png"),
  "radio6indieforever": () => require("../../assets/idents/radio6indieforever.png"),
  "radioberkshire": () => require("../../assets/idents/radioberkshire.png"),
  "radiobristol": () => require("../../assets/idents/radiobristol.png"),
  "radiocambridge": () => require("../../assets/idents/radiocambridge.png"),
  "radiocornwall": () => require("../../assets/idents/radiocornwall.png"),
  "radiocoventrywarwickshire": () => require("../../assets/idents/radiocoventrywarwickshire.png"),
  "radiocumbria": () => require("../../assets/idents/radiocumbria.png"),
  "radiocymru": () => require("../../assets/idents/radiocymru.png"),
  "radiocymru2": () => require("../../assets/idents/radiocymru2.png"),
  "radioderby": () => require("../../assets/idents/radioderby.png"),
  "radiodevon": () => require("../../assets/idents/radiodevon.png"),
  "radioessex": () => require("../../assets/idents/radioessex.png"),
  "radiofoyle": () => require("../../assets/idents/radiofoyle.png"),
  "radiogaidheal": () => require("../../assets/idents/radiogaidheal.png"),
  "radiogloucestershire": () => require("../../assets/idents/radiogloucestershire.png"),
  "radioguernsey": () => require("../../assets/idents/radioguernsey.png"),
  "radioherefordworcester": () => require("../../assets/idents/radioherefordworcester.png"),
  "radiohumberside": () => require("../../assets/idents/radiohumberside.png"),
  "radiojersey": () => require("../../assets/idents/radiojersey.png"),
  "radiokent": () => require("../../assets/idents/radiokent.png"),
  "radiolancashire": () => require("../../assets/idents/radiolancashire.png"),
  "radioleeds": () => require("../../assets/idents/radioleeds.png"),
  "radioleicester": () => require("../../assets/idents/radioleicester.png"),
  "radiolincolnshire": () => require("../../assets/idents/radiolincolnshire.png"),
  "radiolon": () => require("../../assets/idents/radiolon.png"),
  "radiomanchester": () => require("../../assets/idents/radiomanchester.png"),
  "radiomerseyside": () => require("../../assets/idents/radiomerseyside.png"),
  "radionewcastle": () => require("../../assets/idents/radionewcastle.png"),
  "radionorfolk": () => require("../../assets/idents/radionorfolk.png"),
  "radionorthampton": () => require("../../assets/idents/radionorthampton.png"),
  "radionottingham": () => require("../../assets/idents/radionottingham.png"),
  "radioorkney": () => require("../../assets/idents/radioorkney.png"),
  "radiooxford": () => require("../../assets/idents/radiooxford.png"),
  "radioscotland": () => require("../../assets/idents/radioscotland.png"),
  "radioscotlandextra": () => require("../../assets/idents/radioscotlandextra.png"),
  "radiosheffield": () => require("../../assets/idents/radiosheffield.png"),
  "radioshetland": () => require("../../assets/idents/radioshetland.png"),
  "radioshropshire": () => require("../../assets/idents/radioshropshire.png"),
  "radiosolent": () => require("../../assets/idents/radiosolent.png"),
  "radiosolentwestdorset": () => require("../../assets/idents/radiosolentwestdorset.png"),
  "radiosomerset": () => require("../../assets/idents/radiosomerset.png"),
  "radiostoke": () => require("../../assets/idents/radiostoke.png"),
  "radiosuffolk": () => require("../../assets/idents/radiosuffolk.png"),
  "radiosurrey": () => require("../../assets/idents/radiosurrey.png"),
  "radiosussex": () => require("../../assets/idents/radiosussex.png"),
  "radiotees": () => require("../../assets/idents/radiotees.png"),
  "radiothreecounties": () => require("../../assets/idents/radiothreecounties.png"),
  "radioulster": () => require("../../assets/idents/radioulster.png"),
  "radiowales": () => require("../../assets/idents/radiowales.png"),
  "radiowalesextra": () => require("../../assets/idents/radiowalesextra.png"),
  "radiowestmidlands": () => require("../../assets/idents/radiowestmidlands.png"),
  "radiowiltshire": () => require("../../assets/idents/radiowiltshire.png"),
  "radioyork": () => require("../../assets/idents/radioyork.png"),
  "worldservice": () => require("../../assets/idents/worldservice.png"),
  "livenews": () => require("../../assets/idents/livenews.png"),
};

/**
 * Resolves the custom ident artwork for a station to be used in playback notifications.
 * On Android, prefers the native on-device content:// URI served via StationIdentProvider
 * to allow SystemUI (Samsung One UI, Pixel) and media notification to access the bitmap across processes.
 * Falls back to bundled image assets.
 */
export function getStationIdentArtwork(stationId: string): any {
  if (platformOS === "android") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeAndroid } = require("../native/nativeAndroid");
      const nativeUri = NativeAndroid.getStationIdentUri(stationId);
      if (nativeUri) return nativeUri;
    } catch {
      // Degrade to bundled asset if native module is not available
    }
  }
  const loader = STATION_IDENT_ASSETS[stationId];
  return loader ? resolveAsset(loader, stationId) : undefined;
}
