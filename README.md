# Crate Digger

A 100% client-side web app for discovering music on SoundCloud by tracking the tastemakers (DJs, labels, producers) you trust.

## Features

- **Tastemaker Tracking:** Follow specific SoundCloud users.
- **Aggregated Feed:** See a chronological feed of their likes, reposts, and comments.
- **Discovery Queue:** Tracks "new since last sync" so you never miss a beat.
- **Local Storage:** All data is stored in your browser (IndexedDB). No backend server.
- **Privacy:** Connects directly to SoundCloud API from your browser.

## Setup

### 1. GitHub Pages Hosting
This app is designed to run on GitHub Pages.

1. Go to your repository **Settings**.
2. Click **Pages** in the sidebar.
3. Under **Build and deployment** > **Source**, select **Deploy from a branch**.
4. Select branch `main` and folder `/ (root)`.
5. Click **Save**.

Your site will be live at `https://emilva.github.io/crate-digger/`.

### 2. SoundCloud App Registration
To use the API, you need a Client ID.

1. Go to [SoundCloud for Developers](https://soundcloud.com/you/apps).
2. Create a new app.
3. **Important:** Set the **Redirect URI** to:
   `https://emilva.github.io/crate-digger/callback.html`
   *(If running locally, also add `http://localhost:8000/callback.html`)*
4. Copy the **Client ID**.
5. Open `js/soundcloud.js` in this repo and replace `'YOUR_SOUNDCLOUD_CLIENT_ID'` with your new ID.
6. Commit and push the change.

## Local Development

Since this uses OAuth, you cannot just open `index.html` file directly. You must serve it.

```bash
# Python 3
python3 -m http.server 8000

# or Node.js
npx serve .
```

Then open `http://localhost:8000`.
