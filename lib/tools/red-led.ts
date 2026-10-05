import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { readPin, writePin } from "../gpio";

// BCM GPIO number the red LED is wired to (physical pin 8 on the header).
const RED_LED_GPIO = 14;
const MAX_DURATION_SECONDS = 60;

export const redLed = {
  ...betaZodTool({
    name: "red_led",
    description:
      "Control the red LED wired to the Raspberry Pi. Use 'on' or 'off' to switch it, " +
      "or 'status' to check whether it is currently lit. To light it for a set time " +
      "(e.g. 'on for 1 second'), use 'on' with duration_seconds: the LED switches on, " +
      "stays on for exactly that long, then switches off, all in this one call. Prefer " +
      "this over separate on/wait/off calls, which can't time things precisely. " +
      "Returns the LED's state afterwards.",
    inputSchema: z.object({
      action: z.enum(["on", "off", "status"]).describe("What to do with the LED"),
      duration_seconds: z
        .number()
        .positive()
        .max(MAX_DURATION_SECONDS)
        .optional()
        .describe(
          `Only with action 'on': keep the LED on for this many seconds (up to ${MAX_DURATION_SECONDS}), then switch it off`,
        ),
    }),
    run: async ({ action, duration_seconds }) => {
      if (duration_seconds !== undefined) {
        if (action !== "on") {
          throw new Error("duration_seconds can only be used with action 'on'");
        }
        try {
          await writePin(RED_LED_GPIO, true);
          await sleep(duration_seconds * 1000);
        } finally {
          // Always switch off again, even if something failed while it was on.
          await writePin(RED_LED_GPIO, false);
        }
        const isOn = await readPin(RED_LED_GPIO);
        return `The red LED was on for ${duration_seconds} second${duration_seconds === 1 ? "" : "s"} and is now ${isOn ? "on" : "off"}.`;
      }

      if (action !== "status") {
        await writePin(RED_LED_GPIO, action === "on");
      }
      const isOn = await readPin(RED_LED_GPIO);
      return `The red LED is ${isOn ? "on" : "off"}.`;
    },
  }),
  // Stream tool input as it's generated; the Zod schema still validates it
  // before run() is called.
  eager_input_streaming: true,
};
