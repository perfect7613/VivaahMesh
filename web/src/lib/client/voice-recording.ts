const maxDurationMs = 30_000;
const maxBytes = 3 * 1024 * 1024;
const mimeTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
const fileExtensions: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg",
};

export interface VoiceRecording {
  stop: () => void;
  cancel: () => void;
  audio: Promise<File | null>;
}

export async function recordVoiceClip(): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("recording_unavailable");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 } } });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let recorder: MediaRecorder;
  try {
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 64_000 });
    recorder.start();
  } catch (error) {
    release();
    throw error;
  }

  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const timer = window.setTimeout(stop, maxDurationMs);
  const dispose = () => {
    window.clearTimeout(timer);
    release();
  };
  const chunks: Blob[] = [];
  let cancelled = false;
  const audio = new Promise<File | null>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("error", () => {
      dispose();
      if (cancelled) resolve(null);
      else reject(new Error("recording_failed"));
    }, { once: true });
    recorder.addEventListener("stop", () => {
      dispose();
      if (cancelled) {
        resolve(null);
        return;
      }
      const type = (recorder.mimeType || chunks[0]?.type || "").split(";")[0];
      const extension = fileExtensions[type];
      const clip = new Blob(chunks, { type });
      if (!extension || !clip.size || clip.size > maxBytes) {
        reject(new Error("recording_invalid"));
        return;
      }
      resolve(new File([clip], `voice-note.${extension}`, { type }));
    }, { once: true });
  });
  return {
    stop,
    cancel() {
      cancelled = true;
      stop();
      dispose();
    },
    audio,
  };
}
