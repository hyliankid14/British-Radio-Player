# Store Metadata

This folder contains store-ready text and images used for release channels.

## Structure

```
metadata/
├── play-store-assets/                          # Google Play listing assets
├── app-store/
│   └── review-notes.md                         # App Review Information notes + reply text
└── com.hyliankid14.bbcradioplayer/
    └── en-US/
        ├── title.txt                           # App display name
        ├── short_description.txt               # One-line tagline (<=80 chars)
        ├── full_description.txt                # Full store description
        └── images/
            ├── icon.png                        # 512x512 app icon
            └── phoneScreenshots/               # In-app screenshots
```

## Notes

- Keep screenshots and copy in sync with the latest release features.
- Ensure Play Store text reflects the current public build behaviour.
- `app-store/review-notes.md` is the source of truth for App Review. Re-diff it against
  `react-app/app.json` and `react-app/src` before every iOS submission, and archive the
  pasted text per version.
