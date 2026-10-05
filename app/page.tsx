"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiMessage, ChatEvent, ChatMessage, ToolCall } from "@/lib/types";

type DisplayMessage = ChatMessage & { toolCalls?: ToolCall[]; error?: boolean };

export default function Home() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  // What Claude sees: the full conversation including tool calls, as returned
  // by the server after each completed reply. Kept separate from the
  // displayed messages and sent back unchanged.
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const history: DisplayMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setInput("");
    setLoading(true);

    // The reply is built up in place as events stream in.
    let reply: DisplayMessage = { role: "assistant", content: "", toolCalls: [] };
    const update = (changes: Partial<DisplayMessage>) => {
      reply = { ...reply, ...changes };
      setMessages([...history, reply]);
    };
    update({});

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...apiHistory, { role: "user", content: text }] }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      // Each line of the response body is one JSON event.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "text") {
            update({ content: reply.content + event.text });
          } else if (event.type === "tool") {
            update({ toolCalls: [...reply.toolCalls!, { name: event.name, input: event.input }] });
          } else if (event.type === "history") {
            setApiHistory(event.messages);
          } else {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message;
      update({
        content: reply.content ? `${reply.content}\n\n⚠️ ${message}` : message,
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Pi Chat Bot</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-center text-zinc-500">
              Say hello, or try &ldquo;What is 1234 + 5678?&rdquo;
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
              {m.toolCalls?.map((t, j) => (
                <div
                  key={j}
                  className="mb-1 rounded-md bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
                >
                  🔧 {t.name}({JSON.stringify(t.input)})
                </div>
              ))}
              {m.content && (
                <div
                  className={`max-w-prose whitespace-pre-wrap rounded-2xl px-4 py-2 ${
                    m.role === "user"
                      ? "bg-blue-600 text-white"
                      : m.error
                        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                        : "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {m.content}
                </div>
              )}
            </div>
          ))}
          {loading && !messages.at(-1)?.content && <div className="self-start text-sm text-zinc-500">Claude is thinking…</div>}
          <div ref={bottomRef} />
        </div>
      </main>

      <form
        onSubmit={sendMessage}
        className="border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-full border border-zinc-300 bg-transparent px-4 py-2 text-base text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-full bg-blue-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
