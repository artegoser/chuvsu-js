import { record, string } from "./parse.js";
import type { WebinarDocument } from "./ddp.js";
import type { WebinarSession } from "./types.js";

/** Only this participant's accessible conversations and visible users are projected. */
export function webinarTypingUsers(
  documents: WebinarDocument[],
  users: WebinarDocument[],
  chats: WebinarDocument[],
  session: WebinarSession,
  meeting: WebinarDocument | undefined,
): { userId: string; name: string; chatId: string }[] {
  if (!session.features.typing) return [];
  const self = users.find((user) => user.userId === session.user.id);
  const hideViewers =
    self?.role !== "MODERATOR" &&
    record(meeting?.lockSettingsProps).hideUserList === true;
  const result = new Map<
    string,
    { userId: string; name: string; chatId: string }
  >();
  for (const doc of documents) {
    const userId = string(doc.userId);
    if (
      !userId ||
      userId === session.user.id ||
      doc.meetingId !== session.meeting.id
    )
      continue;
    const user = users.find(
      (user) => user.userId === userId && user.loggedOut !== true,
    );
    if (!user || (hideViewers && user.role !== "MODERATOR")) continue;
    const target = string(doc.isTypingTo);
    const chatId =
      target === (session.publicTypingId ?? session.publicChatId)
        ? session.publicChatId
        : target === session.user.id
          ? string(
              chats.find(
                (chat) =>
                  chat.access === "PRIVATE_ACCESS" &&
                  Array.isArray(chat.users) &&
                  chat.users.includes(session.user.id) &&
                  chat.users.includes(userId),
              )?.chatId,
            )
          : "";
    if (chatId)
      result.set(`${userId}/${chatId}`, {
        userId,
        name: string(user.name) || string(doc.name),
        chatId,
      });
  }
  return [...result.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ru"),
  );
}
