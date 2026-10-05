import type Anthropic from "@anthropic-ai/sdk";

// The conversation as sent to Claude, including tool calls and their results.
// The page stores it exactly as the server returned it and sends it back
// unchanged; editing earlier messages would invalidate Claude's earlier turns.
export type ApiMessage = Anthropic.Beta.BetaMessageParam;

// A message as shown in the chat UI.
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ToolCall = { name: string; input: unknown };

// Events streamed from /api/chat, one JSON object per line.
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "error"; error: string }
  // Sent last, only when the reply completed: the full conversation so far,
  // for the page to send back with the next message.
  | { type: "history"; messages: ApiMessage[] };
