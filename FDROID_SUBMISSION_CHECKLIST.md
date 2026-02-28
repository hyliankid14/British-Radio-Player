# F-Droid Submission Checklist

Print this out or keep it open while submitting! ✅

---

## Phase 1: Preparation (Do on Your Local Machine)

- [ ] Git tag created: `git tag -a v1.0.7 -m "Release 1.0.7"`
- [ ] Git tag pushed: `git push origin v1.0.7`
- [ ] Fdroid flavor builds: `./gradlew assembleFdroidRelease` ✅
- [ ] Verified build is clean and signed
- [ ] GitLab account created/ready
- [ ] GitHub repo is public and accessible
- [ ] LICENSE file present in repo root

**Status:** Ready for GitLab ✅

---

## Phase 2: GitLab Setup (Do on GitLab Website)

### Fork and Branch Setup
- [ ] Visited https://gitlab.com/fdroid/fdroiddata
- [ ] Clicked **Fork** button
- [ ] Fork completed at: `https://gitlab.com/YOUR_USERNAME/fdroiddata`
- [ ] Created new branch: `add-bbc-radio-player`
- [ ] Switched to new branch

### File Creation
- [ ] Navigated to `/metadata/` directory
- [ ] Clicked **+** button → **New file**
- [ ] Set filename: `com.hyliankid14.bbcradioplayer.yml`
- [ ] Pasted metadata content from GITLAB_SUBMISSION_STEPS.md
- [ ] Verified content looks correct
- [ ] Entered commit message: "New app: BBC Radio Player"
- [ ] Entered extended commit message
- [ ] Target branch set to: `add-bbc-radio-player`
- [ ] Clicked **Commit changes**

**Metadata File Committed:** ✅

---

## Phase 3: Merge Request Creation (Do on GitLab Website)

### Create MR
- [ ] Clicked **Merge requests** in sidebar
- [ ] Clicked **New merge request**
- [ ] Source branch: `add-bbc-radio-player` ✅
- [ ] Target: `fdroid/fdroiddata` → branch `master` ✅
- [ ] Clicked **Compare branches and continue**

### Fill MR Details
- [ ] Title: "New app: BBC Radio Player"
- [ ] Description: Filled with provided template
- [ ] Reviewed all text for accuracy
- [ ] Clicked **Create merge request**

**Merge Request Submitted:** ✅

---

## Phase 4: After Submission (Monitor Progress)

### Immediate (Hours 0-2)
- [ ] Merge request shows up in: https://gitlab.com/fdroid/fdroiddata/merge_requests
- [ ] Watched the MR for updates
- [ ] CI pipeline started (should see status indicator)

### Short Term (Hours 2-6)
- [ ] CI build runs
- [ ] Check F-Droid Monitor: https://monitor.f-droid.org/builds/running
- [ ] Look for your package: `com.hyliankid14.bbcradioplayer`
- [ ] Build should complete successfully

### Medium Term (Days 1-7)
- [ ] F-Droid reviewer examines metadata
- [ ] Check MR comments section for any feedback
- [ ] Respond promptly if questions are asked
- [ ] Make any requested changes by committing to same branch

### Long Term (Days 7-16)
- [ ] Merge request approved
- [ ] MR merged to master branch
- [ ] F-Droid build server creates signed APK
- [ ] App appears in F-Droid catalog

### Final (Day 16+)
- [ ] Search for your app on https://f-droid.org/packages/
- [ ] App is downloadable! 🎉
- [ ] Share on social media, your README, etc.

---

## ⏱️ Timeline Summary

| When | What | Status |
|------|------|--------|
| Now | Submit MR | You are here →  |
| +2-6 hrs | CI builds your app | Automated |
| +1-7 days | F-Droid reviews | Manual review |
| +7-14 days | Merged & signed | Automated |
| +14-16 days | Live on F-Droid | Published ✅ |

---

## 📞 Need Help?

**Before Asking For Help, Check:**
- [ ] Did I use the exact metadata from GITLAB_SUBMISSION_STEPS.md?
- [ ] Is my GitHub repo public?
- [ ] Does my repo have a LICENSE file?
- [ ] Is the git tag `v1.0.7` pushed to GitHub?
- [ ] Does the `fdroid` flavor build locally?

**Where to Ask:**
1. **MR Comments** - Add a comment directly on your MR
2. **F-Droid Forum** - https://forum.f-droid.org/
3. **Matrix Chat** - #fdroid:f-droid.org
4. **GitHub Issues** - On your own repo if it's a code issue

---

## 🎯 Success Criteria

Your submission is successful when:

✅ Merge request is created and visible  
✅ CI pipeline runs without errors  
✅ Merge request gets merged to master  
✅ App appears on F-Droid.org  
✅ Users can download from F-Droid app  

---

## 📚 Reference Documents

Keep these handy:
- [GITLAB_SUBMISSION_STEPS.md](GITLAB_SUBMISSION_STEPS.md) - Detailed steps with copy-paste content
- [BUILD_FLAVORS_IMPLEMENTATION.md](BUILD_FLAVORS_IMPLEMENTATION.md) - How your build flavors work
- [FDROID_SUBMISSION_GUIDE.md](FDROID_SUBMISSION_GUIDE.md) - Comprehensive background info
- [FDROID_NEXT_STEPS.md](FDROID_NEXT_STEPS.md) - Alternative detailed guide

---

## 🚀 Ready to Submit?

1. ✅ Have you read GITLAB_SUBMISSION_STEPS.md?
2. ✅ Do you have your metadata content?
3. ✅ Have you logged into GitLab?
4. ✅ Ready to fork fdroiddata?

**If YES to all, start with Step 1 in GITLAB_SUBMISSION_STEPS.md!**

Good luck! You've got this! 🎉
