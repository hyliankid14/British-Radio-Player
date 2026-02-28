# F-Droid Submission - Next Steps Checklist

**Current Status:** ✅ Ready to Submit!  
**Date:** 28 February 2026

---

## ✅ Completed

- [x] LICENSE file (GPL-3.0) in repository root
- [x] Public GitHub repository
- [x] Gradle build system (fully supported)
- [x] Build flavors implemented (`fdroid` and `play`)
- [x] GMS metadata handled (removed from main, in play flavor only)
- [x] Both flavors build successfully
- [x] Git repository with clean history
- [x] Current version: 1.0.7 (versionCode: 26)

---

## 📋 Pre-Submission Steps (Do These First)

### Step 1: Create Git Tag for Current Release
```bash
cd /home/shaivure/Development/BBC\ Radio\ Player

# Create a tag for the current version
git tag -a v1.0.7 -m "Release 1.0.7 - F-Droid Ready"

# Push the tag to GitHub
git push origin v1.0.7

# Verify it worked
git tag -l
```

### Step 2: Verify the fdroid Flavor Builds
```bash
# Test F-Droid build locally
./gradlew assembleFdroidRelease

# Verify the APK was created
ls -lh app/build/outputs/apk/fdroid/release/
```

### Step 3: Get F-Droid Metadata Files Ready

Download your existing app metadata from the [Fastlane/Triple-T](https://fastlane.tools/) directory structure if you have one, or create new ones.

You'll need to create (in your GitHub repo - optional but recommended):
```
metadata/
└── en-US/
    ├── title.txt                    # "BBC Radio Player"
    ├── short_description.txt        # One-line summary
    ├── full_description.txt         # Detailed description
    └── images/
        ├── icon.png                 # 512x512
        └── phoneScreenshots/
            ├── 1.png                # At least 2-4 screenshots
            ├── 2.png
            ├── 3.png
            └── 4.png
```

**Simple versions:**

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
A feature-rich Android app for streaming BBC Radio stations with 
seamless Android Auto integration, podcast support with downloads, 
and Material Design 3 interface.

• 80+ BBC Radio stations (National, Regional, Local)
• Android Auto integration with MediaBrowserService
• Podcast support with subscriptions and downloads
• Favorites management with drag-and-drop reordering
• Live metadata and show information
• Material Design 3 with light and dark themes
• No tracking, no ads, completely free and open source

Note: Requires internet connection to stream BBC Radio content.
```

---

## 🚀 Submission Method: Metadata Merge Request (Recommended)

**Timeline:** ~2 weeks to availability  
**Process:** Upload metadata to F-Droid's GitLab, they build from your GitHub

### Step 4: Fork F-Droid Repository

1. Go to: https://gitlab.com/fdroid/fdroiddata
2. Click **Fork** (top right)
3. Select your namespace (your personal account)
4. Click **Fork project**

### Step 5: Clone Your Fork

```bash
# Clone your fork
git clone https://gitlab.com/YOUR_GITLAB_USERNAME/fdroiddata.git
cd fdroiddata

# Add upstream for reference
git remote add upstream https://gitlab.com/fdroid/fdroiddata.git
```

### Step 6: Create Metadata File

Create the file: `metadata/com.hyliankid14.bbcradioplayer.yml`

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
Summary: Stream 80+ BBC Radio stations with Android Auto support

Description: |-
  A feature-rich Android app for streaming BBC Radio stations with seamless
  Android Auto integration, comprehensive podcast support with downloads and
  subscriptions, intelligent playback features, and a modern Material Design 3
  interface.
  
  Features:
  • Full Android Auto MediaBrowserService integration
  • 80+ BBC Radio stations (National, Regional, Local)
  • Podcast support with subscriptions and downloads
  • Episode download management with WiFi-only option
  • Favorites management with drag-and-drop reordering
  • Live metadata and show information
  • Material Design 3 with light and dark themes
  • No tracking, no ads, completely free and open source
  
  Note: Requires internet connection to stream BBC Radio content.

RepoType: git
Repo: https://github.com/shaivure/Android-Auto-Radio-Player.git

Builds:
  - versionName: 1.0.7
    versionCode: 26
    commit: v1.0.7
    subdir: app
    gradle:
      - fdroid

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: 1.0.7
CurrentVersionCode: 26
```

### Step 7: Commit and Push to Your Fork

```bash
cd fdroiddata

# Create a branch for this submission
git checkout -b add-bbc-radio-player

# Create directory if needed
mkdir -p metadata/com.hyliankid14.bbcradioplayer

# Add the metadata file
git add metadata/com.hyliankid14.bbcradioplayer.yml

# Commit with descriptive message
git commit -m "New app: BBC Radio Player

BBC Radio Player is a feature-rich Android app for streaming 80+ BBC Radio
stations with Android Auto integration and comprehensive podcast support.

- No tracking or analytics
- No advertisements
- GPL-3.0 licensed
- F-Droid flavour uses standard Android APIs (no proprietary dependencies)
- Homepage: https://github.com/shaivure/Android-Auto-Radio-Player"

# Push to your fork
git push origin add-bbc-radio-player
```

### Step 8: Create Merge Request

1. Go to your fork on GitLab
2. You'll see a prompt to create a merge request
   - Or go to **Merge Requests** → **New Merge Request**
3. Select source branch: `add-bbc-radio-player`
4. Select target branch: `master` (in fdroid/fdroiddata)
5. Click **Compare branches and continue**

**Fill in the merge request details:**

**Title:**
```
New app: BBC Radio Player
```

**Description:**
```
Adding BBC Radio Player to F-Droid

**App Details:**
- Package: com.hyliankid14.bbcradioplayer
- License: GPL-3.0-or-later
- Source: https://github.com/shaivure/Android-Auto-Radio-Player
- Current version: 1.0.7 (versionCode 26)

**F-Droid Compliance:**
✅ FOSS licensed (GPL-3.0-or-later)
✅ Build flavor 'fdroid' removes all GMS dependencies
✅ Builds from source with Gradle
✅ No tracking or analytics
✅ No advertisements
✅ No proprietary dependencies in F-Droid builds

**Features:**
- 80+ BBC Radio stations (National, Regional, Local)
- Android Auto integration via standard MediaBrowserService
- Podcast support with downloads and subscriptions
- Material Design 3 interface with light/dark modes
- Favorites management with drag-and-drop reordering

**Notes:**
- Requires internet for streaming BBC Radio content
- Uses publicly available BBC APIs (RMS, ESS, Sounds)
- Podcast language identification uses RSS metadata + heuristic text/script analysis
- Stream URLs sourced from lsn.lv (third-party BBC stream aggregator)

Ready for review and CI testing.
```

6. Click **Create merge request**

### Step 9: Wait for CI and Review

F-Droid's CI will automatically:
1. ✅ Validate metadata file format
2. ✅ Clone your GitHub repository
3. ✅ Build the app with the `fdroid` flavor
4. ✅ Check for FOSS compliance
5. ✅ Verify no binary blobs or proprietary libraries

**Expected timeline:**
- **Hours 0-2:** CI runs and builds
- **Days 1-5:** F-Droid reviewer examines metadata
- **Days 5-7:** Any questions/feedback in comments
- **Days 7-14:** Merge approved by F-Droid maintainer
- **Days 14-16:** F-Droid build server builds and signs your app
- **Day 16+:** App appears in F-Droid catalog

### Step 10: Respond to Any Feedback

F-Droid reviewers may ask about:
- API usage (BBC RMS, ESS, Sounds)
- Stream provider (lsn.lv)
- Android Auto functionality without GMS

**Simple answers:**
```
Q: Does this use Google Play Services?
A: No. The 'fdroid' flavor builds without any GMS dependencies. 
   Android Auto works via the standard MediaBrowserService interface.

Q: What APIs does this use?
A: The app uses publicly accessible BBC APIs:
   - BBC RMS API (rms.api.bbc.co.uk) - Live show metadata
   - BBC ESS API (ess.api.bbci.co.uk) - Schedule information
   - BBC Sounds Files - Station logos and artwork
   - BBC Podcast OPML feed - Podcast directory
   All are public APIs used by BBC Sounds web player, no auth required.

Q: Are the APIs documented?
A: These are internal BBC APIs discovered through the SDK 
   (similar to reverse engineering). The BBC Sounds app uses them.
```

---

## 📱 After Merge: What Happens

1. **Your metadata is added** to F-Droid's master branch
2. **F-Droid build server** fetches your repo and builds
3. **APK is signed** by F-Droid's key
4. **Added to F-Droid catalog** within 24-48 hours
5. **Users can search and install** from F-Droid app

---

## 🎉 Success Indicators

You'll know it's working when:
- ✅ Merge request is merged to `master` branch
- ✅ [F-Droid Monitor](https://monitor.f-droid.org/) shows your app building
- ✅ Build succeeds with green checkmark
- ✅ Your app appears in [F-Droid repository](https://f-droid.org/packages/)
- ✅ Users can download from F-Droid client

---

## 🔗 Useful Links

- **F-Droid Build Metadata Reference:** https://f-droid.org/en/docs/Build_Metadata_Reference/
- **Repository Contributing:** https://gitlab.com/fdroid/fdroiddata/-/blob/master/CONTRIBUTING.md
- **Your GitHub Repo:** https://github.com/shaivure/Android-Auto-Radio-Player
- **F-Droid Inclusion Policy:** https://f-droid.org/en/docs/Inclusion_Policy/
- **F-Droid Support:** https://forum.f-droid.org/

---

## ⏱️ Estimated Timeline

| Step | What | Time |
|------|------|------|
| 1-3 | Local prep (tag, build, metadata) | ~30 min |
| 4 | Fork fdroiddata | ~5 min |
| 5-8 | Create and submit MR | ~20 min |
| 9 | Total prep time | **~1 hour** ✅ |
| | F-Droid CI builds (automatic) | 2-6 hours |
| | F-Droid review | 3-7 days |
| | Final build and sign | 1-2 days |
| | Live on F-Droid | ~2 weeks total |

---

## ✅ Ready to Go?

You're ready to submit! All the hard work is done:
- ✅ Build flavors implemented
- ✅ GMS metadata properly isolated
- ✅ App builds cleanly for F-Droid
- ✅ License in place
- ✅ Code quality verified

**Next action:** Jump to **Step 4: Fork F-Droid Repository** above and submit your merge request!

Good luck! 🚀
