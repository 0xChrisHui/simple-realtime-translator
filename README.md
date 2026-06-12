# Simple Realtime Translator

[![CI](https://github.com/0xChrisHui/simple-realtime-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/0xChrisHui/simple-realtime-translator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Live English ⇄ Chinese meeting captions in the browser, powered by Soniox or OpenAI Realtime Translation. Built for an in-person setup: a laptop captures speech, the browser runs full screen, and an HDMI-connected TV shows live captions.

中文使用说明：[`docs/zh-CN-quick-start.md`](docs/zh-CN-quick-start.md)

> **Status:** feature-complete and passively maintained. Issues and PRs are welcome but responses may be slow. Forking is encouraged.

<!-- TODO(deploy): replace with real screenshots after deployment -->
| Split view | Focus view |
| --- | --- |
| _screenshot coming soon_ | _screenshot coming soon_ |

## Live demo

<!-- TODO(deploy): replace with the real production URL -->
**[Try it live](https://your-app.vercel.app)** — click **Try 3 min free** and start talking. No sign-up, no key, no configuration: each visitor gets 2 free 3-minute trial sessions per day on the demo deployment. After the trial you can keep using it with your own (free-tier) Soniox key, or deploy your own instance below.

## Features

- English and Chinese realtime translation with OpenAI or Soniox provider switching
- **3-minute free trial** on the Soniox path — server-issued temporary keys, rate-limited per client and per day
- Soniox provider using the official Web SDK, direct browser WebSocket, and server-issued temporary API keys
- OpenAI provider using `gpt-realtime-translate` over WebRTC
- `Focus View` for one large reverse-translation caption, `Split View` for simultaneous English and Chinese captions
- Floating captions (Document Picture-in-Picture) for presenting slides while keeping subtitles visible
- Manual audio input selection, live input switching, adjustable per-language caption font sizes
- Local transcript autosave, crash recovery, and one-click `.txt` export
- Optional public-screen watermark through `NEXT_PUBLIC_WATERMARK_IMAGE`

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F0xChrisHui%2Fsimple-realtime-translator&env=SONIOX_API_KEY,SAFETY_SALT,TRIAL_ENABLED,ALLOWED_ORIGINS&envDescription=Soniox%20server%20key%20and%20free-trial%20gate%20settings%20(see%20README)&project-name=simple-realtime-translator)

1. Click the button above (or import the repo into Vercel manually).
2. Set the environment variables (table below). The minimal working set is `SONIOX_API_KEY` + `SAFETY_SALT` + `TRIAL_ENABLED=off` — that gives you a BYOK-only deployment with zero abuse surface.
3. To offer free trials on your deployment, set `TRIAL_ENABLED=full` and add the **Upstash Redis** integration from the [Vercel Marketplace](https://vercel.com/marketplace/upstash) (free tier is plenty). It auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Also set `ALLOWED_ORIGINS` to your production URL.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SONIOX_API_KEY` | — | Server-side Soniox key. Required for the trial path; optional otherwise (users can bring their own key). |
| `SAFETY_SALT` | built-in fallback | Random string. Hashes the per-visitor safety identifier and signs the trial quota cookie. Use a fresh random value in production. |
| `TRIAL_ENABLED` | `off` | Free-trial gate mode: `full` (Redis + cookie, recommended for production), `cookie-only` (no Redis — no global budget, clearing cookies bypasses the per-client cap), or `off`. |
| `TRIAL_SECONDS` | `180` | Trial session length, enforced server-side via the Soniox temporary key. |
| `TRIAL_PER_CLIENT_PER_DAY` | `2` | Trials per client (IP+UA hash) per UTC day. |
| `TRIAL_GLOBAL_PER_DAY` | `100` | Global trial budget per UTC day across all visitors (caps worst-case spend at roughly $1/day with defaults). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | — | Required when `TRIAL_ENABLED=full`. Auto-injected by the Vercel Upstash integration. |
| `ALLOWED_ORIGINS` | empty (check skipped) | Comma-separated origins allowed to use the trial, e.g. `https://your-app.vercel.app`. |
| `NEXT_PUBLIC_WATERMARK_IMAGE` | empty | Optional watermark image URL or `public/` path for the caption screen. |

Cost guard rails for a public deployment: the trial gate fails closed (Redis outage or misconfiguration denies trials instead of leaking keys), the global daily budget caps worst-case spend, and keeping only a small balance in your Soniox account is a natural stop-loss. Set a usage alert in the Soniox console too.

## Bring your own key

Both providers work with a key entered directly in the app (stored only in your browser's localStorage and never sent anywhere except the provider):

| Provider | Where to get an API key | Best fit | Estimated live caption cost |
| --- | --- | --- | --- |
| Soniox | [Build with Soniox](https://console.soniox.com/) (sign-up includes free credits), [pricing](https://soniox.com/pricing) | Long meetings and cost-sensitive bilingual captions | about `$0.12–$0.18/hour` for this app's realtime caption/translation use |
| OpenAI | [API keys](https://platform.openai.com/api-keys), [pricing](https://openai.com/api/pricing/) | OpenAI Realtime Translation with WebRTC | Focus view about `$2.04/hour` (one `gpt-realtime-translate` session at `$0.034/min`); Split view about `$4.08/hour` (two sessions, one per caption direction) |

Recommended default for long English/Chinese conference captions: Soniox — it is much cheaper for long sessions. For OpenAI, the connection layout is decided when you click `Start`: Focus view opens a single translation session that follows the detected spoken language, Split view opens two sessions. Pricing changes over time; check the provider pages before high-volume use.

## How it works

```txt
Browser ──POST /api/soniox/config──▶ trial gate ──▶ Soniox temporary key
   │         (no key? 4 checks: switch → origin → client quota → global budget)
   │         (own key? straight through, 5-hour session key)
   ├──────WebSocket──────────────▶ Soniox realtime STT + two-way translation
   │
   ├──POST /api/session──────────▶ OpenAI Realtime client secret (BYOK only)
   └──POST /api/call─────────────▶ OpenAI WebRTC SDP proxy
```

Three API routes, no database (trial quotas live in Upstash Redis + a signed cookie). For Soniox, the browser fetches a short-lived single-use temporary key from `/api/soniox/config` and connects directly to Soniox — the long-lived server key never reaches the browser. Without a user key, the route runs the trial gate first and issues a key limited to `TRIAL_SECONDS`. For OpenAI, the app is strictly bring-your-own-key.

Transcripts autosave to IndexedDB in the browser (recoverable after a crash or refresh) and export as `.txt` from the Save panel.

## Local development

```bash
npm install
cp .env.example .env.local   # then edit
npm run dev
```

Open <http://localhost:3000> and allow microphone access. Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
```

Notes:

- Trials work locally with `TRIAL_ENABLED=cookie-only` (no Redis needed); leave `ALLOWED_ORIGINS` empty to skip the Origin check in development.
- Use Chrome or Edge for the best floating-caption (Document Picture-in-Picture) behavior.
- Use headphones during testing if translated audio playback is enabled, otherwise the microphone may capture playback audio.

## License

[MIT](LICENSE)
