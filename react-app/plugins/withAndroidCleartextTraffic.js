const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

module.exports = function withAndroidCleartextTraffic(config) {
  config = withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (application) {
      application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return configWithManifest;
  });

  return withDangerousMod(config, [
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
      return configWithResources;
    }
  ]);
};
