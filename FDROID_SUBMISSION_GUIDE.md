# F-Droid Submission Guide - BBC Radio Player

**Date:** 28 February 2026  
**App:** BBC Radio Player  
**GitHub Repo:** https://github.com/shaivure/Android-Auto-Radio-Player  
**Package ID:** com.hyliankid14.bbcradioplayer

---

## ✅ Your Question: Can I Submit from GitHub?

**YES!** F-Droid uses GitLab for their **metadata repository**, but your **app source code** stays on GitHub. Here's how:

```
┌──────────────────────────────────────────────────────────┐
│  Your GitHub Repo                                        │
│  https://github.com/shaivure/Android-Auto-Radio-Player  │
│  (Source code stays here)                                │
└──────────────────────────────────────────────────────────┘
                         ↓
                    Points to
                         ↓
┌──────────────────────────────────────────────────────────┐
│  F-Droid GitLab (fdroiddata)                            │
│  https://gitlab.com/fdroid/fdroiddata                    │
│  (Only metadata file goes here)                          │
└──────────────────────────────────────────────────────────┘
                         ↓
                  F-Droid builds from
                     your GitHub
```

**Many F-Droid apps use GitHub!** Examples:
- NewPipe (GitHub)
- AntennaPod (GitHub)  
- Signal (GitHub)
- Conversations (GitHub)

---

## 📋 Pre-Submission Checklist

### ✅ Done
- [x] LICENSE file added (GPL-3.0) ✅
- [x] Public GitHub repository ✅
- [x] Gradle build system ✅
- [x] No Firebase/Analytics ✅
- [x] No advertisements ✅
- [x] FOSS dependencies (mostly) ✅
- [x] **Build flavors implemented** ✅
  - [x] `fdroid` flavor (no GMS metadata) - F-Droid compliant
  - [x] `play` flavor (with GMS metadata) - Google Play optimized
  - [x] Both flavors tested and building successfully

### ⚠️ Must Fix Before Submission

✅ **COMPLETE:** Google GMS Car Metadata has been properly handled through build flavors. No manual removal needed!

**What was done:**
- Build flavors created (`fdroid` and `play`)
- GMS metadata removed from main manifest
- Flavor-specific manifests created:
  - `app/src/fdroid/AndroidManifest.xml` - Clean, no GMS (F-Droid)
  - `app/src/play/AndroidManifest.xml` - With GMS metadata (Play Store)
- Both flavors tested and build successfully
- Commit: ea62d00

#### 2. **Git Tags for Releases** 📌 IMPORTANT

F-Droid uses git tags to identify releases.

**Check your tags:**
```bash
git tag
```

**If you don't have tags, create them:**
```bash
git tag -a v0.11.0 -m "Release 0.11.0"
git push origin v0.11.0
```

**Tag naming convention:**
- `v0.11.0` (preferred)
- `0.11.0` (also works)
- Must match versionName in build.gradle

---

## 🔧 Recommended Fixes

### Build Flavors Implementation (✅ COMPLETED)

**Status:** Build flavors have been successfully implemented as of commit ea62d00.

This lets you have both F-Droid and Google Play versions from the same codebase.

#### ✅ What Was Done

**1. Updated `app/build.gradle`**
- Added `flavorDimensions "distribution"`
- Added 2 product flavors: `fdroid` and `play`

**2. Created Flavor-Specific Manifests**

```groovy
android {
    // ... existing config ...
    
    flavorDimensions "distribution"
    
    productFlavors {
        fdroid {
            dimension "distribution"
            // F-Droid variant - no GMS dependencies
        }
        
        play {
            dimension "distribution"
            // Google Play variant - includes GMS optimizations
        }
    }
}
```

#### Step 2: Create Flavor-Specific Manifests

**Create:** `app/src/fdroid/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- F-Droid variant: No GMS metadata -->
</manifest>
```

**Create:** `app/src/play/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <!-- Google Play variant: Include GMS metadata -->
        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />
    </application>
</manifest>
```

#### Step 3: Remove GMS from Main Manifest

Edit `app/src/main/AndroidManifest.xml` - **remove these lines:**
```xml
        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />
```

#### Step 4: Test Both Flavors

```bash
# Test F-Droid flavor
./gradlew assembleFdroidRelease

# Test Play flavor  
./gradlew assemblePlayRelease
```

---

## 📝 F-Droid Metadata File

### Where It Goes

Fork and clone F-Droid's metadata repository:
```bash
git clone https://gitlab.com/YOUR-USERNAME/fdroiddata.git
cd fdroiddata
```

### Create Metadata File

**File:** `metadata/com.hyliankid14.bbcradioplayer.yml`

```yaml
Categories:
  - Multimedia
License: GPL-3.0-or-later
AuthorName: shaivure
AuthorWebSite: https://github.com/shaivure
SourceCode: https://github.com/shaivure/Android-Auto-Radio-Player
IssueTracker: https://github.com/shaivure/Android-Auto-Radio-Player/issues
Changelog: https://github.com/shaivure/Android-Auto-Radio-Player/releases

AutoName: BBC Radio Player
Summary: Stream BBC Radio stations with Android Auto support

Description: |-
  A feature-rich Android app for streaming BBC Radio stations with seamless
  Android Auto integration, comprehensive podcast support with downloads and
  subscriptions, intelligent playback features, and a modern Material Design 3
  interface.
  
  Features:
  * Full Android Auto MediaBrowserService integration
  * 80+ BBC Radio stations (National, Regional, Local)
  * Podcast support with subscriptions and downloads
  * Episode download management with WiFi-only option
  * Playback history tracking
  * Favorites management with drag-and-drop reordering
  * Live metadata and show information
  * Material Design 3 interface with light/dark themes
  * No tracking, no ads, completely free and open source
  
  Note: This app requires internet connection to stream BBC Radio content.

RepoType: git
Repo: https://github.com/shaivure/Android-Auto-Radio-Player.git

Builds:
  - versionName: 0.11.0
    versionCode: 17
    commit: v0.11.0
    subdir: app
    gradle:
      - fdroid

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: 0.11.0
CurrentVersionCode: 17
```

### Key Fields Explained

- **Categories:** App category in F-Droid (Multimedia for media players)
- **License:** Your license (GPL-3.0-or-later matches your LICENSE file)
- **RepoType/Repo:** Points to your **GitHub repository**
- **Builds:** Instructions for building your app
  - **commit:** Git tag for this version
  - **subdir:** Subdirectory containing build.gradle (usually `app`)
  - **gradle:** Build flavor to use (`fdroid` if using flavors, `yes` if not)
- **AutoUpdateMode:** How F-Droid checks for updates
- **UpdateCheckMode:** Look for new git tags

---

## 📸 Metadata Screenshots & Graphics

F-Droid uses Fastlane/Triple-T format for descriptions and screenshots.

### Directory Structure

Create in your **GitHub repo** (not fdroiddata):

```
metadata/
└── en-US/
    ├── full_description.txt
    ├── short_description.txt
    ├── title.txt
    ├── changelogs/
    │   └── 17.txt
    └── images/
        ├── icon.png (512x512)
        ├── featureGraphic.png (1024x500, optional)
        └── phoneScreenshots/
            ├── 1.png
            ├── 2.png
            ├── 3.png
            └── 4.png
```

### Example Files

**metadata/en-US/title.txt:**
```
BBC Radio Player
```

**metadata/en-US/short_description.txt:**
```
Stream 80+ BBC Radio stations with Android Auto support
```

**metadata/en-US/full_description.txt:**
```
A feature-rich Android app for streaming BBC Radio stations with seamless
Android Auto integration, comprehensive podcast support with downloads and
subscriptions, intelligent playback features, and a modern Material Design 3
interface.

FEATURES

Android Auto Integration:
• Full MediaBrowserService integration for native Android Auto support
• Browsable station hierarchy with Favorites, All Stations, and Podcasts
• Rich metadata display with live show information
• Auto-resume playback when connecting to Android Auto

Station Library (80+ Stations):
• 11 National stations (Radio 1, 2, 3, 4, 5 Live, 6 Music, etc.)
• 9 Regional stations (Scotland, Wales, Northern Ireland)
• 60+ Local stations across England

Podcast Support:
• Subscribe to BBC podcasts
• Automatic episode downloading with configurable limits
• WiFi-only download option
• Playback history tracking
• Episode bookmarking

Playback Features:
• Favorites management with drag-and-drop reordering
• Live metadata and show information
• Album artwork with caching
• Background playback
• Notification controls

Interface:
• Material Design 3 with purple theme
• Light and dark mode support
• Bottom navigation with Favorites, Stations, and Settings
• Responsive layout for phones and tablets

Privacy:
• No tracking or analytics
• No advertisements
• No Google Play Services required
• Completely free and open source

REQUIREMENTS
• Internet connection for streaming
• Android 5.0 (API 21) or higher
```

**metadata/en-US/changelogs/17.txt:**
```
Version 0.11.0:
• F-Droid release
• Removed Google Mobile Services dependencies
• Enhanced podcast support
• Improved Android Auto integration
• Bug fixes and stability improvements
```

### Taking Screenshots

Use your phone or emulator:
1. Open the app
2. Navigate to key screens (station list, now playing, favorites, podcasts)
3. Take screenshots (1080x1920 or higher)
4. Save as PNG in `metadata/en-US/images/phoneScreenshots/`

---

## 🚀 Submission Process

### Method: Metadata Merge Request (Recommended)

This is **faster** than the submission queue because you do the work upfront.

### Step-by-Step

#### 1. **Fix Your App** (Do First!)

```bash
# In your BBC Radio Player directory

# If using build flavors:
# 1. Edit app/build.gradle (add flavors)
# 2. Create app/src/fdroid/AndroidManifest.xml (empty or minimal)
# 3. Create app/src/play/AndroidManifest.xml (with GMS metadata)
# 4. Remove GMS metadata from app/src/main/AndroidManifest.xml

# Test the F-Droid build
./gradlew assembleFdroidRelease

# If it works, commit and push
git add .
git commit -m "Add F-Droid build flavor without GMS dependencies"

# Create release tag if you haven't
git tag -a v0.11.0 -m "Release 0.11.0"
git push origin main
git push origin v0.11.0
```

#### 2. **Add Metadata to Your Repo** (Optional but Recommended)

```bash
# In your BBC Radio Player directory
mkdir -p metadata/en-US/images/phoneScreenshots
mkdir -p metadata/en-US/changelogs

# Create the text files as shown above
# Add screenshots

git add metadata/
git commit -m "Add F-Droid metadata and screenshots"
git push origin main
```

#### 3. **Fork F-Droid Metadata Repo**

Go to: https://gitlab.com/fdroid/fdroiddata

Click **Fork** button (top right)

#### 4. **Clone Your Fork**

```bash
cd ~/Development  # Or wherever you keep projects
git clone https://gitlab.com/YOUR-GITLAB-USERNAME/fdroiddata.git
cd fdroiddata
```

#### 5. **Create Metadata File**

```bash
# Create the metadata file
mkdir -p metadata/com.hyliankid14.bbcradioplayer
nano metadata/com.hyliankid14.bbcradioplayer.yml

# Paste the YAML content from the "F-Droid Metadata File" section above
# Save and exit (Ctrl+X, Y, Enter)
```

#### 6. **Test Locally (Optional but Recommended)**

If you have fdroidserver installed:

```bash
# Validate metadata
fdroid lint com.hyliankid14.bbcradioplayer

# Try building (this will clone your repo and build it)
fdroid build com.hyliankid14.bbcradioplayer:17
```

Don't worry if you don't have fdroidserver - F-Droid CI will test it.

#### 7. **Commit and Push**

```bash
git checkout -b add-bbc-radio-player
git add metadata/com.hyliankid14.bbcradioplayer.yml
git commit -m "New app: BBC Radio Player

BBC Radio Player is a feature-rich Android app for streaming 80+ BBC Radio
stations with Android Auto integration and podcast support.

- No tracking or analytics
- No advertisements  
- GPL-3.0 licensed
- No proprietary dependencies in fdroid flavor
"
git push origin add-bbc-radio-player
```

#### 8. **Create Merge Request on GitLab**

1. Go to your fork on GitLab
2. You'll see a prompt to create a merge request
3. Click **Create merge request**
4. Fill in:
   - **Title:** `New app: BBC Radio Player`
   - **Description:**
   ```
   Adding BBC Radio Player - A feature-rich Android app for streaming BBC Radio stations.
   
   **App Details:**
   - Package: com.hyliankid14.bbcradioplayer
   - License: GPL-3.0-or-later
   - Source: https://github.com/shaivure/Android-Auto-Radio-Player
   - Current version: 0.11.0 (versionCode 17)
   
   **F-Droid Compliance:**
   - ✅ FOSS licensed (GPL-3.0)
   - ✅ Build flavor `fdroid` removes all GMS dependencies
   - ✅ No tracking or analytics
   - ✅ No advertisements
   - ✅ Builds from source with Gradle
   
   **Features:**
   - 80+ BBC Radio stations
   - Android Auto integration (MediaBrowserService, no GMS required)
   - Podcast support with downloads
   - Material Design 3 interface
   
  **Note:** Uses BBC public APIs for streaming and metadata. Podcast language
  identification uses RSS metadata + heuristic text/script analysis.
   ```
5. Click **Create merge request**

#### 9. **Wait for CI and Review**

- F-Droid's CI will automatically test building your app
- Reviewers will check the metadata and compliance
- They may ask questions or request changes
- Respond to feedback promptly

#### 10. **Once Merged**

- Your app metadata is added to F-Droid's repository
- Build server will build your app within 24-48 hours
- App appears in F-Droid catalog
- Users can install it!

---

## 🔍 Common Review Questions

Be prepared to answer:

### "Does this app require Google Play Services?"

**Answer:**
```
No. The `fdroid` build flavor removes all Google-specific dependencies.
Android Auto works via standard MediaBrowserService without GMS.
Podcast language detection uses RSS metadata + heuristic text/script analysis.
```

### "What APIs does this app use?"

**Answer:**
```
The app uses publicly accessible BBC APIs:
- BBC RMS API (rms.api.bbc.co.uk) - Live show metadata
- BBC ESS API (ess.api.bbci.co.uk) - Schedule information
- BBC Sounds Files - Station logos and artwork
- BBC Podcast OPML feed - Podcast directory
- Stream URLs from lsn.lv (third-party BBC stream aggregator)

These are public APIs used by the BBC Sounds web player and are
accessed without authentication.
```

### "Why does this need cleartext traffic?"

**Answer:**
```
The lsn.lv stream aggregator serves some BBC stream URLs over HTTP.
Most of the app uses HTTPS, but the manifest flag is needed for
stream playback compatibility.
```

---

## ⏱️ Timeline Expectations

**If you submit via Metadata Merge Request:**

- **Day 1:** Submit merge request
- **Day 1-3:** CI builds and tests your app
- **Day 3-7:** F-Droid reviewers examine metadata
- **Day 7-14:** Merge request approved and merged
- **Day 15-16:** F-Droid build server builds and signs your app
- **Day 16+:** App appears in F-Droid catalog

**Total:** ~2-3 weeks from submission to availability

**If you use Submission Queue instead:**

- **Week 1-12:** Waiting for someone to pick it up
- **Week 12-14:** Review and metadata creation
- **Week 14-15:** Build and publish

**Total:** ~3-4 months

**Recommendation:** Use Metadata Merge Request for faster inclusion!

---

## 📚 Resources

### F-Droid Documentation
- [Inclusion How-To](https://f-droid.org/en/docs/Inclusion_How-To/)
- [Build Metadata Reference](https://f-droid.org/en/docs/Build_Metadata_Reference/)
- [Inclusion Policy](https://f-droid.org/en/docs/Inclusion_Policy/)
- [Repository Style Guide](https://f-droid.org/en/docs/Repository_Style_Guide/)
- [All About Descriptions](https://f-droid.org/en/docs/All_About_Descriptions_Graphics_and_Screenshots/)

### F-Droid GitLab
- [fdroiddata Repository](https://gitlab.com/fdroid/fdroiddata)
- [Contributing Guide](https://gitlab.com/fdroid/fdroiddata/-/blob/master/CONTRIBUTING.md)
- [Metadata Examples](https://gitlab.com/fdroid/fdroiddata/-/tree/master/metadata)

### Your Project
- [GitHub Repository](https://github.com/shaivure/Android-Auto-Radio-Player)
- [Previous Analysis](FDROID_SUBMISSION_ANALYSIS.md)
- [Analytics Guide](docs/ANALYTICS_IMPLEMENTATION_GUIDE.md)

---

## ✅ Quick Checklist

Before submitting, verify:

- [ ] LICENSE file in repository root ✅ (You have this!)
- [ ] Git tags match version codes
- [ ] GMS metadata removed or in separate build flavor
- [ ] App builds successfully: `./gradlew assembleFdroidRelease`
- [ ] No proprietary dependencies in F-Droid build
- [ ] Metadata file created in fdroiddata fork
- [ ] Screenshots and descriptions added (optional but recommended)
- [ ] Merge request created on GitLab
- [ ] Responded to CI feedback

---

## 🆘 Getting Help

If you run into issues:

1. **F-Droid Forum:** https://forum.f-droid.org/
2. **Matrix Chat:** #fdroid:f-droid.org
3. **GitLab Issues:** Comment on your merge request
4. **Email:** team@f-droid.org

---

## 🎯 Summary

**YES, you can submit from GitHub!** Here's the short version:

1. ✅ Fix your app (remove/flavor GMS metadata)
2. ✅ Create git tag for your release
3. ✅ Fork fdroiddata on GitLab
4. ✅ Create metadata YAML pointing to your GitHub repo
5. ✅ Submit merge request
6. ✅ Wait ~2 weeks for approval and build

Your app source stays on GitHub. Only the metadata file lives on GitLab.

**Ready to submit?** Follow the "Submission Process" section above!

Good luck! 🚀
