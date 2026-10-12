import { WebinarProtocolError } from "./types.js";

export type WebinarChatSubscriptionFormat = "ids" | "count";

/** Negotiate the subscription signature, then retain it for this participant. */
export async function subscribeToWebinarChat(
  transport: { subscribe(name: string, params: unknown[]): Promise<void> },
  chatIds: string[],
  format: WebinarChatSubscriptionFormat | null,
): Promise<WebinarChatSubscriptionFormat> {
  if (format !== null) {
    await transport.subscribe("group-chat-msg", format === "ids" ? [chatIds] : [chatIds.length]);
    return format;
  }
  try {
    await transport.subscribe("group-chat-msg", [chatIds]);
    return "ids";
  } catch (error) {
    // Only a signature mismatch permits another signature, never an auth/transport failure.
    if (!(error instanceof WebinarProtocolError) || (error.code !== 400 && error.code !== "400")) throw error;
    await transport.subscribe("group-chat-msg", [chatIds.length]);
    return "count";
  }
}
