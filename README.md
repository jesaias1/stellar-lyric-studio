# Stellar Lyric Studio

Lyric videos for social media from just a song. Drop a track, the lyrics are written and timed for you,
you check them, pick a style and export a video.

## How it is put together

| Part | Where | What it does |
| --- | --- | --- |
| The app | `public/` | Plain HTML, CSS and JavaScript. No build step. |
| The editor engine | `public/js/studio.js`, `public/css/studio.css` | The V0.1 studio: preview, styles, clips, timeline, export. |
| The guided flow | `public/js/app.js`, `public/css/sls.css` | Splash, start screen, the four steps, light and dark looks. |
| Lyric AI pipeline | `public/js/transcribe.js` | Cuts the song into pieces, has them transcribed twice, compares the two passes and marks words it is unsure about. |
| Lyric review | `public/js/lyrics.js` | Click a word to fix it, keep or correct the unsure ones. |
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

## Notes

- Songs are sent to the backend in 30 second pieces for transcription only. Nothing is stored.
- Projects are saved in the browser. Shared templates need the `TEMPLATES` storage (see `wrangler.jsonc`).
- `brand/` holds the original logo. `samples/` holds an example LRC and SRT.
