import { parseWebinarSession } from '../../dist/webinar/parse.js';

export const origin = 'https://webinar.example';
export const config = {
 app: { bbbServerVersion: 2.3, html5ClientBuild: 100, basename: '/html5client', raiseHandActionButton: { enabled: true } },
 kurento: { wsUrl: 'wss://webinar.example/bbb-webrtc-sfu', enableListenOnly: true, enableVideo: true, enableScreensharing: true },
 chat: { enabled: true, public_group_id: 'public', itemsPerPage: 2, max_message_length: 20 },
 note: { enabled: true, url: origin + '/pad' },
 presentation: { allowDownloadable: true },
};
export const entry = { response: {
 returncode: 'SUCCESS', authToken: 'synthetic-auth', internalUserID: 'self', meetingID: 'meeting',
 fullname: 'Student', voicebridge: '12345', confname: 'Synthetic lecture', externUserID: 'external', role: 'VIEWER',
} };
export const session = () => parseWebinarSession({
 clientUrl: origin + '/html5client/join?sessionToken=synthetic-session', config, entry, iceServers: [],
});
