# Apple TV (tvOS) App Store Connect Listing

## Metadata

- **App Name**: British Radio Player
- **Subtitle** (30 chars max): `Live BBC Radio, Podcasts & EPG` (30 / 30)
- **Primary Category**: Music (or Entertainment)
- **Secondary Category**: News
- **Age Rating**: 12+ (Infrequent/Mild Realistic Violence, Sexual Content, or Profanity in live broadcast talk/comedy)
- **Bundle ID**: `com.hyliankid14.bbcradioplayer` *(Universal Purchase across iOS, tvOS & watchOS)*
- **Top Shelf Bundle ID**: `com.hyliankid14.bbcradioplayer.topshelf`
- **Version**: 1.0 (tvOS release)
- **Privacy Policy URL**: `https://shai.website/british-radio-player/privacy.html`
- **Support URL**: `https://shai.website/british-radio-player/`
- **Marketing URL**: `https://shai.website/british-radio-player/`

---

## App Privacy Declaration (App Store Connect)

When completing the **App Privacy** section in App Store Connect:

- **Data Collection**: Select **"No, we do not collect data from this app"**
- **Tracking**: Select **"No"**
- **Third-Party Advertising SDKs**: None (0)
- **Third-Party Tracking SDKs**: None (0)
- **On-Device Storage**: The app uses on-device `UserDefaults` purely for local preferences (favourite stations, podcast subscriptions, screensaver timeout) and does not transmit this data.
- **Privacy Manifest**: Included in the tvOS app bundle (`PrivacyInfo.xcprivacy`) with `NSPrivacyTracking = false` and `NSPrivacyCollectedDataTypes = []`.

---

## Apple TV Privacy Policy (Full Text for App Store Connect)

Copy and paste the text below directly into the **Apple TV Privacy Policy** field in App Store Connect:

```text
BRITISH RADIO PLAYER – APPLE TV PRIVACY POLICY

Effective Date: October 11, 2026
Version: 2.1.0
Developer: Shai Vure (shaivure@gmail.com)
Website: https://shai.website/british-radio-player/

1. COMMITMENT TO PRIVACY
British Radio Player is an independent, ad-free application built with strict privacy standards. We believe in complete transparency and user privacy. We collect zero personal data, zero advertising identifiers, and zero device information.

2. INFORMATION WE DO NOT COLLECT
British Radio Player does NOT collect, store, or share:
• Personal Information: No name, email, phone number, address, or contacts.
• Device Identifiers: No Advertising Identifier (IDFA), Vendor ID (IDFV), IMEI, or MAC address.
• Account Information: No sign-up, login, or user accounts are required to use the app.
• Location Data: We never access your device GPS or location.
• Financial or Payment Data: The app is completely free with no subscriptions or in-app purchases.
• Cross-App Tracking: We do not track your activity across other applications or websites.

3. DATA STORED LOCALLY ON YOUR APPLE TV
All application data is stored exclusively on your device in local on-device storage (UserDefaults):
• Favourite radio stations and subscribed podcasts.
• Quick-access Top Shelf station shortcuts.
• Podcast episode playback progress.
• User preferences (such as OLED screensaver timeout interval).
• Optional Last.fm credentials (if you choose to connect your Last.fm account).

This data never leaves your Apple TV and is automatically removed if you delete the application.

4. NETWORK CONNECTIONS & THIRD-PARTY SERVICES
When playing live radio or podcast episodes:
• Broadcast Feeds: Audio streams and podcast RSS feeds are fetched directly from public BBC broadcast servers. Standard HTTP request metadata (such as IP address) is processed by BBC servers in accordance with the BBC Privacy Policy.
• Last.fm (Optional): If you optionally connect your Last.fm profile, song titles and artist names are submitted solely to log your listening history to your personal Last.fm account.
• No Third-Party SDKs: British Radio Player contains no advertising networks, no social media tracking frameworks, and no third-party analytics SDKs.

5. CHILDREN'S PRIVACY
Because British Radio Player does not collect any personal data, it is safe for all audiences, including children.

6. CONTACT
For any questions regarding this privacy policy, please contact:
Developer: Shai Vure
Email: shaivure@gmail.com
Support & Full Policy: https://shai.website/british-radio-player/privacy.html
```

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
