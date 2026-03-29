# Keystore directory

This directory contains signing material used by local and CI builds.

## Debug keystore

`debug.keystore` is intentionally shared in this repository and used by both
local and CI GitHub/debug builds with the standard Android debug credentials:

| Parameter     | Value            |
|---------------|------------------|
| Alias         | `androiddebugkey`|
| Store password| `android`        |
| Key password  | `android`        |

Because this keystore is shared, consecutive APKs from different machines keep
the same signing identity and support upgrade-in-place sideload installs.

## Release keystore

Supply release-signing credentials via environment variables or
`gradle.properties` (never commit them):

```
RELEASE_STORE_FILE=/path/to/release.jks
RELEASE_STORE_PASSWORD=<password>
RELEASE_KEY_ALIAS=<alias>
RELEASE_KEY_PASSWORD=<password>
```
