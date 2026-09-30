const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject
} = require("@expo/config-plugins");

// Native iOS widget files, versioned alongside the CarPlay sources in plugins/ios-native/.
// Shared/ is compiled into both the app and the widget extension, AppOnly/ only into the app,
// and Extension/ only into the extension.
const WIDGET_DIR = path.join(__dirname, "ios-widget");
const APP_ONLY_DIR = path.join(WIDGET_DIR, "AppOnly");
const EXTENSION_DIR = path.join(WIDGET_DIR, "Extension");
const SHARED_DIR = path.join(WIDGET_DIR, "Shared");

const TARGET_NAME = "BRPWidget";
const TARGET_SUBFOLDER = "BRPWidget";
const TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.widget";

/**
 * Must match WidgetSharedState.appGroupIdentifier and the app entitlements below.
 *
 * A widget extension runs in its own process and can only read what the app put in a shared
 * container, so this group is what makes a home screen widget possible at all. It has to be
 * registered on the developer account for com.hyliankid14.bbcradioplayer; Xcode then issues a
 * provisioning profile that carries it (scripts/ios/build-ipa.sh signs with
 * -allowProvisioningUpdates).
 */
const APP_GROUP_ID = "group.com.hyliankid14.bbcradioplayer";

// WidgetKit bundles cannot branch on OS version, so the extension declares iOS 17: that is
// where a widget first became configurable per instance, which is the whole point here.
// The app itself keeps its own deployment target, so iOS 16 still runs the app, just with
// no home screen widget.
const WIDGET_DEPLOYMENT_TARGET = "17.0";
const SWIFT_VERSION = "5.0";

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(extension)).sort();
}

/**
 * Copies the Swift sources and the extension's Info.plist and entitlements into the
 * generated project. An app extension has no template equivalent, so the files are written
 * rather than adapted; the pbxproj mod below is what compiles and embeds them.
 */
function withWidgetSources(config) {
  return withDangerousMod(config, [
    "ios",
    async (configWithModRequest) => {
      const { platformProjectRoot, projectName } = configWithModRequest.modRequest;
      const appTargetRoot = path.join(platformProjectRoot, projectName);
      const extensionTargetRoot = path.join(platformProjectRoot, TARGET_SUBFOLDER);

      await fs.promises.mkdir(extensionTargetRoot, { recursive: true });

      // Shared code: the app writes the state and the extension reads it. Copied into both
      // target directories and compiled into each, because a widget extension is a separate
      // binary from the app.
      for (const name of listFiles(SHARED_DIR, ".swift")) {
        await fs.promises.copyFile(
          path.join(SHARED_DIR, name),
          path.join(appTargetRoot, name)
        );
        await fs.promises.copyFile(
          path.join(SHARED_DIR, name),
          path.join(extensionTargetRoot, name)
        );
      }

      // App-only code. Kept next to the other app sources rather than in the extension
      // directory, so nothing in the appex can reach for it.
      for (const name of listFiles(APP_ONLY_DIR, ".swift")) {
        await fs.promises.copyFile(
          path.join(APP_ONLY_DIR, name),
          path.join(appTargetRoot, name)
        );
      }

      // Extension-only code, plus the resources that define the appex bundle.
      for (const name of fs.readdirSync(EXTENSION_DIR)) {
        await fs.promises.copyFile(
          path.join(EXTENSION_DIR, name),
          path.join(extensionTargetRoot, name)
        );
      }

      return configWithModRequest;
    }
  ]);
}

/**
 * Reads the app target's marketing version and build number so the extension matches them.
 * An appex whose version differs from its host app is rejected at submission.
 */
function resolveVersions(project, appTarget) {
  const configurations = project.pbxXCBuildConfigurationSection();
  const list = project.pbxXCConfigurationList()[appTarget.buildConfigurationList];
  const versions = {};
  for (const entry of list?.buildConfigurations ?? []) {
    const settings = configurations[entry.value]?.buildSettings;
    if (!settings) continue;
    if (settings.MARKETING_VERSION) versions.marketing = settings.MARKETING_VERSION;
    if (settings.CURRENT_PROJECT_VERSION) versions.build = settings.CURRENT_PROJECT_VERSION;
  }
  return versions;
}

/**
 * Creates the app extension target.
 *
 * `addTarget` also creates the "Copy Files" phase that embeds the appex in the app, adds the
 * target dependency and registers the product, so this only has to add the sources and the
 * settings specific to this extension.
 */
function withWidgetTarget(config) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const { projectName } = configWithProject.modRequest;

    // A prebuild that has already run this plugin leaves the target in place.
    if (project.pbxTargetByName(TARGET_NAME)) return configWithProject;

    const appTargetEntry = project.getFirstTarget();
    const appTarget = appTargetEntry?.firstTarget;
    if (!appTarget) {
      console.warn("[withIosWidget] No application target; the widget extension was not added.");
      return configWithProject;
    }

    const versions = resolveVersions(project, appTarget);

    const widgetTarget = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_SUBFOLDER,
      TARGET_BUNDLE_ID
    );

    // `addTarget` creates the target but none of the build phases a target needs, and the
    // pbxproj helpers fall back to the first phase of the same kind anywhere in the project.
    // Without these, the extension's sources would be compiled into the app instead.
    for (const phase of ["Sources", "Frameworks", "Resources"]) {
      project.addBuildPhase([], `PBX${phase}BuildPhase`, phase, widgetTarget.uuid);
    }

    const buildSettings = {
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${TARGET_SUBFOLDER}/${TARGET_NAME}.entitlements`,
      CURRENT_PROJECT_VERSION: versions.build || "1",
      ENABLE_BITCODE: "NO",
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${TARGET_SUBFOLDER}/${TARGET_NAME}-Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: WIDGET_DEPLOYMENT_TARGET,
      // Written as an array because the pbxproj writer emits bare strings verbatim, and a
      // runpath list has to be a list to be readable by Xcode and CocoaPods.
      LD_RUNPATH_SEARCH_PATHS: [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"'
      ],
      MARKETING_VERSION: versions.marketing || "1.0",
      PRODUCT_BUNDLE_IDENTIFIER: TARGET_BUNDLE_ID,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: "YES",
      SWIFT_VERSION,
      TARGETED_DEVICE_FAMILY: '"1,2"'
    };

    const widgetList = project.pbxXCConfigurationList()[widgetTarget.pbxNativeTarget.buildConfigurationList];
    const widgetConfigurations = new Set((widgetList?.buildConfigurations ?? []).map((c) => c.value));
    const allConfigurations = project.pbxXCBuildConfigurationSection();
    for (const [uuid, configuration] of Object.entries(allConfigurations)) {
      if (uuid.endsWith("_comment") || !widgetConfigurations.has(uuid)) continue;
      Object.assign(configuration.buildSettings, buildSettings);
    }

    // Sources the extension and the app do not already share, so they are compiled here rather
    // than by withIosNative, which only picks up files versioned in plugins/ios-native.
    const appGroupKey = project.findPBXGroupKey({ name: projectName });
    for (const name of [
      ...listFiles(SHARED_DIR, ".swift"),
      ...listFiles(APP_ONLY_DIR, ".swift")
    ]) {
      const relativePath = `${projectName}/${name}`;
      if (!project.hasFile(relativePath)) {
        project.addSourceFile(relativePath, { target: appTargetEntry.uuid }, appGroupKey);
      }
    }

    const extensionGroupKey = project.addPbxGroup([], TARGET_SUBFOLDER, TARGET_SUBFOLDER);
    for (const name of [
      ...listFiles(SHARED_DIR, ".swift"),
      ...listFiles(EXTENSION_DIR, ".swift")
    ]) {
      project.addSourceFile(
        `${TARGET_SUBFOLDER}/${name}`,
        { target: widgetTarget.uuid },
        extensionGroupKey.uuid
      );
    }

    return configWithProject;
  });
}

/**
 * The app and the extension have to agree on the App Group or the widget reads nothing.
 * The extension's copy is a file written by this plugin; this is the app's.
 */
function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    const groups = configWithEntitlements.modResults["com.apple.security.application-groups"] ?? [];
    if (!groups.includes(APP_GROUP_ID)) {
      configWithEntitlements.modResults["com.apple.security.application-groups"] = [
        ...groups,
        APP_GROUP_ID
      ];
    }
    return configWithEntitlements;
  });
}

module.exports = function withIosWidget(config) {
  config = withWidgetSources(config);
  config = withWidgetTarget(config);
  return withAppGroupEntitlement(config);
};
