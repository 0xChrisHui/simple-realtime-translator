"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioInputDevice } from "../lib/types";

type UseAudioInputsParams = {
  setError: (message: string) => void;
};

export function useAudioInputs({ setError }: UseAudioInputsParams) {
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState("");
  const selectedAudioInputIdRef = useRef("");

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
  }, [setError]);

  useEffect(() => {
    void refreshAudioInputs();

    if (!navigator.mediaDevices?.addEventListener) return;

    navigator.mediaDevices.addEventListener("devicechange", refreshAudioInputs);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshAudioInputs);
  }, [refreshAudioInputs]);

  const selectAudioInput = useCallback((deviceId: string) => {
    selectedAudioInputIdRef.current = deviceId;
    setSelectedAudioInputId(deviceId);
  }, []);

  return {
    audioInputs,
    selectedAudioInputId,
    selectedAudioInputIdRef,
    selectAudioInput,
    refreshAudioInputs,
  };
}
