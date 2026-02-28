# F-Droid Submission Draft

This folder contains starter metadata for submitting to F-Droid.

## Included files

- `com.hyliankid14.bbcradioplayer.yml`: initial app metadata/build recipe draft
- `en-US/short_description.txt`: short app description
- `en-US/full_description.txt`: full app description

## Notes

- Review `versionName`, `versionCode`, and `commit` before submission.
- Replace `commit: master` with a release tag/commit for reproducibility.
- Add screenshots and icon assets in the structure expected by `fdroiddata`.
- Run F-Droid metadata linting in your `fdroiddata` fork before creating a MR.
- Keep F-Droid release notes explicit that Android Auto discovery may differ from Play/GitHub builds.
- For Android Auto visibility on Google-powered head units, non-F-Droid builds should include:

```xml
<meta-data
		android:name="com.google.android.gms.car.application"
		android:resource="@xml/automotive_app_desc" />
```

- Recommended distribution strategy: publish two APK variants so users can choose the install path they prefer:
	- Standard/Play/GitHub APK with Android Auto metadata enabled.
	- F-Droid APK with Google car metadata removed.
