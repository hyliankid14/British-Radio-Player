const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withMod,
  withPodfileProperties,
  withXcodeProject
} = require("@expo/config-plugins");

// Native Swift files versioned in plugins/ios-native/ to be compiled into the app.
const SWIFT_DIR = path.join(__dirname, "ios-native");

// Diagnostic logging that used to be hand-added to the generated AppDelegate.swift.
const TRACE_LOG_LINE = /^[ \t]*NSLog\("=== BRP_TRACE[^\n]*\n/gm;

// The only functional delta that was hand-added to AppDelegate.swift: a DEBUG-only
// fallback so a Debug build still reaches Metro when RCTBundleURLProvider returns nil.
// Release builds use the embedded main.jsbundle and never take this branch.
const METRO_BUNDLE_CALL =
  'return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")';
const METRO_BUNDLE_FALLBACK =
  'URL(string: "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false")';

// CarPlay approval has been granted for com.hyliankid14.bbcradioplayer.
const ENABLE_CARPLAY = true;

// The generated pbxproj omits DEVELOPMENT_TEAM, and it is not derivable from the
// template, so it is re-applied here from expo.ios.appleTeamId.
function withDevelopmentTeam(config) {
  return withXcodeProject(config, (configWithProject) => {
    const appleTeamId = configWithProject.ios?.appleTeamId;
    if (!appleTeamId) return configWithProject;

    const project = configWithProject.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const buildConfiguration of Object.values(configurations || {})) {
      if (typeof buildConfiguration?.buildSettings?.PRODUCT_NAME !== "undefined") {
        buildConfiguration.buildSettings.DEVELOPMENT_TEAM = appleTeamId;
      }
    }
    return configWithProject;
  });
}

// This app only schedules local notifications (requestPermissionsAsync +
// scheduleNotificationAsync); it never registers for remote APNs push, so the
// aps-environment entitlement is not needed. expo-notifications adds it
// unconditionally, and the wildcard development provisioning profile on the build
// machine has no push capability, so leaving it in makes a device install
// un-signable. Remove it.
//
// Ordering: mods of the same type are nested and invoked in reverse registration
// order, so this plugin must be listed BEFORE "expo-notifications" in app.json for
// the deletion to run after the key is added. scripts/ios/build-ipa.sh asserts that
// aps-environment is absent so a future plugin reordering fails loudly.
function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    delete configWithEntitlements.modResults["aps-environment"];
    return configWithEntitlements;
  });
}

// Gated on the Apple grant above: requesting the capability before it exists on the
// account makes the app un-signable. scripts/ios/build-ipa.sh re-reads the generated
// entitlements file and refuses to export while this is on without the grant.
function withCarplayEntitlement(config) {
  if (!ENABLE_CARPLAY) return config;
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    configWithEntitlements.modResults["com.apple.developer.carplay-audio"] = true;
    return configWithEntitlements;
  });
}

// The native Swift files. Written to disk rather than modified through a
// pbxproj mod because custom delegates have no template equivalent.
function withIosNativeSources(config) {
  return withDangerousMod(config, [
    "ios",
    async (configWithModRequest) => {
      const { platformProjectRoot, projectName } = configWithModRequest.modRequest;
      const sourceRoot = path.join(platformProjectRoot, projectName);

      // Copy all versioned Swift files into the native app directory
      const swiftFiles = (await fs.promises.readdir(SWIFT_DIR)).filter((f) =>
        f.endsWith(".swift")
      );
      for (const file of swiftFiles) {
        await fs.promises.copyFile(
          path.join(SWIFT_DIR, file),
          path.join(sourceRoot, file)
        );
      }

      const appDelegatePath = path.join(sourceRoot, "AppDelegate.swift");
      let appDelegate = await fs.promises.readFile(appDelegatePath, "utf8");
      appDelegate = appDelegate.replace(TRACE_LOG_LINE, "");

      if (!appDelegate.includes("localhost:8081/.expo/.virtual-metro-entry.bundle")) {
        const patched = appDelegate.replace(
          METRO_BUNDLE_CALL,
          `${METRO_BUNDLE_CALL}\n      ?? ${METRO_BUNDLE_FALLBACK}`
        );
        if (patched === appDelegate) {
          console.warn(
            "[withIosNative] Could not find the Expo template bundleURL DEBUG branch. " +
              "The local Metro fallback was not applied; Debug builds may need Metro " +
              "started via `npm run ios:dev`."
          );
        }
        appDelegate = patched;
      }

      await fs.promises.writeFile(appDelegatePath, appDelegate);
      return configWithModRequest;
    }
  ]);
}

function withNativeSwiftInProject(config) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const { projectName } = configWithProject.modRequest;
    const groupKey = project.findPBXGroupKey({ name: projectName });
    const target = project.getFirstTarget();

    const swiftFiles = fs.readdirSync(SWIFT_DIR).filter((f) => f.endsWith(".swift"));
    for (const file of swiftFiles) {
      const relativePath = `${projectName}/${file}`;
      if (!project.hasFile(relativePath)) {
        project.addSourceFile(
          relativePath,
          target ? { target: target.uuid } : {},
          groupKey
        );
      }
    }

    return configWithProject;
  });
}

// Scene manifests. Supports both the standard phone UIWindowScene and the CarPlay
// CPTemplateApplicationScene concurrently.
function withSceneManifests(config) {
  return withInfoPlist(config, (configWithInfoPlist) => {
    const existing = configWithInfoPlist.modResults.UIApplicationSceneManifest ?? {};
    const scenes = existing.UISceneConfigurations ?? {};

    scenes.UIWindowSceneSessionRoleApplication = [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate"
      }
    ];

    if (ENABLE_CARPLAY) {
      scenes.CPTemplateApplicationSceneSessionRoleApplication = [
        {
          UISceneClassName: "CPTemplateApplicationScene",
          UISceneConfigurationName: "CarPlay",
          UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate"
        }
      ];
    }

    configWithInfoPlist.modResults.UIApplicationSceneManifest = {
      ...existing,
      UIApplicationSupportsMultipleScenes: ENABLE_CARPLAY ? true : (existing.UIApplicationSupportsMultipleScenes ?? false),
      UISceneConfigurations: scenes
    };

    return configWithInfoPlist;
  });
}

// Hand-set in the generated Podfile.properties.json, which is also wiped by
// `--clean`. The Podfile reads it to force Expo modules to build from source instead
// of using precompiled binaries, which is the configuration the working builds used.
function withPodfilePropertiesOverrides(config) {
  return withPodfileProperties(config, (configWithPodfileProperties) => {
    configWithPodfileProperties.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return configWithPodfileProperties;
  });
}

// The stock "Bundle React Native code and images" phase ends with a broken
// backtick line that resolves react-native/package.json from Xcode's build
// working directory, where it cannot be found, and never actually runs the
// bundler. In Debug the phase short-circuits via SKIP_BUNDLING, so this only
// breaks Release device builds. Replace the phase with an explicit call to
// react-native-xcode.sh, anchored to PROJECT_ROOT so it works from any build
// directory and any project path (including one with spaces).
//
// This runs as a "finalized" mod (last precedence) and patches the project file
// as raw text on disk. Going through the xcode object model instead corrupts the
// pbxproj, because the library's shell-phase builder and the file writer disagree
// on how to escape an embedded script string.
const BUNDLE_SCRIPT_BODY = [
  'if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then source "$PODS_ROOT/../.xcode.env"; fi',
  'if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then source "$PODS_ROOT/../.xcode.env.local"; fi',
  'export PROJECT_ROOT="$PROJECT_DIR"/..',
  'cd "$PROJECT_ROOT"',
  'if [[ "$CONFIGURATION" = *Debug* ]]; then export SKIP_BUNDLING=1; fi',
  'if [[ -z "$ENTRY_FILE" ]]; then',
  '  export ENTRY_FILE="$("$NODE_BINARY" -e "require(\'expo/scripts/resolveAppEntry\')" "$PROJECT_ROOT" ios absolute | tail -n 1)"',
  'fi',
  'if [[ -z "$CLI_PATH" ]]; then',
  '  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve(\'@expo/cli\', { paths: [require.resolve(\'expo/package.json\')] })")"',
  'fi',
  'if [[ -z "$BUNDLE_COMMAND" ]]; then export BUNDLE_COMMAND="export:embed"; fi',
  'if [[ -f "$PODS_ROOT/../.xcode.env.updates" ]]; then source "$PODS_ROOT/../.xcode.env.updates"; fi',
  'RN_SCRIPT="$("$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'")"',
  'exec /bin/sh "$RN_SCRIPT"',
].join("\\n");

// Serialize a multi-line script as a single-line pbxproj string value. Real
// newlines become the two-character escape \n (matching how the stock phase is
// written), and inner double quotes are backslash-escaped. Backslashes are NOT
// doubled, otherwise each \n becomes \\n and the shell receives a literal "\n"
// instead of a line break.
function pbxprojQuote(script) {
  return (
    '"' +
    script.replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n") +
    '"'
  );
}

function withFixedBundlePhase(config) {
  return withMod(config, {
    platform: "ios",
    mod: "finalized",
    async action(configWithModRequest) {
      const projectRoot = configWithModRequest.modRequest.platformProjectRoot;
      const { projectName } = configWithModRequest.modRequest;
      const pbxprojPath = path.join(
        projectRoot,
        `${projectName}.xcodeproj`,
        "project.pbxproj"
      );

      if (!fs.existsSync(pbxprojPath)) return configWithModRequest;
      const original = await fs.promises.readFile(pbxprojPath, "utf8");
      if (original.includes("exec /bin/sh")) return configWithModRequest;

      // The generated pbxproj stores the whole script as a single quoted line with
      // \n escapes, so replace that line wholesale rather than a fragment inside
      // the quoted value.
      const lines = original.split("\n");
      const index = lines.findIndex(
        (line) => line.includes("shellScript = ") && line.includes("react-native-xcode.sh")
      );
      if (index === -1) {
        console.warn(
          "[withIosNative] Could not locate the React Native bundle invocation in the" +
            " Xcode project; the Release bundling phase was left unchanged."
        );
        return configWithModRequest;
      }

      const indent = (lines[index].match(/^\s*/) || [""])[0];
      lines[index] = `${indent}shellScript = ${pbxprojQuote(BUNDLE_SCRIPT_BODY)};`;

      await fs.promises.writeFile(pbxprojPath, lines.join("\n"), "utf8");
      return configWithModRequest;
    },
  });
}

module.exports = function withIosNative(config) {
  config = withIosNativeSources(config);
  config = withNativeSwiftInProject(config);
  config = withSceneManifests(config);
  config = withDevelopmentTeam(config);
  config = withFixedBundlePhase(config);
  config = withCarplayEntitlement(config);
  // Runs last so it also clears aps-environment that expo-notifications may add.
  config = withoutPushEntitlement(config);
  return withPodfilePropertiesOverrides(config);
};
