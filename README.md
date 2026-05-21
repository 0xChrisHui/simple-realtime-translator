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
- Local one-click transcript export
- User-provided OpenAI or Soniox API key from the browser, with server environment fallbacks
- Optional public-screen watermark through `NEXT_PUBLIC_WATERMARK_IMAGE`
- Optional access code protection for Vercel deployments

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

## Environment Variables

Create `.env.local` for local development:

```bash
OPENAI_API_KEY=sk-your-openai-api-key
SONIOX_API_KEY=your-soniox-api-key
SAFETY_SALT=change-me
ACCESS_CODE=optional-shared-password
NEXT_PUBLIC_WATERMARK_IMAGE=/watermark.png
```

Users can enter their own OpenAI or Soniox API key in the app. `OPENAI_API_KEY` and `SONIOX_API_KEY` are optional server-side fallbacks when the browser does not provide a key. `ACCESS_CODE` is optional locally, but recommended for public deployments so random visitors cannot spend your API quota.

`NEXT_PUBLIC_WATERMARK_IMAGE` is optional. Leave it empty for no watermark, or point it at a public URL or a local file in `public/`.

## Deploy to Vercel

Add these variables in Vercel Project Settings:

```bash
OPENAI_API_KEY=sk-your-openai-api-key
SONIOX_API_KEY=your-soniox-api-key
SAFETY_SALT=any-random-string
ACCESS_CODE=shared-password-for-users
NEXT_PUBLIC_WATERMARK_IMAGE=https://example.com/watermark.png
```

Then deploy the project from GitHub or with the Vercel CLI. If you want every user to bring their own keys, leave `OPENAI_API_KEY` and `SONIOX_API_KEY` unset and keep `ACCESS_CODE` only if the deployment should remain private.

## How It Works

Select the provider in the top control strip before starting.

For OpenAI, the browser calls `/api/session` to create a short-lived Realtime Translation client secret. It then opens a WebRTC connection through `/api/call`, which proxies the SDP exchange to:

```txt
https://api.openai.com/v1/realtime/translations/calls
```

The microphone audio is sent as a WebRTC track. Translated captions and input transcripts arrive through the Realtime data channel.

For Soniox, the browser calls `/api/soniox/config` to create a temporary API key. The browser then connects directly to Soniox through the official Web SDK and WebSocket STT API. The long-lived Soniox key is never sent to the browser unless the user typed it into the app themselves.

Soniox currently only provides speech-to-text translated captions in this app. It does not play translated audio or use TTS.

## Notes

- Use headphones during testing if translated audio playback is enabled, otherwise the microphone may capture playback audio.
- The floating caption window uses Document Picture-in-Picture when the browser supports it. Use Chrome or Edge for the best always-on-top behavior over PPT.
- The current UI is tuned for English/Chinese conference display.
- For public usage, keep `ACCESS_CODE` enabled and monitor provider usage.
