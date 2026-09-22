const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withEntitlementsPlist
} = require("@expo/config-plugins");

module.exports = function withAndroidCleartextTraffic(config) {
  config = withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    const application = manifest.application?.[0];
    if (application) {
      application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
      application["meta-data"] = application["meta-data"] || [];
      if (!application["meta-data"].some((entry) =>
        entry.$["android:name"] === "com.google.android.gms.car.application"
      )) {
        application["meta-data"].push({
          $: {
            "android:name": "com.google.android.gms.car.application",
            "android:resource": "@xml/automotive_app_desc"
          }
        });
      }
    }
    return configWithManifest;
  });

  config = withDangerousMod(config, [
    "android",
    async (configWithResources) => {
      const resourceDirectory = path.join(
        configWithResources.modRequest.platformProjectRoot,
        "app/src/main/res/xml"
      );
      await fs.promises.mkdir(resourceDirectory, { recursive: true });
      await fs.promises.writeFile(
        path.join(resourceDirectory, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">bbci.co.uk</domain>
    <domain includeSubdomains="true">lsn.lv</domain>
  </domain-config>
</network-security-config>
`
      );
      await fs.promises.writeFile(
        path.join(resourceDirectory, "automotive_app_desc.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`
      );

      // Use the repository's shared debug keystore so local & sideloaded APKs match the
      // signature of the legacy Kotlin build, enabling seamless in-place updates.
      const sharedKeystore = path.resolve(
        configWithResources.modRequest.projectRoot,
        "../keystore/debug.keystore"
      );
      const targetKeystore = path.join(
        configWithResources.modRequest.platformProjectRoot,
        "app/debug.keystore"
      );
      if (fs.existsSync(sharedKeystore)) {
        await fs.promises.copyFile(sharedKeystore, targetKeystore);
      }

      return configWithResources;
    }
  ]);

  config = withAppBuildGradle(config, (configWithBuildGradle) => {
    const contents = configWithBuildGradle.modResults.contents;
    if (!contents.includes("debuggableVariants = []")) {
      configWithBuildGradle.modResults.contents = contents.replace(
        /react\s*\{\n/,
        "react {\n    // Bundle JavaScript in debug APKs so sideloaded builds work without Metro.\n    debuggableVariants = []\n"
      );
    }
    configWithBuildGradle.modResults.contents =
      configWithBuildGradle.modResults.contents.replace(
        "debug {\n            signingConfig signingConfigs.debug",
        "debug {\n            signingConfig signingConfigs.debug\n            minifyEnabled = (findProperty('android.enableMinifyInDebugBuilds') ?: 'false').toBoolean()\n            shrinkResources = (findProperty('android.enableMinifyInDebugBuilds') ?: 'false').toBoolean()"
      );
    return configWithBuildGradle;
  });

  return withEntitlementsPlist(config, (configWithEntitlements) => {
    configWithEntitlements.modResults["com.apple.developer.carplay-audio"] = true;
    return configWithEntitlements;
  });
};
