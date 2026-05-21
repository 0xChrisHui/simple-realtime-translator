"use client";

import {
  MicrophoneSource,
  SonioxClient,
  type RealtimeResult as SonioxRealtimeResult,
  type RealtimeToken as SonioxRealtimeToken,
  type Recording as SonioxRecording,
  type SonioxConnectionConfig,
} from "@soniox/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type Status = "idle" | "connecting" | "live" | "stopping" | "error";
type ApiProvider = "openai" | "soniox";
type TargetLanguage = "en" | "zh";
type CaptionMap = Record<TargetLanguage, string>;
type DisplayMode = "dual" | "single";
type AudioInputDevice = {
  deviceId: string;
  label: string;
};
type CaptionFontSizeMap = Record<TargetLanguage, number>;
type CaptionFontSizeInputMap = Record<TargetLanguage, string>;
type CaptionFontStyle = CSSProperties & {
  "--caption-font-size-en": string;
  "--caption-font-size-zh": string;
  "--watermark-image": string;
};
type FloatingCaptionStyle = CSSProperties & {
  "--floating-font-size-en": string;
  "--floating-font-size-zh": string;
};
type DocumentPictureInPictureOptions = {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
};
type DocumentPictureInPictureController = {
  window?: Window | null;
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
};
type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController;
};

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  [key: string]: unknown;
};
type SourceLanguageSwitchCandidate = {
  language: TargetLanguage;
  firstSeenAt: number;
  lastSeenAt: number;
  chunks: number;
  evidence: number;
};
type SonioxCaptionBuffer = {
  finalDisplay: CaptionMap;
  partialDisplay: CaptionMap;
  finalOriginal: CaptionMap;
  partialOriginal: CaptionMap;
  finalTranslation: CaptionMap;
  partialTranslation: CaptionMap;
};

const API_PROVIDERS: Array<{ code: ApiProvider; label: string }> = [
  { code: "openai", label: "OpenAI" },
  { code: "soniox", label: "Soniox" },
];
const TARGETS: Array<{ code: TargetLanguage; label: string; placeholder: string }> = [
  { code: "en", label: "English", placeholder: "Waiting for English captions" },
  { code: "zh", label: "中文", placeholder: "等待中文字幕" },
];
const INPUT_TRANSCRIPT_TARGET: TargetLanguage = "zh";
const DEFAULT_CAPTION_FONT_SIZES: CaptionFontSizeMap = { en: 60, zh: 70 };
const MIN_CAPTION_FONT_SIZE = 24;
const MAX_CAPTION_FONT_SIZE = 180;
const SOURCE_LANGUAGE_SWITCH_DELAY_MS = 2500;
const SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS = 1400;
const SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS = 2;
const SOURCE_LANGUAGE_SWITCH_MIN_EVIDENCE: Record<TargetLanguage, number> = { en: 12, zh: 3 };
const WATERMARK_IMAGE = formatWatermarkImage(process.env.NEXT_PUBLIC_WATERMARK_IMAGE ?? "");
const OPENAI_API_KEY_STORAGE_KEY = "translatorOpenAiApiKey";
const SONIOX_API_KEY_STORAGE_KEY = "translatorSonioxApiKey";
const FLOATING_WINDOW_WIDTH = 720;
const FLOATING_WINDOW_HEIGHT = 360;
const FLOATING_CAPTION_MAX_CHARS = 420;
const FLOATING_WINDOW_CSS = `
  :root {
    color-scheme: dark;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    background: #050505;
    color: #ffffff;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  button {
    font: inherit;
  }

  #floating-caption-root {
    height: 100%;
  }

  .floating-caption-shell {
    background: #050505;
    display: grid;
    grid-template-rows: 36px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .floating-caption-topbar {
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.68);
    display: flex;
    font-size: 12px;
    font-weight: 800;
    gap: 10px;
    justify-content: space-between;
    min-width: 0;
    padding: 0 9px 0 12px;
    text-transform: uppercase;
  }

  .floating-caption-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .floating-close-button {
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    font-weight: 850;
    height: 24px;
    justify-content: center;
    padding: 0 8px;
  }

  .floating-close-button:hover,
  .floating-close-button:focus-visible {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    outline: none;
  }

  .floating-caption-content {
    min-height: 0;
    overflow: hidden;
  }

  .floating-dual-grid {
    display: grid;
    gap: 1px;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    height: 100%;
  }

  .floating-caption-card {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
    padding: 14px 18px 16px;
  }

  .floating-caption-card-focus {
    height: 100%;
    padding: 18px 22px 22px;
  }

  .floating-caption-card-en {
    background: #080808;
    color: #f7fbff;
  }

  .floating-caption-card-zh {
    background: #101010;
    color: #e8f2ff;
  }

  .floating-language-label {
    color: rgba(255, 255, 255, 0.42);
    font-size: 12px;
    font-weight: 850;
    line-height: 1;
    margin-bottom: 10px;
    text-transform: uppercase;
  }

  .floating-caption-card p {
    align-self: end;
    font-weight: 850;
    letter-spacing: 0;
    line-height: 1.08;
    margin: 0;
    max-height: 100%;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .floating-caption-card-en p {
    font-size: clamp(28px, 10vw, var(--floating-font-size-en));
  }

  .floating-caption-card-zh p {
    font-size: clamp(30px, 11vw, var(--floating-font-size-zh));
    line-height: 1.18;
  }

  .floating-caption-card-focus p {
    font-size: clamp(34px, 12vw, var(--floating-font-size-zh));
  }

  .floating-caption-card-focus.floating-caption-card-en p {
    font-size: clamp(34px, 12vw, var(--floating-font-size-en));
  }
`;

function formatWatermarkImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "none";

  return `url("${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

function prepareFloatingWindow(targetWindow: Window) {
  const targetDocument = targetWindow.document;
  targetDocument.documentElement.lang = "en";
  targetDocument.title = "Floating Captions";
  targetDocument.head.innerHTML = "";
  targetDocument.body.innerHTML = "";

  const viewport = targetDocument.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  targetDocument.head.append(viewport);

  const styles = targetDocument.createElement("style");
  styles.textContent = FLOATING_WINDOW_CSS;
  targetDocument.head.append(styles);

  const root = targetDocument.createElement("div");
  root.id = "floating-caption-root";
  targetDocument.body.append(root);

  return root;
}

function getFloatingCaptionText(value: string, fallback: string) {
  const caption = value.trim() || fallback;
  if (caption.length <= FLOATING_CAPTION_MAX_CHARS) return caption;

  return caption.slice(-FLOATING_CAPTION_MAX_CHARS).trimStart();
}

function appendCaptionDelta(previous: string, delta: string, maxChars: number) {
  const next = `${previous}${delta}`.replace(/[ \t\r\n]+/g, " ");
  if (next.length <= maxChars) return next;

  const clipped = next.slice(-maxChars);
  const sentenceStart = clipped.search(/[。！？.!?]\s?/);
  if (sentenceStart > 0 && sentenceStart < Math.floor(maxChars / 3)) {
    return clipped.slice(sentenceStart + 1).trimStart();
  }

  return clipped.trimStart();
}

function appendSavedCaptionDelta(previous: string, delta: string) {
  return `${previous}${delta}`.replace(/[ \t\r\n]+/g, " ").trimStart();
}

function createEmptyCaptionMap(): CaptionMap {
  return { en: "", zh: "" };
}

function createEmptySonioxCaptionBuffer(): SonioxCaptionBuffer {
  return {
    finalDisplay: createEmptyCaptionMap(),
    partialDisplay: createEmptyCaptionMap(),
    finalOriginal: createEmptyCaptionMap(),
    partialOriginal: createEmptyCaptionMap(),
    finalTranslation: createEmptyCaptionMap(),
    partialTranslation: createEmptyCaptionMap(),
  };
}

function normalizeSonioxLanguage(language: string | undefined): TargetLanguage | null {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-") || normalized === "cmn" || normalized === "yue") return "zh";
  return null;
}

function appendSonioxCaptionText(previous: string, text: string) {
  return appendCaptionDelta(previous, text, 1600);
}

function combineSonioxCaption(finalText: string, partialText: string) {
  return appendCaptionDelta(finalText, partialText, 1600);
}

function getSonioxCaptionMaps(buffer: SonioxCaptionBuffer) {
  const captions: CaptionMap = {
    en: combineSonioxCaption(buffer.finalDisplay.en, buffer.partialDisplay.en),
    zh: combineSonioxCaption(buffer.finalDisplay.zh, buffer.partialDisplay.zh),
  };
  const translationCaptions: CaptionMap = {
    en: combineSonioxCaption(buffer.finalTranslation.en, buffer.partialTranslation.en),
    zh: combineSonioxCaption(buffer.finalTranslation.zh, buffer.partialTranslation.zh),
  };

  return { captions, translationCaptions };
}

function getSonioxFinalTokenKey(
  token: SonioxRealtimeToken,
  status: "original" | "translation",
  language: TargetLanguage,
  result: SonioxRealtimeResult,
  tokenIndex: number
) {
  return [
    status,
    language,
    token.source_language ?? "",
    token.start_ms ?? `final:${result.final_audio_proc_ms}`,
    token.end_ms ?? `index:${tokenIndex}`,
    token.text,
  ].join(":");
}

function detectInputLanguage(delta: string, fallback: TargetLanguage): TargetLanguage {
  if (/[\u3400-\u9fff]/.test(delta)) return "zh";
  if (/[A-Za-z]/.test(delta)) return "en";
  return fallback;
}

function getInputLanguageEvidence(delta: string, language: TargetLanguage) {
  if (language === "zh") {
    return delta.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  }

  return delta.match(/[A-Za-z]/g)?.length ?? 0;
}

function formatTimestampForFile(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}

function formatTimestampForText(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function clampCaptionFontSize(value: number) {
  return Math.min(MAX_CAPTION_FONT_SIZE, Math.max(MIN_CAPTION_FONT_SIZE, value));
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;

  const error = (data as Record<string, unknown>).error;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }

  return fallback;
}

function getClientSecret(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;

  const clientSecret = record.client_secret;
  if (clientSecret && typeof clientSecret === "object") {
    const value = (clientSecret as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }

  const secret = record.secret;
  if (secret && typeof secret === "object") {
    const value = (secret as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }

  return null;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [captions, setCaptions] = useState<CaptionMap>({ en: "", zh: "" });
  const [translationCaptions, setTranslationCaptions] = useState<CaptionMap>({ en: "", zh: "" });
  const [sourceLanguage, setSourceLanguage] = useState<TargetLanguage>("en");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("dual");
  const [error, setError] = useState("");
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState("");
  const [captionFontSizes, setCaptionFontSizes] = useState<CaptionFontSizeMap>(DEFAULT_CAPTION_FONT_SIZES);
  const [captionFontSizeInputs, setCaptionFontSizeInputs] = useState<CaptionFontSizeInputMap>({
    en: String(DEFAULT_CAPTION_FONT_SIZES.en),
    zh: String(DEFAULT_CAPTION_FONT_SIZES.zh),
  });
  const [apiProvider, setApiProvider] = useState<ApiProvider>("soniox");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [sonioxApiKey, setSonioxApiKey] = useState("");
  const [controlsAwake, setControlsAwake] = useState(false);
  const [floatingContainer, setFloatingContainer] = useState<HTMLElement | null>(null);
  const [floatingWindowOpen, setFloatingWindowOpen] = useState(false);

  const statusRef = useRef<Status>("idle");
  const apiProviderRef = useRef<ApiProvider>("soniox");
  const openaiApiKeyRef = useRef("");
  const sonioxApiKeyRef = useRef("");
  const selectedAudioInputIdRef = useRef("");
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Partial<Record<TargetLanguage, RTCPeerConnection>>>({});
  const dataChannelsRef = useRef<Partial<Record<TargetLanguage, RTCDataChannel>>>({});
  const connectedTargetsRef = useRef<Set<TargetLanguage>>(new Set());
  const sonioxRecordingRef = useRef<SonioxRecording | null>(null);
  const sonioxCaptionBufferRef = useRef<SonioxCaptionBuffer>(createEmptySonioxCaptionBuffer());
  const sonioxFinalTokenKeysRef = useRef<Set<string>>(new Set());
  const captionScrollerRefs = useRef<Partial<Record<TargetLanguage, HTMLDivElement>>>({});
  const floatingWindowRef = useRef<Window | null>(null);
  const sourceLanguageRef = useRef<TargetLanguage>("en");
  const sourceLanguageConfirmedRef = useRef(false);
  const sourceLanguageSwitchCandidateRef = useRef<SourceLanguageSwitchCandidate | null>(null);
  const lastInputLanguageRef = useRef<TargetLanguage>("en");
  const savedCaptionsRef = useRef<CaptionMap>({ en: "", zh: "" });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      TARGETS.forEach(({ code }) => {
        const scroller = captionScrollerRefs.current[code];
        if (!scroller) return;
        scroller.scrollTop = scroller.scrollHeight;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [captions, displayMode, translationCaptions]);

  const setRealtimeStatus = useCallback((nextStatus: Status) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    try {
      const storedApiKey = window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY) ?? "";
      openaiApiKeyRef.current = storedApiKey;
      setOpenaiApiKey(storedApiKey);
    } catch {
      openaiApiKeyRef.current = "";
    }
  }, []);

  useEffect(() => {
    try {
      const storedApiKey = window.localStorage.getItem(SONIOX_API_KEY_STORAGE_KEY) ?? "";
      sonioxApiKeyRef.current = storedApiKey;
      setSonioxApiKey(storedApiKey);
    } catch {
      sonioxApiKeyRef.current = "";
    }
  }, []);

  const getAccessCodeHeaders = useCallback((): Record<string, string> => {
    return {};
  }, []);

  const handleApiProviderChange = useCallback((value: string) => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;

    const nextProvider: ApiProvider = value === "soniox" ? "soniox" : "openai";
    apiProviderRef.current = nextProvider;
    setApiProvider(nextProvider);
    setDisplayMode(nextProvider === "openai" ? "single" : "dual");
    setError("");
  }, []);

  const handleOpenAiApiKeyChange = useCallback((value: string) => {
    const nextApiKey = value.trim();
    openaiApiKeyRef.current = nextApiKey;
    setOpenaiApiKey(nextApiKey);

    try {
      if (nextApiKey) {
        window.localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, nextApiKey);
      } else {
        window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
      }
    } catch {
      // The key still works for this tab even when local storage is unavailable.
    }
  }, []);

  const handleSonioxApiKeyChange = useCallback((value: string) => {
    const nextApiKey = value.trim();
    sonioxApiKeyRef.current = nextApiKey;
    setSonioxApiKey(nextApiKey);

    try {
      if (nextApiKey) {
        window.localStorage.setItem(SONIOX_API_KEY_STORAGE_KEY, nextApiKey);
      } else {
        window.localStorage.removeItem(SONIOX_API_KEY_STORAGE_KEY);
      }
    } catch {
      // The key still works for this tab even when local storage is unavailable.
    }
  }, []);

  const commitSourceLanguage = useCallback((language: TargetLanguage) => {
    sourceLanguageRef.current = language;
    sourceLanguageConfirmedRef.current = true;
    sourceLanguageSwitchCandidateRef.current = null;
    setSourceLanguage(language);
  }, []);

  const trackSourceLanguage = useCallback(
    (inputLanguage: TargetLanguage, delta: string) => {
      const evidence = getInputLanguageEvidence(delta, inputLanguage);
      if (evidence <= 0) return;

      const committedLanguage = sourceLanguageRef.current;
      if (!sourceLanguageConfirmedRef.current) {
        commitSourceLanguage(inputLanguage);
        return;
      }

      if (inputLanguage === committedLanguage) {
        sourceLanguageSwitchCandidateRef.current = null;
        return;
      }

      const now = Date.now();
      const pending = sourceLanguageSwitchCandidateRef.current;
      const shouldStartCandidate =
        !pending ||
        pending.language !== inputLanguage ||
        now - pending.lastSeenAt > SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS;

      const candidate: SourceLanguageSwitchCandidate = shouldStartCandidate
        ? {
            language: inputLanguage,
            firstSeenAt: now,
            lastSeenAt: now,
            chunks: 1,
            evidence,
          }
        : {
            ...pending,
            lastSeenAt: now,
            chunks: pending.chunks + 1,
            evidence: pending.evidence + evidence,
          };

      sourceLanguageSwitchCandidateRef.current = candidate;

      const hasStayedLongEnough = now - candidate.firstSeenAt >= SOURCE_LANGUAGE_SWITCH_DELAY_MS;
      const hasEnoughEvidence =
        candidate.chunks >= SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS &&
        candidate.evidence >= SOURCE_LANGUAGE_SWITCH_MIN_EVIDENCE[candidate.language];

      if (hasStayedLongEnough && hasEnoughEvidence) {
        commitSourceLanguage(candidate.language);
      }
    },
    [commitSourceLanguage]
  );

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("This browser cannot list audio input devices.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput" && device.deviceId)
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setAudioInputs(inputs);

      const selectedId = selectedAudioInputIdRef.current;
      if (selectedId && !inputs.some((device) => device.deviceId === selectedId)) {
        selectedAudioInputIdRef.current = "";
        setSelectedAudioInputId("");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not refresh audio sources.");
    }
  }, []);

  useEffect(() => {
    void refreshAudioInputs();

    if (!navigator.mediaDevices?.addEventListener) return;

    navigator.mediaDevices.addEventListener("devicechange", refreshAudioInputs);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshAudioInputs);
  }, [refreshAudioInputs]);

  const cancelSonioxRecording = useCallback(() => {
    const recording = sonioxRecordingRef.current;
    sonioxRecordingRef.current = null;
    recording?.cancel();
  }, []);

  const cleanupRealtime = useCallback(() => {
    cancelSonioxRecording();

    Object.values(dataChannelsRef.current).forEach((channel) => channel?.close());
    dataChannelsRef.current = {};

    Object.values(peerConnectionsRef.current).forEach((peerConnection) => {
      peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
      peerConnection?.getReceivers().forEach((receiver) => receiver.track?.stop());
      peerConnection?.close();
    });
    peerConnectionsRef.current = {};
    connectedTargetsRef.current.clear();

    const sourceStream = sourceStreamRef.current;
    sourceStreamRef.current = null;
    sourceStream?.getTracks().forEach((track) => track.stop());
  }, [cancelSonioxRecording]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "idle") setRealtimeStatus("stopping");
    const recording = sonioxRecordingRef.current;

    if (recording) {
      try {
        await recording.stop();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not stop Soniox recording cleanly.");
      }

      if (sonioxRecordingRef.current === recording) {
        sonioxRecordingRef.current = null;
      }
    }

    cleanupRealtime();
    setRealtimeStatus("idle");
  }, [cleanupRealtime, setRealtimeStatus]);

  const createClientSecret = useCallback(async (targetLanguage: TargetLanguage) => {
    const createSessionRequest = () =>
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAccessCodeHeaders() },
        body: JSON.stringify({ targetLanguage, openaiApiKey: openaiApiKeyRef.current || undefined }),
      });

    let sessionResponse = await createSessionRequest();
    let sessionText = await sessionResponse.text();
    let sessionData: unknown = {};
    try {
      sessionData = sessionText ? JSON.parse(sessionText) : {};
    } catch {
      sessionData = {};
    }

    if (!sessionResponse.ok) {
      throw new Error(getErrorMessage(sessionData, sessionText || `Failed to create ${targetLanguage} session.`));
    }

    const clientSecret = getClientSecret(sessionData);
    if (!clientSecret) {
      throw new Error(`The ${targetLanguage} session response did not include a client secret.`);
    }

    return clientSecret;
  }, [getAccessCodeHeaders]);

  const connectTranslation = useCallback(
    async (targetLanguage: TargetLanguage, sourceStream: MediaStream) => {
      const clientSecret = await createClientSecret(targetLanguage);
      const pc = new RTCPeerConnection();
      peerConnectionsRef.current[targetLanguage] = pc;

      pc.onconnectionstatechange = () => {
        if (peerConnectionsRef.current[targetLanguage] !== pc) return;

        if (pc.connectionState === "connected") {
          connectedTargetsRef.current.add(targetLanguage);
          if (connectedTargetsRef.current.size === TARGETS.length) setRealtimeStatus("live");
          return;
        }

        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          if (statusRef.current === "stopping" || statusRef.current === "idle") return;
          setError(`${targetLanguage.toUpperCase()} translation connection ended. Click Start to reconnect.`);
          cleanupRealtime();
          setRealtimeStatus("error");
        }
      };

      const [audioTrack] = sourceStream.getAudioTracks();
      pc.addTrack(audioTrack, sourceStream);

      const events = pc.createDataChannel(`oai-events-${targetLanguage}`);
      dataChannelsRef.current[targetLanguage] = events;

      events.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data) as RealtimeEvent;

          if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
            savedCaptionsRef.current[targetLanguage] = appendSavedCaptionDelta(
              savedCaptionsRef.current[targetLanguage],
              event.delta
            );
            setTranslationCaptions((previous) => ({
              ...previous,
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage], event.delta as string, 1600),
            }));
            setCaptions((previous) => ({
              ...previous,
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage], event.delta as string, 1600),
            }));
          }

          if (
            targetLanguage === INPUT_TRANSCRIPT_TARGET &&
            event.type === "session.input_transcript.delta" &&
            typeof event.delta === "string"
          ) {
            const inputLanguage = detectInputLanguage(event.delta, lastInputLanguageRef.current);
            lastInputLanguageRef.current = inputLanguage;
            trackSourceLanguage(inputLanguage, event.delta);
            savedCaptionsRef.current[inputLanguage] = appendSavedCaptionDelta(savedCaptionsRef.current[inputLanguage], event.delta);
            setCaptions((previous) => ({
              ...previous,
              [inputLanguage]: appendCaptionDelta(previous[inputLanguage], event.delta as string, 1600),
            }));
          }

          if (event.type === "error") {
            setError(event.error?.message ?? `${targetLanguage.toUpperCase()} Realtime API error.`);
          }
        } catch {
          // Ignore non-JSON data channel messages.
        }
      };

      const offer = await pc.createOffer();
      if (!offer.sdp) {
        throw new Error("The browser did not create a valid WebRTC offer.");
      }

      await pc.setLocalDescription(offer);

      const createCallRequest = () =>
        fetch("/api/call", {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            "x-client-secret": clientSecret,
            ...getAccessCodeHeaders(),
          },
          body: offer.sdp,
        });

      let sdpResponse = await createCallRequest();
      let sdpText = await sdpResponse.text();
      let sdpErrorData: unknown = {};
      if (!sdpResponse.ok) {
        try {
          sdpErrorData = sdpText ? JSON.parse(sdpText) : {};
        } catch {
          sdpErrorData = {};
        }
      }

      if (!sdpResponse.ok) {
        throw new Error(getErrorMessage(sdpErrorData, sdpText || "Failed to connect OpenAI Realtime call."));
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: sdpText,
      });
    },
    [cleanupRealtime, createClientSecret, getAccessCodeHeaders, setRealtimeStatus, trackSourceLanguage]
  );

  const resetCaptionState = useCallback(() => {
    setCaptions({ en: "", zh: "" });
    setTranslationCaptions({ en: "", zh: "" });
    setSourceLanguage("en");
    sourceLanguageRef.current = "en";
    sourceLanguageConfirmedRef.current = false;
    sourceLanguageSwitchCandidateRef.current = null;
    lastInputLanguageRef.current = "en";
    savedCaptionsRef.current = { en: "", zh: "" };
    sonioxCaptionBufferRef.current = createEmptySonioxCaptionBuffer();
    sonioxFinalTokenKeysRef.current = new Set();
  }, []);

  const startOpenAiTranslation = useCallback(
    async (audioInputId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (audioInputId) {
        audioConstraints.deviceId = { exact: audioInputId };
      }

      const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      sourceStreamRef.current = sourceStream;
      void refreshAudioInputs();

      await Promise.all(TARGETS.map((target) => connectTranslation(target.code, sourceStream)));
      setRealtimeStatus("live");
    },
    [connectTranslation, refreshAudioInputs, setRealtimeStatus]
  );

  const createSonioxConnectionConfig = useCallback(async (): Promise<SonioxConnectionConfig> => {
    const createConfigRequest = () =>
      fetch("/api/soniox/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAccessCodeHeaders() },
        body: JSON.stringify({ sonioxApiKey: sonioxApiKeyRef.current || undefined }),
      });

    let response = await createConfigRequest();
    let text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(getErrorMessage(data, text || "Failed to create Soniox temporary key."));
    }

    if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).api_key !== "string") {
      throw new Error("The Soniox temporary key response did not include api_key.");
    }

    return { api_key: (data as Record<string, string>).api_key };
  }, [getAccessCodeHeaders]);

  const updateSonioxCaptionState = useCallback(() => {
    const next = getSonioxCaptionMaps(sonioxCaptionBufferRef.current);
    setCaptions(next.captions);
    setTranslationCaptions(next.translationCaptions);
  }, []);

  const handleSonioxResult = useCallback(
    (result: SonioxRealtimeResult) => {
      const buffer = sonioxCaptionBufferRef.current;
      buffer.partialDisplay = createEmptyCaptionMap();
      buffer.partialOriginal = createEmptyCaptionMap();
      buffer.partialTranslation = createEmptyCaptionMap();

      result.tokens.forEach((token: SonioxRealtimeToken, tokenIndex) => {
        if (!token.text) return;

        const translationStatus =
          token.translation_status === "translation" ? "translation" : token.translation_status === "none" ? "original" : "original";
        const language = normalizeSonioxLanguage(token.language);
        const sourceLanguageFromToken = normalizeSonioxLanguage(token.source_language);
        if (!language) return;

        if (translationStatus === "original") {
          commitSourceLanguage(language);
        } else if (sourceLanguageFromToken) {
          commitSourceLanguage(sourceLanguageFromToken);
        }

        const finalTokenKey = token.is_final
          ? getSonioxFinalTokenKey(token, translationStatus, language, result, tokenIndex)
          : null;
        if (finalTokenKey && sonioxFinalTokenKeysRef.current.has(finalTokenKey)) return;

        const targetBuffer =
          translationStatus === "translation"
            ? token.is_final
              ? buffer.finalTranslation
              : buffer.partialTranslation
            : token.is_final
              ? buffer.finalOriginal
              : buffer.partialOriginal;
        const displayBuffer = token.is_final ? buffer.finalDisplay : buffer.partialDisplay;

        targetBuffer[language] = appendSonioxCaptionText(targetBuffer[language], token.text);
        displayBuffer[language] = appendSonioxCaptionText(displayBuffer[language], token.text);

        if (token.is_final) {
          if (finalTokenKey) sonioxFinalTokenKeysRef.current.add(finalTokenKey);
          savedCaptionsRef.current[language] = appendSavedCaptionDelta(savedCaptionsRef.current[language], token.text);
        }
      });

      updateSonioxCaptionState();
    },
    [commitSourceLanguage, updateSonioxCaptionState]
  );

  const startSonioxTranslation = useCallback(
    async (audioInputId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support microphone recording.");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (audioInputId) {
        audioConstraints.deviceId = { exact: audioInputId };
      }

      const client = new SonioxClient({
        config: createSonioxConnectionConfig,
      });
      const source = new MicrophoneSource({ constraints: audioConstraints });
      const recording = client.realtime.record({
        model: "stt-rt-v4",
        language_hints: ["en", "zh"],
        enable_language_identification: true,
        enable_endpoint_detection: true,
        translation: {
          type: "two_way",
          language_a: "en",
          language_b: "zh",
        },
        auto_reconnect: true,
        source,
      });

      sonioxRecordingRef.current = recording;

      recording.on("connected", () => {
        if (sonioxRecordingRef.current !== recording) return;
        setRealtimeStatus("live");
      });
      recording.on("result", handleSonioxResult);
      recording.on("finalized", () => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxCaptionBufferRef.current.partialDisplay = createEmptyCaptionMap();
        sonioxCaptionBufferRef.current.partialOriginal = createEmptyCaptionMap();
        sonioxCaptionBufferRef.current.partialTranslation = createEmptyCaptionMap();
        updateSonioxCaptionState();
      });
      recording.on("finished", () => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxRecordingRef.current = null;
        if (statusRef.current !== "stopping") setRealtimeStatus("idle");
      });
      recording.on("error", (caughtError) => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxRecordingRef.current = null;
        if (statusRef.current === "idle" || statusRef.current === "stopping") return;
        setError(caughtError instanceof Error ? caughtError.message : "Soniox realtime API error.");
        setRealtimeStatus("error");
      });
      recording.on("state_change", ({ new_state }) => {
        if (sonioxRecordingRef.current !== recording) return;
        if (new_state === "recording") setRealtimeStatus("live");
        if (new_state === "reconnecting" || new_state === "connecting") setRealtimeStatus("connecting");
      });

      void refreshAudioInputs();
    },
    [
      createSonioxConnectionConfig,
      handleSonioxResult,
      refreshAudioInputs,
      setRealtimeStatus,
      updateSonioxCaptionState,
    ]
  );

  const start = useCallback(async (audioInputId = selectedAudioInputIdRef.current) => {
    setError("");
    if (apiProviderRef.current === "openai" && !openaiApiKeyRef.current) {
      resetCaptionState();
      setRealtimeStatus("idle");
      setError("请输入你的 API");
      return;
    }

    setRealtimeStatus("connecting");
    cleanupRealtime();
    resetCaptionState();

    try {
      if (apiProviderRef.current === "openai") {
        await startOpenAiTranslation(audioInputId);
      } else {
        await startSonioxTranslation(audioInputId);
      }
    } catch (caughtError) {
      cleanupRealtime();
      setRealtimeStatus("error");
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error.");
    }
  }, [cleanupRealtime, resetCaptionState, setRealtimeStatus, startOpenAiTranslation, startSonioxTranslation]);

  const handleAudioInputChange = useCallback(
    async (deviceId: string) => {
      selectedAudioInputIdRef.current = deviceId;
      setSelectedAudioInputId(deviceId);

      if (statusRef.current !== "live") return;

      await stop();
      await start(deviceId);
    },
    [start, stop]
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setError("Fullscreen is not available in this browser.");
    }
  }, []);

  const closeFloatingWindow = useCallback(() => {
    const targetWindow = floatingWindowRef.current;
    floatingWindowRef.current = null;
    setFloatingContainer(null);
    setFloatingWindowOpen(false);

    if (targetWindow && !targetWindow.closed) {
      targetWindow.close();
    }
  }, []);

  const toggleFloatingWindow = useCallback(async () => {
    const currentWindow = floatingWindowRef.current;
    if (currentWindow && !currentWindow.closed) {
      closeFloatingWindow();
      return;
    }

    try {
      const pictureInPictureController = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
      let useDocumentPictureInPicture = false;
      let targetWindow: Window | null = null;

      if (pictureInPictureController?.requestWindow) {
        useDocumentPictureInPicture = true;
        targetWindow = await pictureInPictureController.requestWindow({
          width: FLOATING_WINDOW_WIDTH,
          height: FLOATING_WINDOW_HEIGHT,
          preferInitialWindowPlacement: true,
        });
      } else {
        targetWindow = window.open(
          "",
          "realtime-translator-floating",
          `popup,width=${FLOATING_WINDOW_WIDTH},height=${FLOATING_WINDOW_HEIGHT},resizable=yes,scrollbars=no`
        );
      }

      if (!targetWindow) {
        throw new Error("Could not open floating captions. Allow pop-ups for this site.");
      }

      const handleClosed = () => {
        if (floatingWindowRef.current !== targetWindow) return;
        floatingWindowRef.current = null;
        setFloatingContainer(null);
        setFloatingWindowOpen(false);
      };

      const root = prepareFloatingWindow(targetWindow);
      targetWindow.addEventListener("pagehide", handleClosed, { once: true });
      targetWindow.addEventListener("beforeunload", handleClosed, { once: true });
      floatingWindowRef.current = targetWindow;
      setFloatingContainer(root);
      setFloatingWindowOpen(true);

      if (!useDocumentPictureInPicture) {
        setError("Floating captions opened in a normal pop-up. Use Chrome or Edge for an always-on-top window over PPT.");
      } else {
        setError("");
      }

      targetWindow.focus();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not open floating captions.");
    }
  }, [closeFloatingWindow]);

  useEffect(() => closeFloatingWindow, [closeFloatingWindow]);

  const handleCaptionFontSizeChange = useCallback((language: TargetLanguage, value: string) => {
    setCaptionFontSizeInputs((previous) => ({ ...previous, [language]: value }));

    const nextSize = Number(value);
    if (Number.isFinite(nextSize)) {
      setCaptionFontSizes((previous) => ({ ...previous, [language]: clampCaptionFontSize(nextSize) }));
    }
  }, []);

  const commitCaptionFontSize = useCallback(
    (language: TargetLanguage) => {
      setCaptionFontSizeInputs((previous) => ({ ...previous, [language]: String(captionFontSizes[language]) }));
    },
    [captionFontSizes]
  );

  const saveCaptions = useCallback(() => {
    const allowCaptionFallback = apiProviderRef.current === "openai";
    const savedEnglish = savedCaptionsRef.current.en.trim() || (allowCaptionFallback ? captions.en.trim() : "");
    const savedChinese = savedCaptionsRef.current.zh.trim() || (allowCaptionFallback ? captions.zh.trim() : "");

    if (!savedEnglish && !savedChinese) {
      setError("No transcript to save yet.");
      return;
    }

    const now = new Date();
    const content = [
      "Simple Realtime Translator",
      `Saved at: ${formatTimestampForText(now)}`,
      "",
      "English",
      savedEnglish || "(empty)",
      "",
      "中文",
      savedChinese || "(empty)",
      "",
    ].join("\n");

    const blob = new Blob([`\uFEFF${content}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `translation-${formatTimestampForFile(now)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [captions.en, captions.zh]);

  const isRunning = status === "connecting" || status === "live" || status === "stopping";
  const apiKeyLabel = apiProvider === "openai" ? "OpenAI API key" : "Soniox API key";
  const apiKeyPlaceholder = apiProvider === "openai" ? "OpenAI key" : "Soniox key";
  const apiKeyValue = apiProvider === "openai" ? openaiApiKey : sonioxApiKey;
  const singleTargetLanguage: TargetLanguage = sourceLanguage === "zh" ? "en" : "zh";
  const singleTarget = TARGETS.find((target) => target.code === singleTargetLanguage) ?? TARGETS[0];
  const missingOpenAiApiKey = apiProvider === "openai" && !openaiApiKey.trim();
  const waitingTranslationText = missingOpenAiApiKey ? "请输入你的 API" : "等待翻译 Waiting translate";
  const singleCaption = translationCaptions[singleTargetLanguage] || waitingTranslationText;
  const captionStyle: CaptionFontStyle = {
    "--caption-font-size-en": `${captionFontSizes.en}px`,
    "--caption-font-size-zh": `${captionFontSizes.zh}px`,
    "--watermark-image": WATERMARK_IMAGE,
  };

  return (
    <>
      <main className="meeting-shell" style={captionStyle}>
        <header
          className="control-strip"
          aria-label="Translation controls"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setControlsAwake(false);
          }}
          onFocus={() => setControlsAwake(true)}
          onMouseEnter={() => setControlsAwake(true)}
          onMouseLeave={() => setControlsAwake(false)}
        >
        <div className="status-chip">
          <span className={`status-dot ${status}`} />
          <span>
            {status === "idle" && "Ready"}
            {status === "connecting" && "Connecting"}
            {status === "live" && "Live"}
            {status === "stopping" && "Stopping"}
            {status === "error" && "Error"}
          </span>
        </div>

        <div className="switch-control" title="API provider">
          <span className="switch-label">Provider</span>
          <div aria-label="API provider" className="segmented-switch" role="group">
            {API_PROVIDERS.map((provider) => (
              <button
                aria-pressed={apiProvider === provider.code}
                className={`switch-option ${apiProvider === provider.code ? "switch-option-active" : ""}`}
                disabled={isRunning}
                key={provider.code}
                onClick={() => handleApiProviderChange(provider.code)}
                type="button"
              >
                {provider.label}
              </button>
            ))}
          </div>
        </div>

        <label className="api-key-control" title={apiKeyLabel}>
          <span>API</span>
          <input
            aria-label={apiKeyLabel}
            autoCapitalize="none"
            autoComplete="off"
            className="api-key-input"
            disabled={isRunning}
            onChange={(event) =>
              apiProvider === "openai"
                ? handleOpenAiApiKeyChange(event.currentTarget.value)
                : handleSonioxApiKeyChange(event.currentTarget.value)
            }
            placeholder={apiKeyPlaceholder}
            spellCheck={false}
            type="password"
            value={apiKeyValue}
          />
        </label>

        <label className="device-control" title="Audio input source">
          <span>Input</span>
          <select
            className="device-select"
            disabled={status === "connecting" || status === "stopping"}
            onChange={(event) => void handleAudioInputChange(event.currentTarget.value)}
            value={selectedAudioInputId}
          >
            <option value="">Default microphone</option>
            {audioInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>

        <button className="tiny-button" onClick={() => void refreshAudioInputs()} title="Refresh audio inputs" type="button">
          Scan
        </button>

        <button className="tiny-button" onClick={saveCaptions} title="Save captions as a local text file" type="button">
          Save
        </button>

        <div className="segmented-switch view-switch" role="group" aria-label="Caption view">
          <button
            aria-pressed={displayMode === "dual"}
            className={`switch-option ${displayMode === "dual" ? "switch-option-active" : ""}`}
            onClick={() => setDisplayMode("dual")}
            title="Show English and Chinese captions together"
            type="button"
          >
            Split View
          </button>
          <button
            aria-pressed={displayMode === "single"}
            className={`switch-option ${displayMode === "single" ? "switch-option-active" : ""}`}
            onClick={() => setDisplayMode("single")}
            title="Show one focused translation based on the spoken language"
            type="button"
          >
            Focus View
          </button>
        </div>

        <button
          aria-pressed={floatingWindowOpen}
          className={`tiny-button ${floatingWindowOpen ? "mode-active" : ""}`}
          onClick={() => void toggleFloatingWindow()}
          title="Open floating captions for PPT presentation"
          type="button"
        >
          Float
        </button>

        <button className="tiny-button" onClick={toggleFullscreen} title="Toggle fullscreen" type="button">
          FS
        </button>

        <button
          className={isRunning ? "tiny-button danger" : "tiny-button primary"}
          onClick={isRunning ? () => void stop() : () => void start()}
          type="button"
        >
          {isRunning ? "Stop" : "Start"}
        </button>
      </header>

      <section className={displayMode === "dual" ? "dual-caption-stage" : "single-caption-stage"} aria-live="polite">
        {displayMode === "dual" ? (
          TARGETS.map((target) => (
            <article className={`caption-panel caption-panel-${target.code}`} key={target.code}>
              <div className="caption-header">
                <span>{target.label}</span>
              </div>
              <div
                className="caption-scroll"
                ref={(element) => {
                  if (element) {
                    captionScrollerRefs.current[target.code] = element;
                  } else {
                    delete captionScrollerRefs.current[target.code];
                  }
                }}
              >
                <p>{captions[target.code] || target.placeholder}</p>
              </div>
            </article>
          ))
        ) : (
          <article className={`caption-panel caption-panel-${singleTargetLanguage} single-caption-panel`}>
            <div className="caption-header">
              <span>{singleTarget.label}</span>
            </div>
            <div
              className="caption-scroll single-caption-scroll"
              ref={(element) => {
                if (element) {
                  captionScrollerRefs.current[singleTargetLanguage] = element;
                } else {
                  delete captionScrollerRefs.current[singleTargetLanguage];
                }
              }}
            >
              <p>{singleCaption}</p>
            </div>
          </article>
        )}

        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <div className={`font-dock ${controlsAwake ? "font-dock-awake" : ""}`} aria-label="Caption font size controls">
        <label className="font-control" title="English caption font size">
          <span>EN</span>
          <input
            aria-label="English caption font size"
            className="font-input"
            inputMode="numeric"
            max={MAX_CAPTION_FONT_SIZE}
            min={MIN_CAPTION_FONT_SIZE}
            onBlur={() => commitCaptionFontSize("en")}
            onChange={(event) => handleCaptionFontSizeChange("en", event.currentTarget.value)}
            type="number"
            value={captionFontSizeInputs.en}
          />
        </label>

        <label className="font-control" title="Chinese caption font size">
          <span>中文</span>
          <input
            aria-label="Chinese caption font size"
            className="font-input"
            inputMode="numeric"
            max={MAX_CAPTION_FONT_SIZE}
            min={MIN_CAPTION_FONT_SIZE}
            onBlur={() => commitCaptionFontSize("zh")}
            onChange={(event) => handleCaptionFontSizeChange("zh", event.currentTarget.value)}
            type="number"
            value={captionFontSizeInputs.zh}
          />
        </label>
      </div>
      </main>

      {floatingContainer
        ? createPortal(
            <FloatingCaptionWindow
              captionFontSizes={captionFontSizes}
              captions={captions}
              displayMode={displayMode}
              onClose={closeFloatingWindow}
              singleFallbackCaption={waitingTranslationText}
              sourceLanguage={sourceLanguage}
              translationCaptions={translationCaptions}
            />,
            floatingContainer
          )
        : null}
    </>
  );
}

type FloatingCaptionWindowProps = {
  captionFontSizes: CaptionFontSizeMap;
  captions: CaptionMap;
  displayMode: DisplayMode;
  onClose: () => void;
  singleFallbackCaption: string;
  sourceLanguage: TargetLanguage;
  translationCaptions: CaptionMap;
};

function FloatingCaptionWindow({
  captionFontSizes,
  captions,
  displayMode,
  onClose,
  singleFallbackCaption,
  sourceLanguage,
  translationCaptions,
}: FloatingCaptionWindowProps) {
  const singleTargetLanguage: TargetLanguage = sourceLanguage === "zh" ? "en" : "zh";
  const singleTarget = TARGETS.find((target) => target.code === singleTargetLanguage) ?? TARGETS[0];
  const singleCaption = getFloatingCaptionText(
    translationCaptions[singleTargetLanguage],
    singleFallbackCaption
  );
  const floatingStyle: FloatingCaptionStyle = {
    "--floating-font-size-en": `${captionFontSizes.en}px`,
    "--floating-font-size-zh": `${captionFontSizes.zh}px`,
  };

  return (
    <div className="floating-caption-shell" style={floatingStyle}>
      <div className="floating-caption-topbar">
        <span className="floating-caption-title">
          {displayMode === "dual" ? "Split View" : `${singleTarget.label} - Focus View`}
        </span>
        <button className="floating-close-button" onClick={onClose} title="Close floating captions" type="button">
          Close
        </button>
      </div>

      <div className="floating-caption-content" aria-live="polite">
        {displayMode === "dual" ? (
          <div className="floating-dual-grid">
            {TARGETS.map((target) => (
              <section className={`floating-caption-card floating-caption-card-${target.code}`} key={target.code}>
                <span className="floating-language-label">{target.label}</span>
                <p>{getFloatingCaptionText(captions[target.code], target.placeholder)}</p>
              </section>
            ))}
          </div>
        ) : (
          <section
            className={`floating-caption-card floating-caption-card-${singleTargetLanguage} floating-caption-card-focus`}
          >
            <span className="floating-language-label">{singleTarget.label}</span>
            <p>{singleCaption}</p>
          </section>
        )}
      </div>
    </div>
  );
}
