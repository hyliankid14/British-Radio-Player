const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
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

    if (application) {
      application.service = application.service || [];
      const mediaService = application.service.find((service) =>
        service.$["android:name"] === "com.doublesymmetry.trackplayer.service.MusicService"
      );
      if (!mediaService) {
        application.service.push({
          $: {
            "android:name": "com.doublesymmetry.trackplayer.service.MusicService",
            "android:enabled": "true",
            "android:exported": "true",
            "android:foregroundServiceType": "mediaPlayback"
          },
          "intent-filter": [{
            action: [{
              $: { "android:name": "android.media.browse.MediaBrowserService" }
            }]
          }]
        });
      } else {
        mediaService["intent-filter"] = mediaService["intent-filter"] || [];
        if (!mediaService["intent-filter"].some((filter) =>
          filter.action?.some((action) =>
            action.$["android:name"] === "android.media.browse.MediaBrowserService"
          )
        )) {
          mediaService["intent-filter"].push({
            action: [{
              $: { "android:name": "android.media.browse.MediaBrowserService" }
            }]
          });
        }
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
      return configWithResources;
    }
  ]);

  return withEntitlementsPlist(config, (configWithEntitlements) => {
    configWithEntitlements.modResults["com.apple.developer.carplay-audio"] = true;
    return configWithEntitlements;
  });
};
