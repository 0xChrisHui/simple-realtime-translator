"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FLOATING_WINDOW_HEIGHT, FLOATING_WINDOW_WIDTH } from "../lib/constants";

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

  .floating-caption-card-a {
    background: #080808;
    color: #f7fbff;
  }

  .floating-caption-card-b {
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
    text-align: left;
    text-wrap: wrap;
    white-space: pre-line;
    word-break: normal;
  }

  .floating-caption-card-a p {
    font-size: clamp(28px, 10vw, var(--floating-font-size-a));
    line-height: var(--floating-line-height-a, 1.08);
  }

  .floating-caption-card-b p {
    font-size: clamp(30px, 11vw, var(--floating-font-size-b));
    line-height: var(--floating-line-height-b, 1.18);
  }

  .floating-caption-card-focus.floating-caption-card-a p {
    font-size: clamp(34px, 12vw, var(--floating-font-size-a));
  }

  .floating-caption-card-focus.floating-caption-card-b p {
    font-size: clamp(34px, 12vw, var(--floating-font-size-b));
  }
`;

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

type UseFloatingWindowParams = {
  setError: (message: string) => void;
};

export function useFloatingWindow({ setError }: UseFloatingWindowParams) {
  const [floatingContainer, setFloatingContainer] = useState<HTMLElement | null>(null);
  const [floatingWindowOpen, setFloatingWindowOpen] = useState(false);
  const floatingWindowRef = useRef<Window | null>(null);

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
  }, [closeFloatingWindow, setError]);

  useEffect(() => closeFloatingWindow, [closeFloatingWindow]);

  return {
    floatingContainer,
    floatingWindowOpen,
    toggleFloatingWindow,
    closeFloatingWindow,
  };
}
