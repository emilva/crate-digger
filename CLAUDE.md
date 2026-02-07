# CLAUDE.md

## Project Overview

Crate Digger is a client-side web app for discovering music by tracking SoundCloud tastemakers' likes. No backend — all data stored in IndexedDB via Dexie.js, deployed on GitHub Pages.

## Stack

- Vanilla JS (ES6 modules), HTML, CSS
- Dexie.js (IndexedDB)
- SoundCloud OAuth 2.0 PKCE + Public API
- Phosphor Icons

## SoundCloud API Constraints

**IMPORTANT: Only use `api.soundcloud.com` (V1 public API).**

- `api-v2.soundcloud.com` is an **undocumented internal API** — no CORS headers, will fail from the browser, and may violate SoundCloud's ToS.
- The V1 `/users/{id}/favorites` endpoint returns tracks ordered by most-recently-liked first, but does **not** include a `liked_at` timestamp — only the track's `created_at` (upload date).
- CORS is only enabled on `api.soundcloud.com` for GET requests.
- The code uses inferred `discoveredAt` timestamps (descending from sync time) to preserve the API's liked-order for sorting.
- Pagination: V1 supports `?limit=50&offset=N`. Current code fetches up to 4 pages (200 likes).

## Architecture

```
index.html          - App shell
js/main.js          - Core logic: sync, render, events
js/soundcloud.js    - OAuth PKCE + API wrapper
js/db.js            - Dexie schema (3 versions)
js/store.js         - Simple reactive state (Proxy)
css/styles.css      - Dark theme
```

## Key Design Decisions

- **New count tracking**: Uses `lastViewedAt` per tastemaker. Badge shows activities discovered after last view. Clicking a tastemaker in the sidebar marks them as viewed.
- **No alert() for errors**: Sync failures go to `console.error` only.
- **Cache busting**: All JS/CSS imports use `?v=N` query strings. Bump on deploy.
