# GitLab Web UI Steps - F-Droid Submission

**Copy-Paste Ready Guide**

---

## 📋 Prerequisites

Before starting, you should have:
- ✅ GitLab account (create at https://gitlab.com/user/sign_up if needed)
- ✅ GitHub repo with git tag created (`v1.0.7`)
- ✅ Build flavors implemented in your source code

---

## Step-by-Step Instructions

### STEP 1️⃣: Fork F-Droid's fdroiddata Repository

1. Go to: https://gitlab.com/fdroid/fdroiddata
2. Click the **Fork** button (top right, next to Star/Watch)
3. In the dialog that appears:
   - **Project name:** fdroiddata (keep default)
   - **Project slug:** fdroiddata (keep default)
   - **Namespace:** Select your personal account
   - Click **Fork project**
4. Wait for the fork to complete (you'll be redirected to your fork)
5. ✅ You now have your own copy: `https://gitlab.com/YOUR_USERNAME/fdroiddata`

---

### STEP 2️⃣: Create a New Branch for Your Submission

**In your fork** (gitlab.com/YOUR_USERNAME/fdroiddata):

1. On the left sidebar, click **Repository** → **Branches**
2. Click **New branch** button (top right)
3. Fill in the branch details:
   - **Branch name:** `add-bbc-radio-player` (or `com.hyliankid14.bbcradioplayer`)
   - **Create from branch:** `master` (should be selected by default)
4. Click **Create branch**
5. ✅ You now have a new branch to work on

---

### STEP 3️⃣: Navigate to the Metadata Directory

**In your fork** (gitlab.com/YOUR_USERNAME/fdroiddata):

1. Click **Code** in the left sidebar (or on the file icon)
2. You'll see the folder structure of fdroiddata
3. Open the **metadata** folder by clicking on it
4. ✅ You're now in `/metadata/` directory

---

### STEP 4️⃣: Create the Metadata File

**In the metadata directory:**

1. Click the **+** (plus icon) in the top right area, next to "Code"
2. Select **New file** from the dropdown menu
3. In the "File name" field at the top, type:
   ```
   com.hyliankid14.bbcradioplayer.yml
   ```
4. ✅ The filename is now set

---

### STEP 5️⃣: Add the Metadata Content

**In the file editor:**

1. Click in the large text area below the filename
2. **Copy the entire content below** and paste it into the editor
3. See "METADATA CONTENT" section below

---

### STEP 6️⃣: Create a Commit

**Below the file editor:**

1. In the **Commit message** field, copy and paste this exactly:
   ```
   New app: BBC Radio Player
   ```

2. In the **Commit message (optional)** field below it, copy and paste:
   ```
   Adds BBC Radio Player - A feature-rich Android app for streaming
   80+ BBC Radio stations with Android Auto integration and podcast
   support.
   
   - GPL-3.0 licensed
   - FOSS compliant
   - F-Droid build flavor removes all GMS dependencies
   - No tracking or analytics
   - No advertisements
   ```

3. Make sure **target branch** is set to `add-bbc-radio-player`

4. Leave **Create merge request** checkbox UNCHECKED (we'll do this separately)

5. Click **Commit changes** button

✅ File is now committed to your branch

---

### STEP 7️⃣: Navigate to Create a Merge Request

**In your fork:**

1. Click **Merge requests** in the left sidebar
2. Click **New merge request** button (top right)
3. You'll see a comparison screen

---

### STEP 8️⃣: Configure the Merge Request

**On the comparison screen:**

1. **Source branch:** `add-bbc-radio-player` (should show your new branch)
2. **Target branch:** 
   - Click the dropdown that shows the target
   - Select **fdroid/fdroiddata** (the upstream)
   - Then select branch **master**
3. Click **Compare branches and continue** button

---

### STEP 9️⃣: Fill in Merge Request Details

**On the merge request details page:**

1. **Title** field: Copy and paste exactly:
   ```
   New app: BBC Radio Player
   ```

2. **Description** field: Copy and paste:
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
   - ML Kit language detection library used for podcast language identification
   - Stream URLs sourced from lsn.lv (third-party BBC stream aggregator)

   Ready for review and CI testing.
   ```

3. Scroll down and click **Create merge request** button

✅ **Your merge request is now submitted!**

---

## METADATA CONTENT

**Copy everything below and paste into the file editor in STEP 5**

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
  • 80+ BBC Radio stations across the UK (National, Regional, Local)
  • Podcast support with subscriptions and downloads
  • Episode download management with WiFi-only option
  • Favorites management with drag-and-drop reordering
  • Live metadata and show information
  • Material Design 3 with light and dark themes
  • No tracking, no ads, completely free and open source

  Privacy:
  • No user tracking
  • No analytics by default
  • No Google Play Services in F-Droid build
  • No advertisements
  • Complete source code transparency

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

---

## ✅ After Submission

Once you click **Create merge request**, F-Droid's system will:

1. **Immediately:** Validate the metadata file
2. **Within 2-6 hours:** Trigger CI build
   - Clone your GitHub repo
   - Build the `fdroid` flavor
   - Run compliance checks
3. **Within 3-7 days:** F-Droid reviewer will examine the app
4. **Days 7-14:** Either merge or request changes
5. **After merge:** Build server compiles final APK
6. **Days 14-16:** App appears in F-Droid catalog

---

## ⏭️ What's Next After Submitting

1. **Watch your merge request** for comments from reviewers
2. **Respond promptly** if they ask questions
3. **Don't close or modify** the MR unless asked
4. **Check F-Droid Monitor** for build status: https://monitor.f-droid.org/
5. **Celebrate** when it appears on F-Droid! 🎉

---

## 🆘 If You Get Stuck

**Common Questions:**

**Q: I can't find the + button to create a new file**
A: Make sure you're in the `/metadata/` directory. The + button should be at the top right of the file listing area.

**Q: I don't see my fork**
A: Go directly to: `https://gitlab.com/YOUR_GITLAB_USERNAME/fdroiddata`
Replace `YOUR_GITLAB_USERNAME` with your actual GitLab username.

**Q: How do I check my GitLab username?**
A: Click your profile icon (top right) → **Preferences** → Look for "Username"

**Q: Can I edit the metadata after submitting?**
A: Yes! Just push more commits to the same branch. The MR will automatically update.

**Q: The build failed. What do I do?**
A: Check the CI logs in the MR. Post a comment asking for help. F-Droid reviewers are very helpful!

---

## 📱 Need visual help?

If you get lost:
1. Go to a similar app in fdroiddata: https://gitlab.com/fdroid/fdroiddata/-/tree/master/metadata
2. Look at existing `.yml` files to see the structure
3. Compare with the content provided above

---

## ✨ You're Ready!

You have everything you need. Follow the steps above, and your app will be on F-Droid! 🚀

**Questions? Post in:**
- F-Droid Forum: https://forum.f-droid.org/
- Your merge request comments
- Matrix: #fdroid:f-droid.org
