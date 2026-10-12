import test from "node:test";
import assert from "node:assert/strict";
import { webinarTypingUsers } from "../dist/webinar/typing.js";
import { session } from "./helpers/webinar.mjs";

test("typing snapshots exclude self, other recipients/meetings and hidden viewers", () => {
  const participant = session();
  const users = [
    { userId: "self", name: "Student", role: "VIEWER" },
    { userId: "peer", name: "Peer", role: "VIEWER" },
    { userId: "moderator", name: "Teacher", role: "MODERATOR" },
  ];
  const chats = [
    { chatId: "private", access: "PRIVATE_ACCESS", users: ["self", "peer"] },
  ];
  const doc = (userId, isTypingTo, meetingId = "meeting") => ({
    userId,
    isTypingTo,
    meetingId,
  });
  const documents = [
    doc("self", "typing-public"),
    doc("peer", "typing-public"),
    doc("moderator", "typing-public"),
    doc("peer", "self"),
    doc("peer", "other"),
    doc("peer", "typing-public", "other-meeting"),
  ];
  assert.deepEqual(
    webinarTypingUsers(documents, users, chats, participant, {}).map((user) => [
      user.userId,
      user.chatId,
    ]),
    [
      ["peer", "public"],
      ["peer", "private"],
      ["moderator", "public"],
    ],
  );
  assert.deepEqual(
    webinarTypingUsers(documents, users, chats, participant, {
      lockSettingsProps: { hideUserList: true },
    }).map((user) => user.userId),
    ["moderator"],
  );
});
