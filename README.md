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

## Accounts (logins)

Everyone logs in with a username and the team code. There are no passwords: the server checks the team code
and logs the person in (src/login.js). A new username gets an account straight away. "Remember me" keeps a device
logged in until the person logs out. Anyone with the team code can open any account by typing its username:
that's the trade-off for no passwords, so keep the code inside the team.

Projects (the edit: lyrics, timing, style, cuts, texts) and linked YouTube, Instagram and TikTok accounts belong to
the account and follow it to any device. Songs and footage stay in the browser they were added in.

- The accounts live in Supabase. Run `supabase/schema.sql` once in the project's SQL editor (tables, row-level
  security, the team-code check), and turn off "Confirm email" under Authentication > Sign In / Providers.
- On the host: `SUPABASE_URL` and `SUPABASE_KEY` (the publishable key, a public value), `TEAM_CODE`, and
  `TOKEN_KEY` (already used for linked accounts; the login secrets are worked out from it, so changing it locks
  everyone out of their accounts).
- Each username is stored in Supabase as `<username>@users.lyrics.stellarmusic.dk`; no mail is sent there.
- Changing the team code: set `TEAM_CODE` on the host and redeploy, and run in the SQL editor
  `insert into private.settings (key, value) values ('team_code', 'NEW-CODE') on conflict (key) do update set value = excluded.value;`
  Capitals don't matter. Everyone keeps their account; they just type the new code.
- An email for every new account: make a free account at resend.com with the address that should get the emails
  (linas@stellarmusic.dk), create an API key and set it as `RESEND_API_KEY`. `NOTIFY_EMAIL` changes the address.
- Without the Supabase settings the studio falls back to the single shared passcode (`SLS_PASSCODE`).

## Scheduled posts, the calendar and results

People can schedule a post for later when posting, and see every post in the calendar (start screen: calendar).
The studio keeps each post in the `posts` table (supabase/schema.sql). Every 5 minutes Supabase's pg_cron calls
`/api/cron` (src/schedule.js), which posts what's due, checks on posts that are still processing, and reads back
views, likes and comments now and then (YouTube and Instagram; TikTok once the app may use `video.list`).

- Run the posts part of `supabase/schema.sql` in the SQL editor (it also turns on pg_cron and pg_net and sets the job).
- On the host: `SUPABASE_SECRET_KEY` = the project's secret key (Supabase > Project Settings > API Keys). The
  scheduler needs it to read everyone's due posts and their sealed account logins.
- Optional: `RESEND_API_KEY` (see Accounts) for an email to the owner when a scheduled post goes live or fails.
- The video of a scheduled post waits in Vercel Blob until it's posted, then it's deleted.
