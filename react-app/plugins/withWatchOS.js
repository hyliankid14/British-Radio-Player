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
const IDENTS_DIR = path.join(__dirname, "..", "assets", "idents");

const WATCH_TARGET_NAME = "BRPWatch";
const WATCH_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.watch";
const COMPLICATIONS_TARGET_NAME = "BRPWatchComplications";
const COMPLICATIONS_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.watch.complications";
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
      if (fs.existsSync(path.join(WATCH_DIR, "PrivacyInfo.xcprivacy"))) {
        await fs.promises.copyFile(
          path.join(WATCH_DIR, "PrivacyInfo.xcprivacy"),
          path.join(watchTargetRoot, "PrivacyInfo.xcprivacy")
        );
      }

      // Copy Station Idents
      if (fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          await fs.promises.copyFile(
            path.join(IDENTS_DIR, name),
            path.join(watchTargetRoot, name)
          );
        }
      }

      // Copy AppIcon asset catalog
      const mainAppIconDir = path.join(platformProjectRoot, configWithModRequest.modRequest.projectName, "Images.xcassets", "AppIcon.appiconset");
      const watchAssetsDir = path.join(watchTargetRoot, "Assets.xcassets");
      const watchAppIconDir = path.join(watchAssetsDir, "AppIcon.appiconset");
      if (fs.existsSync(mainAppIconDir)) {
        await fs.promises.mkdir(watchAppIconDir, { recursive: true });
        for (const file of fs.readdirSync(mainAppIconDir)) {
          if (file === "Contents.json") continue;
          await fs.promises.copyFile(
            path.join(mainAppIconDir, file),
            path.join(watchAppIconDir, file)
          );
        }
        await fs.promises.writeFile(
          path.join(watchAppIconDir, "Contents.json"),
          JSON.stringify(
            {
              images: [
                {
                  filename: "App-Icon-1024x1024@1x.png",
                  idiom: "universal",
                  platform: "watchos",
                  size: "1024x1024"
                }
              ],
              info: { version: 1, author: "xcode" }
            },
            null,
            2
          )
        );
        await fs.promises.writeFile(
          path.join(watchAssetsDir, "Contents.json"),
          JSON.stringify({ info: { version: 1, author: "xcode" } }, null, 2)
        );
      }

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

function ensureEmbedWatchPhase(project, appTargetUuid) {
  const watchTarget = project.pbxTargetByName(WATCH_TARGET_NAME);
  if (!watchTarget) return;
  const watchProductRef = watchTarget.productReference;
  if (!watchProductRef) return;

  const copyPhases = project.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
  let embedWatchPhaseKey = Object.keys(copyPhases).find((k) => {
    if (k.endsWith("_comment")) return false;
    const p = copyPhases[k];
    return p && (p.name === '"Embed Watch Content"' || p.name === "Embed Watch Content");
  });

  let embedPhase;
  if (!embedWatchPhaseKey) {
    const res = project.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      "Embed Watch Content",
      appTargetUuid,
      "watch2_app",
      '"$(CONTENTS_FOLDER_PATH)/Watch"'
    );
    embedWatchPhaseKey = res.uuid;
    embedPhase = res.buildPhase;
  } else {
    embedPhase = copyPhases[embedWatchPhaseKey];
  }

  embedPhase.dstPath = '"$(CONTENTS_FOLDER_PATH)/Watch"';
  embedPhase.dstSubfolderSpec = 16;
  embedPhase.name = '"Embed Watch Content"';

  if (!embedPhase.files) embedPhase.files = [];
  const alreadyInPhase = embedPhase.files.some((f) => {
    const comment = f.comment || "";
    return comment.includes(`${WATCH_TARGET_NAME}.app`);
  });

  if (!alreadyInPhase) {
    const buildFileUuid = project.generateUuid();
    project.addToPbxBuildFileSection({
      uuid: buildFileUuid,
      fileRef: watchProductRef,
      basename: `${WATCH_TARGET_NAME}.app`,
      group: "Embed Watch Content",
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] }
    });
    embedPhase.files.push({
      value: buildFileUuid,
      comment: `${WATCH_TARGET_NAME}.app in Embed Watch Content`
    });
  }
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
    if (!project.hash.project.objects["PBXVariantGroup"]) {
      project.hash.project.objects["PBXVariantGroup"] = {};
    }
    if (!project.pbxGroupByName("Resources")) {
      project.addPbxGroup([], "Resources", "Resources");
    }

    const existingWatchTarget = project.pbxTargetByName(WATCH_TARGET_NAME);
    let watchTargetUuid;
    if (!existingWatchTarget) {
      const watchTarget = project.addTarget(
        WATCH_TARGET_NAME,
        "application",
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
        ASSETCATALOG_COMPILER_APPICON_NAME: '"AppIcon"',
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
      if (fs.existsSync(path.join(WATCH_DIR, "PrivacyInfo.xcprivacy"))) {
        project.addResourceFile(
          `${WATCH_TARGET_NAME}/PrivacyInfo.xcprivacy`,
          { target: watchTarget.uuid },
          watchGroupKey.uuid
        );
      }
      if (fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          project.addResourceFile(
            `${WATCH_TARGET_NAME}/${name}`,
            { target: watchTarget.uuid },
            watchGroupKey.uuid
          );
        }
      }
      project.addResourceFile(
        `${WATCH_TARGET_NAME}/Assets.xcassets`,
        { target: watchTarget.uuid },
        watchGroupKey.uuid
      );
    } else {
      // Resolve UUID from the native target section (pbxTargetByName returns the target
      // object, not an entry with a .uuid property — same pattern as withIosWidget.js).
      const targets = project.pbxNativeTargetSection();
      for (const [k, v] of Object.entries(targets)) {
        if (k.endsWith("_comment")) continue;
        if (v.name === WATCH_TARGET_NAME || v.name === `"${WATCH_TARGET_NAME}"`) {
          watchTargetUuid = k;
          break;
        }
      }

      // Update marketing/build versions so they stay in sync with the phone app.
      const watchList = project.pbxXCConfigurationList()[existingWatchTarget.buildConfigurationList];
      const watchConfigurations = new Set((watchList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !watchConfigurations.has(uuid)) continue;
        configuration.buildSettings.MARKETING_VERSION = versions.marketing;
        configuration.buildSettings.CURRENT_PROJECT_VERSION = versions.build;
        if (config?.ios?.appleTeamId) {
          configuration.buildSettings.DEVELOPMENT_TEAM = config.ios.appleTeamId;
        }
      }

      const watchGroupKey = project.findPBXGroupKey({ name: WATCH_TARGET_NAME });
      if (watchGroupKey && watchTargetUuid) {
        const watchDirs = [WATCH_APP_DIR, WATCH_SCREENS_DIR, WATCH_PLAYBACK_DIR, WATCH_SYNC_DIR];
        for (const dir of watchDirs) {
          for (const name of listFiles(dir, ".swift")) {
            const relPath = `${WATCH_TARGET_NAME}/${name}`;
            if (!project.hasFile(relPath)) {
              project.addSourceFile(relPath, { target: watchTargetUuid }, watchGroupKey);
            }
          }
        }
      }
    }

    // Setup Complications Target
    if (!project.pbxTargetByName(COMPLICATIONS_TARGET_NAME)) {
      const compTarget = project.addTarget(
        COMPLICATIONS_TARGET_NAME,
        "app_extension",
        COMPLICATIONS_TARGET_NAME,
        COMPLICATIONS_TARGET_BUNDLE_ID
      );

      // node-xcode automatically adds the app_extension product to the first target's (iOS app)
      // PBXCopyFilesBuildPhase. Since compTarget is a watchOS extension, remove it from the iOS app's PlugIns.
      const copyPhases = project.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
      for (const [phaseId, phase] of Object.entries(copyPhases)) {
        if (phaseId.endsWith("_comment") || !phase.files) continue;
        phase.files = phase.files.filter((f) => {
          const comment = f.comment || "";
          return !comment.includes(COMPLICATIONS_TARGET_NAME);
        });
      }

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

    try {
      const schemesDir = path.join(
        configWithProject.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        "xcshareddata",
        "xcschemes"
      );
      if (fs.existsSync(schemesDir) && watchTargetUuid) {
        const schemePath = path.join(schemesDir, `${WATCH_TARGET_NAME}.xcscheme`);
        const schemeContent = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1500"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${watchTargetUuid}"
               BuildableName = "${WATCH_TARGET_NAME}.app"
               BlueprintName = "${WATCH_TARGET_NAME}"
               ReferencedContainer = "container:${projectName}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "${watchTargetUuid}"
            BuildableName = "${WATCH_TARGET_NAME}.app"
            BlueprintName = "${WATCH_TARGET_NAME}"
            ReferencedContainer = "container:${projectName}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
</Scheme>
`;
        fs.writeFileSync(schemePath, schemeContent, "utf8");
      }
    } catch (e) {
      console.warn("[withWatchOS] Failed to write watch scheme:", e);
    }

    ensureEmbedWatchPhase(project, appTargetEntry.uuid);

    return configWithProject;
  });
}

function withWatchAppGroupEntitlement(config) {
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

module.exports = function withWatchOS(config) {
  config = withWatchOSSources(config);
  config = withWatchOSTarget(config);
  return withWatchAppGroupEntitlement(config);
};
