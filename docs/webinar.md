# Live webinars

`StudentPortalClient.openWebinar()` creates a participant session on the actual
server from LK's signed join URL. This can register room presence. It does not
connect microphone, camera, audio playback, send chat, or modify an LK profile.
`getWebinarJoinUrl()` still resolves a link without opening it.

```ts
const gateway = await portal.openWebinar({ webinarId });
const room = await gateway.connect(); // Backend state connection, no media.
try {
  console.log(room.getUsers(), room.getPresenter(), room.getMessages());
  const presentation = room.getCurrentPresentation();
  if (presentation) {
    for (const slide of presentation.slides) {
      const file = await gateway.downloadSlide({ slide });
      // file.body: Buffer; file.contentType; file.filename.
    }
  }
} finally {
  room.close();
}
```

For a custom frontend, send `gateway.getSession()` to **that student's browser**,
then instantiate `WebinarClient` from `chuvsu-js/browser` there and call
`connect()`. This connects state directly to BBB rather than through your backend.
Use either backend or browser state connection; duplicate connections for the
same participant can interfere with each other. Do not log, persist in shared
caches, or expose participant session credentials to other users. The session
contains BBB credentials, never LK email/password or cookies.

## State and events

- `getUsers()`, `getPresenter()`, `getModerators()` distinguish participant roles.
  Presenter/moderator does not automatically mean the scheduled lecturer.
- `getChats()` exposes only chats published to this participant.
- `getMessages({ chatId? })` reads accumulated history/live messages.
- `loadMessages({ chatId?, page? })` fetches a historical page, starting at 1.
  `connect()` loads the first public-chat page; subsequent pages are explicit.
  History and live messages deduplicate by ID and sort chronologically. Sender
  names also resolve for departed users. Text is plain text; do not render as HTML.
- `getPresentations()`, `getCurrentPresentation()` include sorted slides, SVG,
  thumbnail/text URLs, active slide and viewport. Slide URLs may need backend HTTP
  relay because of CORS; use `gateway.downloadSlide()` for bytes.
- `getMediaStreams()` lists published cameras/screens; meeting audio is separate.
- `getNotes()` returns revision and existing read/edit pad URLs when published.
  It never creates or edits a notes pad.
- `getSnapshot()` returns a fresh detached object; modifying it does not change
  the room or local state.

```ts
const unsubscribe = room.subscribe((event) => {
  if (event.type === "message") appendMessage(event.message);
  if (event.type === "change") refresh(room.getSnapshot());
});
// Or:
for await (const event of room.events({ signal, bufferSize: 512 })) {
  handle(event);
}
unsubscribe();
```

Streams are bounded. Overflow raises an error; refresh the snapshot and resubscribe.
Connection failures, rejected methods/subscriptions and unsupported versions fail
explicitly. `close()` releases the connection; create a new session/client to
reconnect. No automatic reconnect, replay of writes, or settings changes.

## Explicit actions

```ts
await room.setRaisedHand(true);
await room.setRaisedHand(false);
await room.sendMessage({ text: "Hello" }); // Public chat by default.
const chat = await room.openPrivateChat({ userId });
await room.sendMessage({ chatId: chat.id, text: "Hello" });
await room.sendPrivateMessage({ userId, text: "Hello" });
await room.setMuted(true); // Requires an already connected microphone session.
```

These methods are never invoked by connection, subscriptions or downloads.
Meeting locks are checked locally and BBB still enforces participant permissions.
An accepted method means submitted to BBB; observe live state for confirmation.

Original-file download uses `gateway.downloadPresentation({ presentationId })`
only after a state connection exposes `downloadable: true`. Disabled originals
are not fetched. SVG slide downloads remain separate from original downloads;
callers can assemble exported slides into a rendered PDF.

## Direct browser media

```ts
import { WebinarClient, WebinarMediaClient } from "chuvsu-js/browser";

// Session obtained from your authenticated backend, scoped to this student.
const room = new WebinarClient(session);
await room.connect();
const media = new WebinarMediaClient(session, room);
const audio = await media.listen(); // Explicit listen-only connection.
audioElement.srcObject = audio.stream;
await audioElement.play(); // Invoke from a user gesture when autoplay is blocked.

const camera = room.getMediaStreams().find((stream) => stream.kind === "camera");
if (camera) {
  const playback = await media.receiveCamera({ streamId: camera.id });
  videoElement.srcObject = playback.stream;
}
// Only when a screen is currently published:
// const screen = await media.receiveScreen({ signal });
// screenElement.srcObject = screen.stream;

const stats = await audio.getStats();
audio.onError(handleMediaError);
audio.onClose(handlePlaybackEnd);
// Component/page teardown:
media.close();
room.close();
```

Media uses the server's authenticated SFU WebSocket and browser WebRTC directly.
No backend media receiver or forwarding is required. `listen()` receives the
mixed room audio, not separate speaker tracks. Every playback exposes `stream`,
`connection`, `getStats()`, `onError()`, `onClose()`, and idempotent `close()`.
ICE candidates queue until negotiation is ready. Timeouts, aborts, disconnects
and remote stream termination release sockets, peers and tracks. Media teardown
is separate from room state teardown. Browser and network restrictions can still
require the BBB server's TURN relay.

Camera/screen IDs must be currently published to this participant. Camera lists
respect the moderator-only visibility setting. No microphone or camera is
captured/published by these receivers. Microphone connection, camera publication,
programmatic notes editing, and newer server adapters are not implemented in this
initial API; `setMuted()` only controls an already connected microphone session.

## Server versions

Initial adapter supports the inspected **BBB 2.3 Meteor/DDP + Kurento** protocol.
Version/build and endpoint configuration are read from each server's actual
HTML5 client, not the REST API's unrelated `version=2.0`. Other versions fail
explicitly until their participant protocol is implemented and tested. No shared
BBB integration secret is required or used.

Protocol references: [Meteor DDP](https://github.com/meteor/meteor/blob/devel/packages/ddp/DDP.md),
[BBB 2.3 participant source](https://github.com/bigbluebutton/bigbluebutton/tree/v2.3.0/bigbluebutton-html5/imports/api),
[external UI configuration](https://docs.bigbluebutton.org/administration/cluster-proxy/).
