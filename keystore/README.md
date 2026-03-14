# Keystore directory

Keystore files (`.keystore`, `.jks`) are **excluded from version control** and
are generated automatically during builds.

## Debug keystore

`debug.keystore` is created on first build by `app/build.gradle` using
`keytool` with the standard Android debug credentials:

| Parameter     | Value            |
|---------------|------------------|
| Alias         | `androiddebugkey`|
| Store password| `android`        |
| Key password  | `android`        |

Because each check out generates its own keystore, consecutive debug APKs from
different machines will have **different signing identities**.  If you need
consistent signing across machines (e.g. to update a sideloaded APK without
reinstalling), generate a keystore manually and store its base64 value as a
repository secret named `DEBUG_KEYSTORE_BASE64`, then decode it in your CI
workflow before running Gradle.

## Release keystore

Supply release-signing credentials via environment variables or
`gradle.properties` (never commit them):

```
RELEASE_STORE_FILE=/path/to/release.jks
RELEASE_STORE_PASSWORD=<password>
RELEASE_KEY_ALIAS=<alias>
RELEASE_KEY_PASSWORD=<password>
```
