const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject
} = require("@expo/config-plugins");

const WATCH_DIR = path.join(__dirname, "watchos");
const WATCH_APP_DIR = path.join(WATCH_DIR, "App");
const WATCH_SCREENS_DIR = path.join(WATCH_DIR, "Screens");
const WATCH_PLAYBACK_DIR = path.join(WATCH_DIR, "Playback");
const WATCH_SYNC_DIR = path.join(WATCH_DIR, "Sync");
const WATCH_COMPLICATIONS_DIR = path.join(WATCH_DIR, "Complications");
const WIDGET_SHARED_DIR = path.join(__dirname, "ios-widget", "Shared");

const WATCH_TARGET_NAME = "BRPWatch";
const WATCH_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.watch";
const COMPLICATIONS_TARGET_NAME = "BRPWatchComplications";
const COMPLICATIONS_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.watchcomplications";
const APP_GROUP_ID = "group.com.hyliankid14.bbcradioplayer";
const WATCHOS_DEPLOYMENT_TARGET = "10.0";
const SWIFT_VERSION = "5.0";

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(extension)).sort();
}

function withWatchOSSources(config) {
  return withDangerousMod(config, [
    "ios",
    async (configWithModRequest) => {
      const { platformProjectRoot } = configWithModRequest.modRequest;
      const watchTargetRoot = path.join(platformProjectRoot, WATCH_TARGET_NAME);
      const compTargetRoot = path.join(platformProjectRoot, COMPLICATIONS_TARGET_NAME);

      await fs.promises.mkdir(watchTargetRoot, { recursive: true });
      await fs.promises.mkdir(compTargetRoot, { recursive: true });

      // Copy BRPWatch sources
      const watchDirs = [WATCH_APP_DIR, WATCH_SCREENS_DIR, WATCH_PLAYBACK_DIR, WATCH_SYNC_DIR];
      for (const dir of watchDirs) {
        for (const name of listFiles(dir, ".swift")) {
          await fs.promises.copyFile(
            path.join(dir, name),
            path.join(watchTargetRoot, name)
          );
        }
      }

      await fs.promises.copyFile(
        path.join(WATCH_DIR, "BRPWatch-Info.plist"),
        path.join(watchTargetRoot, "BRPWatch-Info.plist")
      );
      await fs.promises.copyFile(
        path.join(WATCH_DIR, "BRPWatch.entitlements"),
        path.join(watchTargetRoot, "BRPWatch.entitlements")
      );

      // Copy Complications sources
      for (const name of listFiles(WATCH_COMPLICATIONS_DIR, ".swift")) {
        await fs.promises.copyFile(
          path.join(WATCH_COMPLICATIONS_DIR, name),
          path.join(compTargetRoot, name)
        );
      }

      // Copy WidgetSharedState to Complications
      if (fs.existsSync(path.join(WIDGET_SHARED_DIR, "WidgetSharedState.swift"))) {
        await fs.promises.copyFile(
          path.join(WIDGET_SHARED_DIR, "WidgetSharedState.swift"),
          path.join(compTargetRoot, "WidgetSharedState.swift")
        );
      }

      await fs.promises.copyFile(
        path.join(WATCH_DIR, "BRPWatchComplications-Info.plist"),
        path.join(compTargetRoot, "BRPWatchComplications-Info.plist")
      );
      await fs.promises.copyFile(
        path.join(WATCH_DIR, "BRPWatchComplications.entitlements"),
        path.join(compTargetRoot, "BRPWatchComplications.entitlements")
      );

      return configWithModRequest;
    }
  ]);
}

function resolveVersions(project, appTarget, config) {
  const versions = {
    marketing: config?.version || "1.0",
    build: config?.ios?.buildNumber || config?.version || "1"
  };
  const configurations = project.pbxXCBuildConfigurationSection();
  const list = project.pbxXCConfigurationList()[appTarget.buildConfigurationList];
  for (const entry of list?.buildConfigurations ?? []) {
    const settings = configurations[entry.value]?.buildSettings;
    if (!settings) continue;
    if (settings.MARKETING_VERSION) versions.marketing = settings.MARKETING_VERSION;
    if (settings.CURRENT_PROJECT_VERSION) versions.build = settings.CURRENT_PROJECT_VERSION;
  }
  if (config?.version) versions.marketing = config.version;
  if (config?.ios?.buildNumber) versions.build = config.ios.buildNumber;
  return versions;
}

function withWatchOSTarget(config) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const { projectName } = configWithProject.modRequest;

    const appTargetEntry = project.getFirstTarget();
    const appTarget = appTargetEntry?.firstTarget;
    if (!appTarget) {
      console.warn("[withWatchOS] No application target; the watch extension was not added.");
      return configWithProject;
    }

    const versions = resolveVersions(project, appTarget, config);

    if (!project.hash.project.objects["PBXTargetDependency"]) {
      project.hash.project.objects["PBXTargetDependency"] = {};
    }
    if (!project.hash.project.objects["PBXContainerItemProxy"]) {
      project.hash.project.objects["PBXContainerItemProxy"] = {};
    }

    // Setup Watch Target
    const existingWatchTarget = project.pbxTargetByName(WATCH_TARGET_NAME);
    let watchTargetUuid;
    if (!existingWatchTarget) {
      const watchTarget = project.addTarget(
        WATCH_TARGET_NAME,
        "watch2_app",
        WATCH_TARGET_NAME,
        WATCH_TARGET_BUNDLE_ID
      );
      watchTargetUuid = watchTarget.uuid;

      project.addTargetDependency(appTargetEntry.uuid, [watchTarget.uuid]);

      for (const phase of ["Sources", "Frameworks", "Resources"]) {
        project.addBuildPhase([], `PBX${phase}BuildPhase`, phase, watchTarget.uuid);
      }

      const watchBuildSettings = {
        SDKROOT: "watchos",
        WATCHOS_DEPLOYMENT_TARGET: WATCHOS_DEPLOYMENT_TARGET,
        TARGETED_DEVICE_FAMILY: '"4"',
        SWIFT_VERSION: SWIFT_VERSION,
        PRODUCT_BUNDLE_IDENTIFIER: WATCH_TARGET_BUNDLE_ID,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        MARKETING_VERSION: versions.marketing || "1.0",
        CURRENT_PROJECT_VERSION: versions.build || "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${WATCH_TARGET_NAME}/${WATCH_TARGET_NAME}-Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${WATCH_TARGET_NAME}/${WATCH_TARGET_NAME}.entitlements`,
        ENABLE_BITCODE: "NO",
        SKIP_INSTALL: "NO",
        LD_RUNPATH_SEARCH_PATHS: [
          '"$(inherited)"',
          '"@executable_path/Frameworks"'
        ],
        ...(config?.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {})
      };

      const watchList = project.pbxXCConfigurationList()[watchTarget.pbxNativeTarget.buildConfigurationList];
      const watchConfigurations = new Set((watchList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !watchConfigurations.has(uuid)) continue;
        Object.assign(configuration.buildSettings, watchBuildSettings);
      }

      const watchGroupKey = project.addPbxGroup([], WATCH_TARGET_NAME, WATCH_TARGET_NAME);
      const watchDirs = [WATCH_APP_DIR, WATCH_SCREENS_DIR, WATCH_PLAYBACK_DIR, WATCH_SYNC_DIR];
      for (const dir of watchDirs) {
        for (const name of listFiles(dir, ".swift")) {
          project.addSourceFile(
            `${WATCH_TARGET_NAME}/${name}`,
            { target: watchTarget.uuid },
            watchGroupKey.uuid
          );
        }
      }
    } else {
      watchTargetUuid = existingWatchTarget.uuid;
    }

    // Setup Complications Target
    if (!project.pbxTargetByName(COMPLICATIONS_TARGET_NAME)) {
      const compTarget = project.addTarget(
        COMPLICATIONS_TARGET_NAME,
        "app_extension",
        COMPLICATIONS_TARGET_NAME,
        COMPLICATIONS_TARGET_BUNDLE_ID
      );

      project.addTargetDependency(watchTargetUuid, [compTarget.uuid]);

      for (const phase of ["Sources", "Frameworks", "Resources"]) {
        project.addBuildPhase([], `PBX${phase}BuildPhase`, phase, compTarget.uuid);
      }

      const compBuildSettings = {
        SDKROOT: "watchos",
        WATCHOS_DEPLOYMENT_TARGET: WATCHOS_DEPLOYMENT_TARGET,
        TARGETED_DEVICE_FAMILY: '"4"',
        SWIFT_VERSION: SWIFT_VERSION,
        PRODUCT_BUNDLE_IDENTIFIER: COMPLICATIONS_TARGET_BUNDLE_ID,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        MARKETING_VERSION: versions.marketing || "1.0",
        CURRENT_PROJECT_VERSION: versions.build || "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${COMPLICATIONS_TARGET_NAME}/${COMPLICATIONS_TARGET_NAME}-Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${COMPLICATIONS_TARGET_NAME}/${COMPLICATIONS_TARGET_NAME}.entitlements`,
        ENABLE_BITCODE: "NO",
        SKIP_INSTALL: "YES",
        LD_RUNPATH_SEARCH_PATHS: [
          '"$(inherited)"',
          '"@executable_path/Frameworks"',
          '"@executable_path/../../Frameworks"'
        ],
        ...(config?.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {})
      };

      const compList = project.pbxXCConfigurationList()[compTarget.pbxNativeTarget.buildConfigurationList];
      const compConfigurations = new Set((compList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !compConfigurations.has(uuid)) continue;
        Object.assign(configuration.buildSettings, compBuildSettings);
      }

      const compGroupKey = project.addPbxGroup([], COMPLICATIONS_TARGET_NAME, COMPLICATIONS_TARGET_NAME);
      const compFiles = listFiles(WATCH_COMPLICATIONS_DIR, ".swift");
      if (fs.existsSync(path.join(WIDGET_SHARED_DIR, "WidgetSharedState.swift"))) {
        compFiles.push("WidgetSharedState.swift");
      }
      for (const name of compFiles) {
        project.addSourceFile(
          `${COMPLICATIONS_TARGET_NAME}/${name}`,
          { target: compTarget.uuid },
          compGroupKey.uuid
        );
      }
    }

    return configWithProject;
  });
}

function withWatchOSEntitlement(config) {
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    configWithEntitlements.modResults["com.apple.developer.watchkit"] = true;
    return configWithEntitlements;
  });
}

module.exports = function withWatchOS(config) {
  config = withWatchOSSources(config);
  config = withWatchOSTarget(config);
  return withWatchOSEntitlement(config);
};
