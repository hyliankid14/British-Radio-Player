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

It is also the key that signs **GitHub release APKs**. The React app's `github`
build flavour uses it, so an existing sideload is replaced in place rather than
requiring an uninstall. It is never used for Google Play.

## Release keystore

Supply release-signing credentials via environment variables or
`gradle.properties` (never commit them):

```
RELEASE_STORE_FILE=/path/to/release.jks
RELEASE_STORE_PASSWORD=<password>
RELEASE_KEY_ALIAS=<alias>
RELEASE_KEY_PASSWORD=<password>
```

These sign the **Google Play app bundle** and the Wear OS companion release
build. Resolution order is `-P` gradle property, then environment variable, then
`~/.gradle/gradle.properties`.

Because the Play release is an **in-place update** of the existing
`com.hyliankid14.bbcradioplayer` listing, this must be the same Play upload key
that signed the previous upload. Set `EXPECTED_PLAY_UPLOAD_SHA1` (a repository
variable for CI, an environment variable locally) to the listing's upload
certificate SHA-1 so a build with the wrong key fails instead of being rejected
at upload time.
