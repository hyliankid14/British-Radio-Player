# Apple TV (tvOS) App Store Connect Listing

## Metadata

- **App Name**: British Radio Player
- **Subtitle** (30 chars max): `Live BBC Radio, Podcasts & EPG` (30 / 30)
- **Primary Category**: Music (or Entertainment)
- **Secondary Category**: News
- **Age Rating**: 12+ (Infrequent/Mild Realistic Violence, Sexual Content, or Profanity in live broadcast talk/comedy)
- **Bundle ID**: `com.hyliankid14.bbcradioplayer.tv`
- **SKU**: `BRPTV-01`
- **Version**: 2.1.0
- **Build**: 6

---

## Promotional Text (170 characters max)

> Experience all BBC live radio stations and podcasts on Apple TV with an interactive 7-day visual schedule guide, OLED ambient screensaver, and Top Shelf quick tuning.

---

## Keywords (100 characters max)

```
bbc,radio,player,podcasts,sounds,radio 1,radio 2,radio 4,epg,guide,uk,stations,lastfm,music,talk,news
```
*(96 characters)*

---

## Full Description

Bring the best of British live radio and on-demand podcasts to the biggest screen in your home. British Radio Player for Apple TV delivers the complete collection of BBC live radio stations and on-demand podcasts in an interface tailored specifically for tvOS and the Siri Remote.

### All BBC Radio Stations in One Place
- **National Networks**: BBC Radio 1, 1Xtra, Radio 2, Radio 3, Radio 4, 4 Extra, Radio 5 Live, 5 Sports Extra, 6 Music, Asian Network, World Service, and BBC Sounds Live News.
- **Nations & Regions**: BBC Radio Scotland, Nan Gàidheal, Radio Wales, Radio Cymru, Cymru Fyw, Radio Ulster, and Radio Foyle.
- **Local BBC Stations**: Full coverage of all local BBC radio stations across England, from London and Manchester to Cornwall and Newcastle.
- **Favourites First**: Pin your most-listened stations to the top for instant one-click tuning.

### Interactive 7-Day Visual Programme Guide (EPG)
- Browse full schedules across today, tomorrow, and up to 7 days ahead.
- Timeline grid with 30-minute intervals and a real-time live indicator line.
- Dedicated Show Inspector panel displaying detailed programme synopses, broadcast time windows, and instant "Listen Live" and "Show Info" actions.
- One-click "Jump to Now" button to quickly center the guide on currently airing shows.

### On-Demand BBC Podcasts on the Big Screen
- Explore hundreds of popular BBC podcasts across comedy, drama, history, sports, true crime, and documentaries.
- Browse full episode lists with descriptions, publication dates, and duration.
- Resume playback seamlessly where you left off.
- High-contrast subscribe button to save podcasts directly to your Home tab.

### Immersive Now Playing & Station Idents
- Beautiful, high-resolution album artwork for currently playing tracks.
- Automatic fallback to custom BBC station brand idents for talk shows and tracks without cover art.
- Large, remote-friendly playback controls: Play/Pause, Rewind 15s, Fast-Forward 30s, and Favourite toggle.
- Live programme details and next show previews.

### OLED Ambient Screensaver Mode
- Designed specifically to prevent burn-in on OLED televisions while listening to radio.
- Subtle drifting clock and track metadata with floating animations against a pure black background.
- Configurable idle timers (1 min, 3 min, 5 min, 10 min) to suit your listening habits.

### Seamless Apple TV Integration
- **Apple TV Top Shelf**: Place British Radio Player on your top row to access your favourite stations directly from the tvOS Home Screen.
- **Last.fm Scrobbling**: Automatically scrobble live songs played on BBC Radio directly to your Last.fm profile.
- **Designed for Siri Remote**: High-contrast, luminous focus states with spacious padding guarantee smooth, effortless navigation.

---

## What’s New in Version 2.1.0

- **Brand New Apple TV App**: Full native tvOS experience with living-room-tuned audio playback.
- **Interactive EPG Guide**: 7-day visual schedule guide with sticky show titles, real-time live ruler, and detailed programme inspector.
- **On-Demand Podcasts**: Browse and listen to popular and subscribed BBC podcasts on the big screen.
- **OLED Ambient Screensaver**: Burn-in safe ambient mode with customizable timeout intervals.
- **Apple TV Top Shelf**: Instant station playback directly from your Apple TV Home Screen.
- **Last.fm Integration**: Real-time scrobbling of live broadcast tracks.

---

## Build Artifacts & Installation

- **App Store IPA**: `~/Downloads/british-radio-player-tvos.ipa`
- **Xcode Archive**: `~/Library/Developer/Xcode/Archives/2026-10-10/BRPTV 2026-10-10 23.39.49.xcarchive`
- **Rebuild Command**: `npm run build:tvos` (from `react-app/`)

### How to Upload to App Store Connect:
1. **Option 1 (Apple Transporter)**:
   - Download the free **Transporter** app from the Mac App Store.
   - Sign in with your Apple Developer account.
   - Drag and drop `~/Downloads/british-radio-player-tvos.ipa` and click **Deliver**.
2. **Option 2 (Xcode Organizer)**:
   - Open Xcode -> **Window** -> **Organizer** (or double-click the `.xcarchive` file).
   - Under the **tvOS Apps** tab, select **BRPTV (Version 2.1.0)**.
   - Click **Distribute App** -> **App Store Connect** -> **Upload**.
