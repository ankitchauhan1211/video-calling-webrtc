/**
 * Tune outgoing video encoding after the peer connection has local description set.
 * Improves perceived quality when combined with higher capture resolution.
 */

const DEFAULT_VIDEO_MAX_BITRATE = 2_800_000;
const DEFAULT_MAX_FRAMERATE = 30;

/**
 * @param {RTCPeerConnection} pc
 * @param {{ maxBitrate?: number; maxFramerate?: number }} [opts]
 */
export async function applyOutgoingVideoEncoding(pc, opts = {}) {
  const maxBitrate = opts.maxBitrate ?? DEFAULT_VIDEO_MAX_BITRATE;
  const maxFramerate = opts.maxFramerate ?? DEFAULT_MAX_FRAMERATE;
  const senders = pc.getSenders?.() ?? [];

  for (const sender of senders) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) {
        params.encodings = [{}];
      }
      for (const enc of params.encodings) {
        enc.maxBitrate = maxBitrate;
        enc.maxFramerate = maxFramerate;
      }
      await sender.setParameters(params);
    } catch {
      /* older browsers may reject */
    }
  }
}

/**
 * Hint encoder for real-time camera (better than default on some browsers).
 * @param {MediaStream} stream
 */
export function optimizeLocalVideoTracks(stream) {
  for (const track of stream.getVideoTracks()) {
    try {
      track.contentHint = "motion";
    } catch {
      /* optional */
    }
  }
}
