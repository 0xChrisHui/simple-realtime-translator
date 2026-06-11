# Simple Realtime Translator

A Vercel-ready Next.js app for English and Chinese live meeting translation using OpenAI Realtime Translation or Soniox.

中文使用说明：[`docs/zh-CN-quick-start.md`](docs/zh-CN-quick-start.md)

The app is designed for an in-person meeting setup: a laptop captures speech, the browser runs full screen, and an HDMI-connected TV shows live captions.

## Features

- English and Chinese realtime translation with OpenAI or Soniox provider switching
- OpenAI provider using `gpt-realtime-translate` over WebRTC
- Soniox provider using the official Web SDK, direct browser WebSocket, and server-issued temporary API keys
- `Focus View` for one large reverse-translation caption
- `Split View` for simultaneous English and Chinese captions
- Floating captions for presenting slides while keeping subtitles visible
- Manual audio input selection for microphones or system-provided audio devices
- Adjustable English and Chinese caption font sizes
- Local transcript autosave, recovery, and one-click `.txt` export
- User-provided OpenAI key from the browser, plus user-provided or server-fallback Soniox key
- Optional public-screen watermark through `NEXT_PUBLIC_WATERMARK_IMAGE`

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000> and allow microphone access.

If port 3000 is already in use:

```bash
npm run dev -- -p 3001
```

## API Provider Setup and Cost

This app has two built-in provider choices in the top control strip:

| Provider | Where to get an API key | Best fit | Estimated live caption cost |
| --- | --- | --- | --- |
| OpenAI | [API keys](https://platform.openai.com/api-keys), [billing](https://platform.openai.com/settings/organization/billing/overview), [pricing](https://openai.com/api/pricing/) | OpenAI Realtime Translation with WebRTC | about `$2.04/hour` (`gpt-realtime-translate` at `$0.034/min`) |
| Soniox | [Build with Soniox](https://console.soniox.com/), [pricing](https://soniox.com/pricing) | Long meetings and cost-sensitive bilingual captions | about `$0.12-$0.18/hour` for this app's realtime caption/translation use |

Recommended default for long English/Chinese conference captions: start with Soniox because it is much cheaper for long sessions. Keep OpenAI available as a second provider when you want to compare quality or use OpenAI's Realtime Translation path.

Pricing changes over time. Check the provider pricing pages before public or high-volume use.

## Environment Variables

Create `.env.local` for local development:

```bash
SONIOX_API_KEY=your-soniox-api-key
SAFETY_SALT=change-me
NEXT_PUBLIC_WATERMARK_IMAGE=/watermark.png
```

Users enter their own OpenAI API key in the app. `SONIOX_API_KEY` is an optional server-side fallback when the browser does not provide a Soniox key. This branch does not use an app access password.

`NEXT_PUBLIC_WATERMARK_IMAGE` is optional. Leave it empty for no watermark, or point it at a public URL or a local file in `public/`.

## Deploy to Vercel

Add these variables in Vercel Project Settings:

```bash
SONIOX_API_KEY=your-soniox-api-key
SAFETY_SALT=any-random-string
NEXT_PUBLIC_WATERMARK_IMAGE=https://example.com/watermark.png
```

Then deploy the project from GitHub or with the Vercel CLI. If you want every user to bring their own Soniox key too, leave `SONIOX_API_KEY` unset.

## How It Works

Select the provider in the top control strip before starting.

For OpenAI, the browser calls `/api/session` to create a short-lived Realtime Translation client secret. It then opens a WebRTC connection through `/api/call`, which proxies the SDP exchange to:

```txt
https://api.openai.com/v1/realtime/translations/calls
```

The microphone audio is sent as a WebRTC track. Translated captions and input transcripts arrive through the Realtime data channel.

For Soniox, the browser calls `/api/soniox/config` to create a temporary API key. The browser then connects directly to Soniox through the official Web SDK and WebSocket STT API. The long-lived Soniox key is never sent to the browser unless the user typed it into the app themselves.

Soniox currently only provides speech-to-text translated captions in this app. It does not play translated audio or use TTS.

## Local Transcript Storage

Transcript sessions are autosaved to IndexedDB in the current browser for the current site. Clicking `Stop` marks the session complete; if the page is closed or refreshed mid-session, the next page load moves the saved draft into the Save panel as `Recovered`.

The Save panel supports `Download`, `Delete`, and `Clear All`. Download creates a `.txt` file on demand with an English section followed by a Chinese section, and does not remove the saved record. Clearing browser site data, using private browsing, switching browsers, or changing domains can make local transcript records unavailable.

## Notes

- Use headphones during testing if translated audio playback is enabled, otherwise the microphone may capture playback audio.
- The floating caption window uses Document Picture-in-Picture when the browser supports it. Use Chrome or Edge for the best always-on-top behavior over PPT.
- The current UI is tuned for English/Chinese conference display.
- For public usage, monitor provider usage because this branch intentionally removes the app access password.
