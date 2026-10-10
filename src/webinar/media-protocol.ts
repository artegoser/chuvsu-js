import type { WebinarDocument } from "./ddp.js";
import type { WebinarPlaybackKind } from "./media-types.js";
import type { WebinarSession } from "./types.js";

/** BBB 2.3 SFU messages. One playback per socket; no publish commands. */
export function webinarMediaMessages(
  session: WebinarSession,
  kind: WebinarPlaybackKind,
  streamId?: string,
  hasAudio = false,
) {
  const type = kind === "camera" ? "video" : kind === "screen" ? "screenshare" : "audio";
  const role = kind === "camera" ? "viewer" : "recv";
  const identity = { type, role, voiceBridge: session.meeting.voiceBridge };
  const specific = kind === "camera" ? { cameraId: streamId } : kind === "screen" ? { callerName: session.user.id } : {};
  return {
    start(sdpOffer: string): WebinarDocument {
      return {
        ...identity, ...specific, id: "start", sdpOffer,
        userName: session.user.name,
        ...(kind === "camera"
          ? { meetingId: session.meeting.id, userId: session.user.id }
          : { internalMeetingId: session.meeting.id }),
        ...(kind === "audio" ? { userId: session.user.id, caleeName: `GLOBAL_AUDIO_${session.meeting.voiceBridge}` } : {}),
        ...(kind === "screen" ? { hasAudio } : {}),
      };
    },
    candidate(candidate: RTCIceCandidateInit): WebinarDocument {
      return { ...identity, ...specific, id: kind === "camera" ? "onIceCandidate" : "iceCandidate", candidate };
    },
    stop(): WebinarDocument { return { ...identity, ...specific, id: "stop" }; },
  };
}
