# Simple Realtime Translator

A Vercel-ready Next.js app for English and Chinese live meeting translation using OpenAI Realtime Translation.

The app is designed for an in-person meeting setup: a laptop captures speech, the browser runs full screen, and an HDMI-connected TV shows live captions.

## Features

- English and Chinese realtime translation with `gpt-realtime-translate`
- `Focus View` for one large reverse-translation caption
- `Split View` for simultaneous English and Chinese captions
- Floating captions for presenting slides while keeping subtitles visible
- Manual audio input selection for microphones or system-provided audio devices
- Adjustable English and Chinese caption font sizes
- Local one-click transcript export
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
SAFETY_SALT=change-me
ACCESS_CODE=optional-shared-password
NEXT_PUBLIC_WATERMARK_IMAGE=/watermark.png
```

`OPENAI_API_KEY` is required. `ACCESS_CODE` is optional locally, but recommended for public deployments so random visitors cannot spend your OpenAI API quota.

`NEXT_PUBLIC_WATERMARK_IMAGE` is optional. Leave it empty for no watermark, or point it at a public URL or a local file in `public/`.

## Deploy to Vercel

Add these variables in Vercel Project Settings:

```bash
OPENAI_API_KEY=sk-your-openai-api-key
SAFETY_SALT=any-random-string
ACCESS_CODE=shared-password-for-users
NEXT_PUBLIC_WATERMARK_IMAGE=https://example.com/watermark.png
```

Then deploy the project from GitHub or with the Vercel CLI.

## How It Works

The browser calls `/api/session` to create a short-lived Realtime Translation client secret. It then opens a WebRTC connection through `/api/call`, which proxies the SDP exchange to:

```txt
https://api.openai.com/v1/realtime/translations/calls
```

The microphone audio is sent as a WebRTC track. Translated captions and input transcripts arrive through the Realtime data channel.

## Notes

- Use headphones during testing if translated audio playback is enabled, otherwise the microphone may capture playback audio.
- The floating caption window uses Document Picture-in-Picture when the browser supports it. Use Chrome or Edge for the best always-on-top behavior over PPT.
- The current UI is tuned for English/Chinese conference display.
- For public usage, keep `ACCESS_CODE` enabled and monitor OpenAI usage.
