# React Native app

The React app uses Track Player for phone playback and includes a native
Android Auto media-browser bridge. Android Auto exposes the BBC stations
through the car launcher and the bridge starts playback independently of the
React activity.

## Build a standalone Android debug APK

From this directory:

```sh
npm run build:android:debug
```

The script generates the native project, bundles the JavaScript into the
debug build, and writes
`~/Downloads/british-radio-player-react-debug.apk`. Set `DOWNLOADS_DIR` to
override the destination. The default build targets modern 64-bit Android
devices (`arm64-v8a`) and compresses native libraries; set
`REACT_NATIVE_ARCHITECTURES=armeabi-v7a,arm64-v8a` when a universal ARM APK is
needed.

## Run on the iOS simulator

From this directory, use:

```sh
npm install
npm run ios:simulator
```

This opens the Simulator, builds and installs the Debug app, and starts Metro
on port 8081. The script accepts the normal Expo iOS options, for example:

```sh
npm run ios:simulator -- --device "iPhone 17 Pro"
```

If the app is launched directly from Xcode, Metro must be started separately:

```sh
npm run ios:dev
```

Leave that command running while using the Debug app. The simulator should
then be able to load `http://localhost:8081/.expo/.virtual-metro-entry.bundle`.

For a build that does not require Metro, select the `Release` configuration in
Xcode or run:

```sh
npx expo run:ios --configuration Release
```
