import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const MAX_WAIT_SECONDS = 60;

export const wait = {
  ...betaZodTool({
    name: "wait",
    description:
      "Pause for a number of seconds before doing the next thing, for sequences like " +
      "'turn the LED on, wait 5 seconds, then turn it off'. Timing between steps is " +
      "approximate (it also includes the time taken to decide the next step), so when " +
      "a tool has its own duration option, such as red_led's duration_seconds, use that " +
      "instead for precise timing.",
    inputSchema: z.object({
      seconds: z
        .number()
        .positive()
        .max(MAX_WAIT_SECONDS)
        .describe(`How long to wait, in seconds (up to ${MAX_WAIT_SECONDS})`),
    }),
    run: async ({ seconds }) => {
      await sleep(seconds * 1000);
      return `Waited ${seconds} second${seconds === 1 ? "" : "s"}.`;
    },
  }),
  eager_input_streaming: true,
};
