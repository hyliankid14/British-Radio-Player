import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("iOS native bridge and config plugin are configured for iCloud KVS sync", () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(currentDir, "..");

  const pluginPath = path.join(rootDir, "plugins", "withIosNative.js");
  const pluginContent = fs.readFileSync(pluginPath, "utf8");

  assert.ok(
    pluginContent.includes("withICloudEntitlement"),
    "withIosNative.js must define withICloudEntitlement"
  );
  assert.ok(
    pluginContent.includes("com.apple.developer.ubiquity-kvstore-identifier"),
    "withIosNative.js must declare the ubiquity-kvstore-identifier entitlement"
  );

  const bridgeSwiftPath = path.join(rootDir, "plugins", "ios-native", "ICloudKvsBridge.swift");
  assert.ok(fs.existsSync(bridgeSwiftPath), "ICloudKvsBridge.swift must exist in plugins/ios-native");

  const bridgeSwiftContent = fs.readFileSync(bridgeSwiftPath, "utf8");
  assert.ok(
    bridgeSwiftContent.includes("NSUbiquitousKeyValueStore.default"),
    "ICloudKvsBridge.swift must use NSUbiquitousKeyValueStore.default"
  );
  assert.ok(
    bridgeSwiftContent.includes("didChangeExternallyNotification"),
    "ICloudKvsBridge.swift must observe didChangeExternallyNotification"
  );

  const sceneDelegatePath = path.join(rootDir, "plugins", "ios-native", "SceneDelegate.swift");
  const sceneDelegateContent = fs.readFileSync(sceneDelegatePath, "utf8");
  assert.ok(
    sceneDelegateContent.includes("ICloudKvsBridge.shared.start()"),
    "SceneDelegate.swift must start ICloudKvsBridge.shared"
  );
});
