import Anthropic from "@anthropic-ai/sdk";
import { tools } from "@/lib/tools";
import type { ChatEvent, ChatMessage } from "@/lib/types";

// Reads ANTHROPIC_API_KEY from .env (Next.js loads it automatically).
const client = new Anthropic();

const SYSTEM_PROMPT =
  "You are a helpful assistant running on a Raspberry Pi 5. " +
  "Use the available tools when they fit the user's request.";

const MAX_JSON_RETRIES = 2;

function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Invalid API key - check ANTHROPIC_API_KEY in .env";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited - try again shortly";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: ChatMessage[] };
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // The tool runner calls Claude, runs any tools it asks for, sends the
      // results back, and repeats until Claude gives a final answer. With
      // stream: true each iteration yields a stream of events for one turn.
      let runner = client.beta.messages.toolRunner({
        model: "claude-opus-5-5",
        max_tokens: 64000,
        output_config: { effort: "medium" },
        // If a safety classifier declines, retry on a fallback model automatically.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        tools,
        // One tool call per step, so actions like "on, wait, off" run in order.
        // (The runner starts calls as they stream in, so several calls in one
        // step would run at the same time.)
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages,
        stream: true,
      });

      try {
        for (let attempt = 0; ; attempt++) {
          try {
            let sentText = false;
            for await (const turn of runner) {
              // Separate text from consecutive turns (e.g. before/after a tool call).
              let startedTurn = false;
              for await (const event of turn) {
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  if (!startedTurn && sentText) send({ type: "text", text: "\n\n" });
                  startedTurn = sentText = true;
                  send({ type: "text", text: event.delta.text });
                }
              }

              const message = await turn.finalMessage();
              attempt = 0;
              const toolUses = message.content.filter((b) => b.type === "tool_use");

              if (message.stop_reason === "refusal") {
                send({ type: "text", text: "\n\nSorry, I can't help with that." });
                break;
              }
              // A tool input cut off at max_tokens can still pass validation,
              // so stop before the runner executes it.
              if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
                send({ type: "error", error: "Response was cut off mid tool call" });
                break;
              }
              // The runner runs these tools when the loop asks for the next turn.
              for (const block of toolUses) {
                send({ type: "tool", name: block.name, input: block.input });
              }
            }
            break;
          } catch (err) {
            // Only unparseable tool-input JSON is retried; API errors are not.
            if (err instanceof Anthropic.APIError || attempt >= MAX_JSON_RETRIES) throw err;
            runner = client.beta.messages.toolRunner({ ...runner.params });
          }
        }
      } catch (err) {
        send({ type: "error", error: errorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
