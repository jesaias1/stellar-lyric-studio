# Stellar Lyric Studio

Lyric videos for social media from just a song. Drop a track, the lyrics are written and timed for you,
you check them, pick a style and export a video.

## How it is put together

| Part | Where | What it does |
| --- | --- | --- |
| The app | `public/` | Plain HTML, CSS and JavaScript. No build step. |
| The editor engine | `public/js/studio.js`, `public/css/studio.css` | The V0.1 studio: preview, styles, clips, timeline, export. |
| The guided flow | `public/js/app.js`, `public/css/sls.css` | Splash, start screen, the four steps, and the editor's light/dark switch (the blue start screen is the same in both). The Stellar Music design lives in `public/css/brand.css`. |
| Lyric AI pipeline | `public/js/transcribe.js` | Cuts the song into pieces, has them transcribed twice, compares the two passes and marks words it is unsure about. |
| Lyric review | `public/js/lyrics.js` | Click a word to fix it, keep or correct the unsure ones. |
| More lyric styles | `public/js/styles-extra.js` | Glow, Cinematic and Playful styles, plus more Bold and Layered ones. |
| Footage | `public/js/footage.js`, `src/media.js` | Free stock video search (Pixabay, Pexels) and AI backgrounds written from the lyrics (Higgsfield). |
| Photos | `public/js/photos.js`, `src/photos.js` | The image grabber: keywords or a prompt plus the lyrics go in, the AI searches free photos (Pexels, Pixabay) and/or Pinterest and ranks the results, one image per lyric line comes out. A review window throws out the bad ones. Moodboards: your own image sets (files or a public Pinterest board), kept in the browser. |
| Safe zones | `public/js/safezones.js` | Shows where TikTok, Reels, Shorts, Stories and YouTube put their buttons. Never exported. |
| Export | `public/js/export.js`, `public/vendor/` | Renders the soundbite frame by frame and encodes MP4, MOV, WebM or MKV in the browser (mediabunny, MPL-2.0). |
| Projects | `public/js/projects.js` | Every song is a project, saved in the browser (IndexedDB) with its song file, clips and settings; autosaves, and a refresh reopens it. |
| Posting | `public/js/publish.js`, `src/publish.js` | Link YouTube channels, Instagram accounts and TikTok accounts (as many as you like, grouped by artist) and post the exported video to them in one go. Accounts are kept in the browser that linked them, sealed so only the server can use the logins. |
| Templates | `public/js/templates.js` | Reusable looks: pick which parts a template carries, starter looks built in. |
| Backend | `src/worker.js` | Passcode check, the Whisper call, shared templates. Runs as a Cloudflare Worker, or on Vercel through `api/index.js`. |

The speech model is Whisper large v3 turbo on Cloudflare Workers AI. It handles about 100 languages and returns a
time for every word.

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:8787. The passcode for local use is in `.dev.vars` (copy `.dev.vars.example` if it is missing).
Locally the lyric AI answers with a canned sample unless `.dev.vars` has `CF_ACCOUNT_ID` and `CF_API_TOKEN`.

## Put it online

**Cloudflare** (the lyric AI needs no extra keys there):

```bash
npx wrangler secret put SLS_PASSCODE -c wrangler.jsonc
npm run deploy
```

**Vercel**: import the repo, then add `SLS_PASSCODE`, `CF_ACCOUNT_ID` and `CF_API_TOKEN` under
Settings > Environment Variables. The token needs "Workers AI" access.

Optional keys, for footage and photos:

| Key | Where to get it | Switches on |
| --- | --- | --- |
| `PIXABAY_KEY` | free, https://pixabay.com/api/docs/ (log in) | stock video and free photo search |
| `PEXELS_KEY` | https://www.pexels.com/api/ (new keys are paused at the moment) | more stock video and free photos |
| `SERPAPI_KEY` | https://serpapi.com (250 free searches a month, then paid) | Pinterest in the image grabber |
| `HF_KEY_ID`, `HF_KEY_SECRET` | https://console.higgsfield.ai (API account with balance) | AI background clips |

Optional keys, for posting (the setup guide walks through getting each one):

| Key | Where to get it | Switches on |
| --- | --- | --- |
| `TOKEN_KEY` | any long random string you make up | seals the account logins (falls back to the passcode) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | https://console.cloud.google.com (OAuth client, YouTube Data API v3) | YouTube |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | https://developers.facebook.com/apps (Instagram API with Instagram login) | Instagram Reels |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | https://developers.tiktok.com (Login Kit + Content Posting API) | TikTok |

Instagram also needs the `PUBLISH` KV namespace (see `wrangler.jsonc`). Each platform's login must send people back to
`https://<your site>/api/oauth/youtube` (or `instagram`, `tiktok`). Posting needs the Cloudflare version of the site:
Vercel caps requests at 4.5 MB.

Set them the same way as the passcode, for example `npx wrangler secret put SERPAPI_KEY -c wrangler.jsonc`.
Pinterest has no public search API, so Pinterest results come through SerpApi; one image grab uses about 3 searches.
Pinterest images belong to whoever posted them: fine for drafts and moodboards, but the free photos are the safe
choice for videos you publish.

## Notes

- Songs are sent to the backend in 30 second pieces for transcription only. Nothing is stored.
- Projects are saved in the browser. Shared templates need the `TEMPLATES` storage (see `wrangler.jsonc`).
- `brand/` holds the original logo. `samples/` holds an example LRC and SRT.
