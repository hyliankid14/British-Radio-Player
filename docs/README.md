# British Radio Player - Web Share UI

This directory hosts the GitHub Pages web UI for sharing podcasts and episodes from the British Radio Player app.

## Quick Setup

### 1. Enable GitHub Pages

1. Go to your repository settings on GitHub
2. Navigate to **Pages** section (under "Code and automation")
3. Under **Source**, select:
   - Branch: `main`
   - Folder: `/docs`
4. Click **Save**
5. GitHub will provide your URL: `https://yourusername.github.io/British-Radio-Player/`

### 2. Update ShareUtil.kt

Update the web base URL in your app:

```kotlin
// File: app/src/main/java/com/hyliankid14/bbcradioplayer/ShareUtil.kt
// Replace this line:
private const val WEB_BASE_URL = "https://bbcradioplayer.app"

// With your actual GitHub Pages URL:
private const val WEB_BASE_URL = "https://yourusername.github.io/British-Radio-Player"
```

### 3. Deploy

Commit and push your changes:

```bash
git add docs/
git commit -m "Add web player for sharing"
git push origin main
```

Your web player will be live at `https://yourusername.github.io/British-Radio-Player/` within 1-2 minutes!

## Testing

### Test as a PWA (including iPhone)

1. Open the deployed site in Safari on your iPhone.
2. Tap **Share** → **Add to Home Screen**.
3. Launch the installed app from the home screen.
4. Confirm pages load and shared links open inside the installed web app.
5. Temporarily disconnect network to verify the offline fallback page appears.

Notes:
- Service worker and manifest are now included for installability.
- iOS does not always show an automatic install prompt; use Safari's **Add to Home Screen** flow.

### Test the Web Player

Visit: `https://yourusername.github.io/British-Radio-Player/p/example-1`

You should see the podcast sharing page load.

### Test Deep Links

Share a podcast from your app and check that the generated URL works:

1. Open your app and navigate to a podcast
2. Tap the share button
3. Select "Copy to clipboard"
4. Paste the URL in a browser - should open the web player
5. If you have the app installed, tap "Open in App" - should launch your app

## How It Works

### Share Flow

1. **User shares** → ShareUtil generates web URL
2. **Recipient clicks link** → Opens web player
3. **If app installed** → "Open in App" button triggers deep link
4. **If no app** → Web player shows audio and subscribe options

### URL Structure

- **Podcasts**: `/p/{podcastId}` → Example: `/p/bbc-sounds-123`
- **Episodes**: `/e/{episodeId}` → Example: `/e/episode-456`

## Customization

### Update Branding

Edit [index.html](index.html) to customize:

- Colors and gradients (search for `#667eea` and `#764ba2`)
- App name and descriptions
- Button text and emojis
- Google Play Store link

### Add Real Data

The web player currently uses mock data. To integrate real podcast information:

#### Option 1: Fetch from Your Backend

```javascript
async loadContent(type, id) {
    const response = await fetch(`https://your-api.com/api/${type}/${id}`);
    const data = await response.json();
    this.currentContent = data;
    this.render();
}
```

#### Option 2: Use Podcast Index API

```javascript
// Get podcast data from PodcastIndex.org
const response = await fetch(
    `https://api.podcastindex.org/api/1.0/podcasts/byid?id=${id}`
);
```

#### Option 3: Generate Static Pages

Build static HTML files for each podcast/episode during your build process.

## Optional: Custom Domain

If you own a domain like `bbcradioplayer.app`:

1. Add a `CNAME` file to this `/docs` directory:
   ```
   bbcradioplayer.app
   ```

2. Configure DNS with your domain provider:
   - Add A records pointing to:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - Or add a CNAME record pointing to: `yourusername.github.io`

3. Wait 5-15 minutes for DNS propagation

4. Enable HTTPS in GitHub Pages settings (automatic with custom domains)

## Troubleshooting

### Web Player Not Loading

- Wait 1-2 minutes after enabling GitHub Pages
- Check that `/docs` folder is selected in settings
- Clear browser cache and try again
- Verify the URL matches: `https://username.github.io/repo-name/`

### Deep Links Not Working

- Ensure AndroidManifest.xml has the correct intent filters
- Verify ShareUtil.parseShareLink() is called in MainActivity
- Test with: `adb shell am start -a android.intent.action.VIEW -d "app://podcast/test"`

### Audio Not Playing

- Verify audio URL uses HTTPS (required by modern browsers)
- Check CORS headers on your audio hosting
- Test audio URL directly in browser

## Analytics (Optional)

Track sharing engagement by adding Google Analytics to [index.html](index.html):

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'YOUR_GA_ID');
</script>
```

## Support

For issues or questions, open an issue in this repository.
