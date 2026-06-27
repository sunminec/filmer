# Filmer 🎬

A **Telegram Mini App** — a personal tracker for films, series, games and anything else you want to keep lists of. Each entry has a rating, a watch date and a description.

Built as a single static web app (no build step): plain HTML + CSS + vanilla JS using the **Telegram WebApp SDK**.

## Features

- **Level 1 — Categories**: a vertical list of rounded category cards. Each card shows an icon, the name, an item counter (`12 items`) and a `>` chevron. Starter categories: **Films**, **Series**, **Games**. The **Add** button creates a new category (name only — an emoji icon is auto-guessed from the name).
- **Level 2 — Category items**: the list of entries inside a category. **Add** creates a new entry. Entries can be sorted **by rating**, **by date**, or **alphabetically (A–Z)**.
- **Entry form**: Name, Rating (0–10, shown as stars — tap a star to set; tap it again to step down), Watch date, Description.
- **Detail view**: full info for an entry (name, rating, watch date, description) with **Edit** and **Delete**.
- **Persistent storage**: data survives between sessions. Uses Telegram **CloudStorage** (synced across your devices) when the client supports it, with automatic fallback to **localStorage**.
- Clean, minimal, card-based UI — white background, blue accent, fully in English.
- Native Telegram integration: header/back button, haptic feedback, full-height expand.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup + loads the Telegram SDK |
| `styles.css` | All styling (light theme, blue accent) |
| `app.js` | App logic: state, storage, navigation, rendering, forms |

## Run locally (in a browser)

Open `index.html` over **http://** (not `file://`, so the SDK and date input behave). Any static server works:

```bash
# Python
python -m http.server 8080
# or Node
npx serve .
```

Then open `http://localhost:8080`. Outside Telegram it runs in "browser fallback" mode (own back button, localStorage) so you can develop and test the full UI.

## Deploy as a Telegram Mini App

1. **Host the three files** on any HTTPS static host — e.g. GitHub Pages, Netlify, Vercel, Cloudflare Pages. You'll get a public URL like `https://yourname.github.io/filmer/`.
2. **Create a bot** with [@BotFather](https://t.me/BotFather): `/newbot`, follow the prompts.
3. **Attach the Mini App** to the bot. Two common ways:
   - **Menu button**: in BotFather → `/mybots` → select bot → *Bot Settings* → *Menu Button* → *Configure menu button* → paste your HTTPS URL.
   - **Mini App**: `/newapp` → select bot → provide title, description, icon and the same HTTPS URL.
4. Open your bot in Telegram and tap the menu button (or the app link). Filmer launches inside Telegram.

> CloudStorage sync requires Telegram client API **6.9+** (essentially any current app); older clients automatically fall back to localStorage. Everything degrades gracefully.

## Notes

- All UI text is in English by design.
- No backend or accounts — your data lives in your own Telegram CloudStorage / device.
