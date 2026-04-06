/**
 * Mobile-friendly getUserMedia with fallbacks and clear errors.
 * Browsers require a secure context (HTTPS) except localhost.
 */

export function hasSecureMediaContext() {
  if (typeof window === "undefined") return true;
  if (window.isSecureContext) return true;
  const { protocol, hostname } = window.location;
  return (
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/** @param {MediaStreamConstraints} c */
async function tryGetUserMedia(c) {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    const legacy =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;
    if (!legacy) {
      throw new DOMException("getUserMedia not supported", "NotSupportedError");
    }
    return new Promise((resolve, reject) => {
      legacy.call(navigator, c, resolve, reject);
    });
  }
  return md.getUserMedia(c);
}

/**
 * Try several constraint sets — mobile often needs `facingMode` or simpler audio.
 * @returns {Promise<{ stream: MediaStream, usedAudio: boolean, usedVideo: boolean }>}
 */
export async function acquireLocalMedia() {
  if (typeof navigator === "undefined") {
    throw new Error("SSR");
  }

  if (!hasSecureMediaContext()) {
    throw new Error(
      "Camera/mic need HTTPS. Open this app with https:// or use localhost — plain http:// on your phone’s IP will not work."
    );
  }

  const attempts = [
    {
      label: "HD 720p front",
      constraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      },
    },
    {
      label: "HD flexible",
      constraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      },
    },
    {
      label: "simple front camera",
      constraints: {
        audio: true,
        video: { facingMode: "user" },
      },
    },
    {
      label: "basic av",
      constraints: { audio: true, video: true },
    },
    {
      label: "ideal front + audio processing",
      constraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: { ideal: "user" },
        },
      },
    },
    {
      label: "audio only",
      constraints: { audio: true, video: false },
    },
    {
      label: "video only",
      constraints: { audio: false, video: { facingMode: "user" } },
    },
    {
      label: "video only basic",
      constraints: { audio: false, video: true },
    },
  ];

  let lastErr = null;
  for (const { constraints } of attempts) {
    try {
      const stream = await tryGetUserMedia(constraints);
      const usedAudio = stream.getAudioTracks().length > 0;
      const usedVideo = stream.getVideoTracks().length > 0;
      return { stream, usedAudio, usedVideo };
    } catch (e) {
      lastErr = e;
    }
  }

  const err = lastErr;
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    throw new Error(
      "Camera/mic blocked. Allow access in the browser site settings, or tap the lock icon in the address bar."
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    throw new Error("No camera or microphone found on this device.");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    throw new Error("Camera/mic is busy or in use by another app. Close other apps and try again.");
  }
  if (name === "OverconstrainedError") {
    throw new Error("This device does not support the requested camera settings. Try again or use another browser.");
  }
  if (name === "NotSupportedError") {
    throw new Error("Your browser does not support camera/mic here. Try Chrome or Safari, or update the browser.");
  }
  throw new Error(err?.message || "Camera/mic unavailable.");
}
