import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore
import withAndroidReleaseChannels from "../plugins/withAndroidReleaseChannels.js";

test("patchBuildGradle sets signingConfig to null on release buildType so flavors take precedence", () => {
  const initialGradle = `android {
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;

  const patched = withAndroidReleaseChannels.patchBuildGradle(initialGradle);

  assert.ok(patched.includes("release {\n            // Expo's template sets signingConfig signingConfigs.debug on the release build type."));
  assert.ok(patched.includes("signingConfig = null"));
  assert.ok(!patched.includes("release {\n            // Default for a bare \"assembleRelease\"; the flavours above take precedence.\n            signingConfig signingConfigs.githubShared"));
  assert.ok(patched.includes("play {\n            dimension \"distribution\"\n            signingConfig signingConfigs.release\n        }"));
  assert.ok(patched.includes("github {\n            dimension \"distribution\"\n            signingConfig signingConfigs.githubShared\n        }"));
});

test("patchBuildGradle is idempotent", () => {
  const initialGradle = "apply plugin: 'com.android.application'\n";
  const once = withAndroidReleaseChannels.patchBuildGradle(initialGradle);
  const twice = withAndroidReleaseChannels.patchBuildGradle(once);
  assert.equal(once, twice);
});

test("flavor manifests define REQUEST_INSTALL_PACKAGES for github and remove it for play", () => {
  assert.ok(withAndroidReleaseChannels.GITHUB_MANIFEST.includes('android:name="android.permission.REQUEST_INSTALL_PACKAGES"'));
  assert.ok(!withAndroidReleaseChannels.GITHUB_MANIFEST.includes('tools:node="remove"'));

  assert.ok(withAndroidReleaseChannels.PLAY_MANIFEST.includes('android:name="android.permission.REQUEST_INSTALL_PACKAGES"'));
  assert.ok(withAndroidReleaseChannels.PLAY_MANIFEST.includes('tools:node="remove"'));

  assert.ok(withAndroidReleaseChannels.PLAY_MANIFEST.includes('android:name="android.permission.USE_FULL_SCREEN_INTENT"'));
});

