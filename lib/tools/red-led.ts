import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readPin, writePin } from "../gpio";

// BCM GPIO number the red LED is wired to (physical pin 8 on the header).
const RED_LED_GPIO = 14;

export const redLed = {
  ...betaZodTool({
    name: "red_led",
    description:
      "Control the red LED wired to the Raspberry Pi. Use 'on' or 'off' to switch it, " +
      "or 'status' to check whether it is currently lit. Returns the LED's state afterwards.",
    inputSchema: z.object({
      action: z.enum(["on", "off", "status"]).describe("What to do with the LED"),
    }),
    run: async ({ action }) => {
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
