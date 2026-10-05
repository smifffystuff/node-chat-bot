export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ToolCall = { name: string; input: unknown };

// Events streamed from /api/chat, one JSON object per line.
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "error"; error: string };

// CI test: deliberate type error - this PR should fail typecheck and build.
export const ciTest: number = "not a number";
