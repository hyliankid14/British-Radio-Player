# React Native app

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
