const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject
} = require("@expo/config-plugins");

const TV_DIR = path.join(__dirname, "tvos");
const TV_APP_DIR = path.join(TV_DIR, "App");
const TV_SCREENS_DIR = path.join(TV_DIR, "Screens");
const TV_COMPONENTS_DIR = path.join(TV_DIR, "Components");
const TV_PLAYBACK_DIR = path.join(TV_DIR, "Playback");
const TV_TOP_SHELF_DIR = path.join(TV_DIR, "TopShelf");
const IDENTS_DIR = path.join(__dirname, "..", "assets", "idents");

const TV_TARGET_NAME = "BRPTV";
const TV_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.tv";
const TOP_SHELF_TARGET_NAME = "BRPTVTopShelf";
const TOP_SHELF_TARGET_BUNDLE_ID = "com.hyliankid14.bbcradioplayer.tv.topshelf";
const APP_GROUP_ID = "group.com.hyliankid14.bbcradioplayer";
const TVOS_DEPLOYMENT_TARGET = "17.0";
const SWIFT_VERSION = "5.0";

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(extension)).sort();
}

function withTvOSSources(config) {
  return withDangerousMod(config, [
    "ios",
    async (configWithModRequest) => {
      const { platformProjectRoot } = configWithModRequest.modRequest;
      const tvTargetRoot = path.join(platformProjectRoot, TV_TARGET_NAME);
      const topShelfTargetRoot = path.join(platformProjectRoot, TOP_SHELF_TARGET_NAME);

      await fs.promises.mkdir(tvTargetRoot, { recursive: true });
      await fs.promises.mkdir(topShelfTargetRoot, { recursive: true });

      // Copy BRPTV sources
      const tvDirs = [TV_APP_DIR, TV_SCREENS_DIR, TV_COMPONENTS_DIR, TV_PLAYBACK_DIR];
      for (const dir of tvDirs) {
        for (const name of listFiles(dir, ".swift")) {
          await fs.promises.copyFile(
            path.join(dir, name),
            path.join(tvTargetRoot, name)
          );
        }
      }

      await fs.promises.copyFile(
        path.join(TV_DIR, "BRPTV-Info.plist"),
        path.join(tvTargetRoot, "BRPTV-Info.plist")
      );
      await fs.promises.copyFile(
        path.join(TV_DIR, "BRPTV.entitlements"),
        path.join(tvTargetRoot, "BRPTV.entitlements")
      );
      if (fs.existsSync(path.join(TV_DIR, "PrivacyInfo.xcprivacy"))) {
        await fs.promises.copyFile(
          path.join(TV_DIR, "PrivacyInfo.xcprivacy"),
          path.join(tvTargetRoot, "PrivacyInfo.xcprivacy")
        );
      }

      // Copy Station Idents
      if (fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          await fs.promises.copyFile(
            path.join(IDENTS_DIR, name),
            path.join(tvTargetRoot, name)
          );
          await fs.promises.copyFile(
            path.join(IDENTS_DIR, name),
            path.join(topShelfTargetRoot, name)
          );
        }
      }

      // Copy tvOS AppIcon brandassets catalog
      const tvPluginAssetsDir = path.join(TV_DIR, "Assets", "AppIcon.brandassets");
      const tvAssetsDir = path.join(tvTargetRoot, "Assets.xcassets");
      const tvBrandAssetsDir = path.join(tvAssetsDir, "AppIcon.brandassets");
      if (fs.existsSync(tvPluginAssetsDir)) {
        await fs.promises.mkdir(tvAssetsDir, { recursive: true });
        await fs.promises.cp(tvPluginAssetsDir, tvBrandAssetsDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(tvAssetsDir, "Contents.json"),
          JSON.stringify({ info: { version: 1, author: "xcode" } }, null, 2)
        );
      }

      // Copy app-logo.png
      const appLogoSrc = path.join(TV_DIR, "app-logo.png");
      if (fs.existsSync(appLogoSrc)) {
        await fs.promises.copyFile(
          appLogoSrc,
          path.join(tvTargetRoot, "app-logo.png")
        );
      }

      // Copy Top Shelf sources
      for (const name of listFiles(TV_TOP_SHELF_DIR, ".swift")) {
        await fs.promises.copyFile(
          path.join(TV_TOP_SHELF_DIR, name),
          path.join(topShelfTargetRoot, name)
        );
      }

      await fs.promises.copyFile(
        path.join(TV_DIR, "BRPTVTopShelf-Info.plist"),
        path.join(topShelfTargetRoot, "BRPTVTopShelf-Info.plist")
      );
      await fs.promises.copyFile(
        path.join(TV_DIR, "BRPTVTopShelf.entitlements"),
        path.join(topShelfTargetRoot, "BRPTVTopShelf.entitlements")
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

function findTargetByName(project, name) {
  const target = project.pbxTargetByName(name);
  if (target) return target;
  const targets = project.pbxNativeTargetSection();
  for (const [k, v] of Object.entries(targets)) {
    if (k.endsWith("_comment")) continue;
    if (v.name === name || v.name === `"${name}"`) {
      return v;
    }
  }
  return null;
}

function ensureEmbedTopShelfPhase(project, tvTargetUuid) {
  const topShelfTarget = findTargetByName(project, TOP_SHELF_TARGET_NAME);
  if (!topShelfTarget || !tvTargetUuid) return;
  const topShelfProductRef = topShelfTarget.productReference;
  if (!topShelfProductRef) return;

  const copyPhases = project.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
  let embedPhaseKey = Object.keys(copyPhases).find((k) => {
    if (k.endsWith("_comment")) return false;
    const p = copyPhases[k];
    return p && (p.name === '"Embed Top Shelf Extension"' || p.name === "Embed Top Shelf Extension");
  });

  let embedPhase;
  if (!embedPhaseKey) {
    const res = project.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      "Embed Top Shelf Extension",
      tvTargetUuid,
      "app_extension",
      '""'
    );
    embedPhaseKey = res.uuid;
    embedPhase = res.buildPhase;
  } else {
    embedPhase = copyPhases[embedPhaseKey];
  }

  embedPhase.dstPath = '""';
  embedPhase.dstSubfolderSpec = 13;
  embedPhase.name = '"Embed Top Shelf Extension"';

  if (!embedPhase.files) embedPhase.files = [];
  const alreadyInPhase = embedPhase.files.some((f) => {
    const comment = f.comment || "";
    return comment.includes(`${TOP_SHELF_TARGET_NAME}.appex`);
  });

  if (!alreadyInPhase) {
    const buildFileUuid = project.generateUuid();
    project.addToPbxBuildFileSection({
      uuid: buildFileUuid,
      fileRef: topShelfProductRef,
      basename: `${TOP_SHELF_TARGET_NAME}.appex`,
      group: "Embed Top Shelf Extension",
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] }
    });
    embedPhase.files.push({
      value: buildFileUuid,
      comment: `${TOP_SHELF_TARGET_NAME}.appex in Embed Top Shelf Extension`
    });
  }
}

function withTvOSTarget(config) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const { projectName } = configWithProject.modRequest;

    const appTargetEntry = project.getFirstTarget();
    const appTarget = appTargetEntry?.firstTarget;
    if (!appTarget) {
      console.warn("[withTvOS] No application target found.");
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

    const existingTvTarget = findTargetByName(project, TV_TARGET_NAME);
    let tvTargetUuid;
    if (!existingTvTarget) {
      const tvTarget = project.addTarget(
        TV_TARGET_NAME,
        "application",
        TV_TARGET_NAME,
        TV_TARGET_BUNDLE_ID
      );
      tvTargetUuid = tvTarget.uuid;

      for (const phase of ["Sources", "Frameworks", "Resources"]) {
        project.addBuildPhase([], `PBX${phase}BuildPhase`, phase, tvTarget.uuid);
      }

      const tvBuildSettings = {
        SDKROOT: "appletvos",
        TVOS_DEPLOYMENT_TARGET: TVOS_DEPLOYMENT_TARGET,
        TARGETED_DEVICE_FAMILY: '"3"',
        SWIFT_VERSION: SWIFT_VERSION,
        PRODUCT_BUNDLE_IDENTIFIER: TV_TARGET_BUNDLE_ID,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        MARKETING_VERSION: versions.marketing || "1.0",
        CURRENT_PROJECT_VERSION: versions.build || "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${TV_TARGET_NAME}/${TV_TARGET_NAME}-Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TV_TARGET_NAME}/${TV_TARGET_NAME}.entitlements`,
        ENABLE_BITCODE: "NO",
        SKIP_INSTALL: "NO",
        ASSETCATALOG_COMPILER_APPICON_NAME: '"AppIcon"',
        LD_RUNPATH_SEARCH_PATHS: [
          '"$(inherited)"',
          '"@executable_path/Frameworks"'
        ],
        ...(config?.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {})
      };

      const tvList = project.pbxXCConfigurationList()[tvTarget.pbxNativeTarget.buildConfigurationList];
      const tvConfigurations = new Set((tvList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !tvConfigurations.has(uuid)) continue;
        Object.assign(configuration.buildSettings, tvBuildSettings);
      }

      const tvGroupKey = project.addPbxGroup([], TV_TARGET_NAME, TV_TARGET_NAME);
      const tvDirs = [TV_APP_DIR, TV_SCREENS_DIR, TV_COMPONENTS_DIR, TV_PLAYBACK_DIR];
      for (const dir of tvDirs) {
        for (const name of listFiles(dir, ".swift")) {
          project.addSourceFile(
            `${TV_TARGET_NAME}/${name}`,
            { target: tvTarget.uuid },
            tvGroupKey.uuid
          );
        }
      }

      if (fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          project.addResourceFile(
            `${TV_TARGET_NAME}/${name}`,
            { target: tvTarget.uuid },
            tvGroupKey.uuid
          );
        }
      }
      project.addResourceFile(
        `${TV_TARGET_NAME}/Assets.xcassets`,
        { target: tvTarget.uuid },
        tvGroupKey.uuid
      );
      if (fs.existsSync(path.join(TV_DIR, "app-logo.png"))) {
        project.addResourceFile(
          `${TV_TARGET_NAME}/app-logo.png`,
          { target: tvTarget.uuid },
          tvGroupKey.uuid
        );
      }
    } else {
      const targets = project.pbxNativeTargetSection();
      for (const [k, v] of Object.entries(targets)) {
        if (k.endsWith("_comment")) continue;
        if (v.name === TV_TARGET_NAME || v.name === `"${TV_TARGET_NAME}"`) {
          tvTargetUuid = k;
          break;
        }
      }

      const tvList = project.pbxXCConfigurationList()[existingTvTarget.buildConfigurationList];
      const tvConfigurations = new Set((tvList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !tvConfigurations.has(uuid)) continue;
        configuration.buildSettings.MARKETING_VERSION = versions.marketing;
        configuration.buildSettings.CURRENT_PROJECT_VERSION = versions.build;
        configuration.buildSettings.SKIP_INSTALL = "NO";
        if (config?.ios?.appleTeamId) {
          configuration.buildSettings.DEVELOPMENT_TEAM = config.ios.appleTeamId;
        }
      }

      const tvGroupKey = project.findPBXGroupKey({ name: TV_TARGET_NAME });
      if (tvGroupKey && tvTargetUuid) {
        const tvDirs = [TV_APP_DIR, TV_SCREENS_DIR, TV_COMPONENTS_DIR, TV_PLAYBACK_DIR];
        for (const dir of tvDirs) {
          for (const name of listFiles(dir, ".swift")) {
            const relPath = `${TV_TARGET_NAME}/${name}`;
            if (!project.hasFile(relPath)) {
              project.addSourceFile(relPath, { target: tvTargetUuid }, tvGroupKey);
            }
          }
        }
      }
    }

    // Setup Top Shelf Target
    if (!findTargetByName(project, TOP_SHELF_TARGET_NAME)) {
      const topShelfTarget = project.addTarget(
        TOP_SHELF_TARGET_NAME,
        "app_extension",
        TOP_SHELF_TARGET_NAME,
        TOP_SHELF_TARGET_BUNDLE_ID
      );

      // Remove from iOS app plugins if automatically added
      const copyPhases = project.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
      for (const [phaseId, phase] of Object.entries(copyPhases)) {
        if (phaseId.endsWith("_comment") || !phase.files) continue;
        phase.files = phase.files.filter((f) => {
          const comment = f.comment || "";
          return !comment.includes(TOP_SHELF_TARGET_NAME);
        });
      }

      if (tvTargetUuid) {
        project.addTargetDependency(tvTargetUuid, [topShelfTarget.uuid]);
      }

      for (const phase of ["Sources", "Frameworks", "Resources"]) {
        project.addBuildPhase([], `PBX${phase}BuildPhase`, phase, topShelfTarget.uuid);
      }

      const topShelfBuildSettings = {
        SDKROOT: "appletvos",
        TVOS_DEPLOYMENT_TARGET: TVOS_DEPLOYMENT_TARGET,
        TARGETED_DEVICE_FAMILY: '"3"',
        SWIFT_VERSION: SWIFT_VERSION,
        PRODUCT_BUNDLE_IDENTIFIER: TOP_SHELF_TARGET_BUNDLE_ID,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        MARKETING_VERSION: versions.marketing || "1.0",
        CURRENT_PROJECT_VERSION: versions.build || "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${TOP_SHELF_TARGET_NAME}/${TOP_SHELF_TARGET_NAME}-Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TOP_SHELF_TARGET_NAME}/${TOP_SHELF_TARGET_NAME}.entitlements`,
        ENABLE_BITCODE: "NO",
        SKIP_INSTALL: "YES",
        LD_RUNPATH_SEARCH_PATHS: [
          '"$(inherited)"',
          '"@executable_path/Frameworks"',
          '"@executable_path/../../Frameworks"'
        ],
        ...(config?.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {})
      };

      const topShelfList = project.pbxXCConfigurationList()[topShelfTarget.pbxNativeTarget.buildConfigurationList];
      const topShelfConfigurations = new Set((topShelfList?.buildConfigurations ?? []).map((c) => c.value));
      const allConfigurations = project.pbxXCBuildConfigurationSection();
      for (const [uuid, configuration] of Object.entries(allConfigurations)) {
        if (uuid.endsWith("_comment") || !topShelfConfigurations.has(uuid)) continue;
        Object.assign(configuration.buildSettings, topShelfBuildSettings);
      }

      const topShelfGroupKey = project.addPbxGroup([], TOP_SHELF_TARGET_NAME, TOP_SHELF_TARGET_NAME);
      const topShelfFiles = listFiles(TV_TOP_SHELF_DIR, ".swift");
      for (const name of topShelfFiles) {
        project.addSourceFile(
          `${TOP_SHELF_TARGET_NAME}/${name}`,
          { target: topShelfTarget.uuid },
          topShelfGroupKey.uuid
        );
      }
      if (fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          project.addResourceFile(
            `${TOP_SHELF_TARGET_NAME}/${name}`,
            { target: topShelfTarget.uuid },
            topShelfGroupKey.uuid
          );
        }
      }
    } else {
      const existingTopShelf = findTargetByName(project, TOP_SHELF_TARGET_NAME);
      const topShelfGroupKey = project.findPBXGroupKey({ name: TOP_SHELF_TARGET_NAME });
      if (existingTopShelf && topShelfGroupKey && fs.existsSync(IDENTS_DIR)) {
        for (const name of listFiles(IDENTS_DIR, ".png")) {
          const relPath = `${TOP_SHELF_TARGET_NAME}/${name}`;
          if (!project.hasFile(relPath)) {
            project.addResourceFile(
              relPath,
              { target: existingTopShelf.uuid },
              topShelfGroupKey
            );
          }
        }
      }
    }

    try {
      const schemesDir = path.join(
        configWithProject.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        "xcshareddata",
        "xcschemes"
      );
      if (fs.existsSync(schemesDir) && tvTargetUuid) {
        const schemePath = path.join(schemesDir, `${TV_TARGET_NAME}.xcscheme`);
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
               BlueprintIdentifier = "${tvTargetUuid}"
               BuildableName = "${TV_TARGET_NAME}.app"
               BlueprintName = "${TV_TARGET_NAME}"
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
            BlueprintIdentifier = "${tvTargetUuid}"
            BuildableName = "${TV_TARGET_NAME}.app"
            BlueprintName = "${TV_TARGET_NAME}"
            ReferencedContainer = "container:${projectName}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
</Scheme>
`;
        fs.writeFileSync(schemePath, schemeContent, "utf8");
      }
    } catch (e) {
      console.warn("[withTvOS] Failed to write tvOS scheme:", e);
    }

    if (tvTargetUuid) {
      ensureEmbedTopShelfPhase(project, tvTargetUuid);
    }

    return configWithProject;
  });
}

function withTvAppGroupEntitlement(config) {
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

module.exports = function withTvOS(config) {
  config = withTvOSSources(config);
  config = withTvOSTarget(config);
  return withTvAppGroupEntitlement(config);
};
