import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { leds, type LedConfig } from "@/config/leds";
import { readPin, writePin } from "../gpio";

const MAX_DURATION_SECONDS = 60;

// Catch config mistakes at startup rather than on the first tool call.
function validateConfig(config: readonly LedConfig[]) {
  if (config.length === 0) throw new Error("config/leds.ts: no LEDs configured");
  const names = new Set<string>();
  const pins = new Set<number>();
  for (const { name, gpio } of config) {
    if (!/^[a-z0-9_-]+$/.test(name)) {
      throw new Error(`config/leds.ts: invalid LED name "${name}" (use lowercase, no spaces)`);
    }
    if (!Number.isInteger(gpio) || gpio < 0 || gpio > 27) {
      throw new Error(`config/leds.ts: LED "${name}" has invalid GPIO ${gpio} (expected 0-27)`);
    }
    if (names.has(name)) throw new Error(`config/leds.ts: duplicate LED name "${name}"`);
    if (pins.has(gpio)) throw new Error(`config/leds.ts: GPIO ${gpio} is used by more than one LED`);
    names.add(name);
    pins.add(gpio);
  }
}
validateConfig(leds);

const ledByName = new Map<string, LedConfig>(leds.map((led) => [led.name, led]));
const ledNames = leds.map((led) => led.name) as [string, ...string[]];

const ledList = leds
  .map((led: LedConfig) => `${led.name} (GPIO ${led.gpio}${led.description ? `, ${led.description}` : ""})`)
  .join(", ");

async function describeStates(targets: LedConfig[]): Promise<string> {
  const states = await Promise.all(
    targets.map(async (led) => `${led.name}: ${(await readPin(led.gpio)) ? "on" : "off"}`),
  );
  return states.join(", ");
}

export const led = {
  ...betaZodTool({
    name: "led",
    description:
      `Control the LEDs wired to the Raspberry Pi. Available LEDs: ${ledList}. ` +
      "Pass one or more LEDs; the action applies to all of them at the same time. " +
      "Use 'on' or 'off' to switch them, or 'status' to check which are lit. To light " +
      "them for a set time (e.g. 'on for 1 second'), use 'on' with duration_seconds: they " +
      "switch on, stay on for exactly that long, then switch off, all in this one call. " +
      "Prefer this over separate on/wait/off calls, which can't time things precisely. " +
      "Returns each LED's state afterwards.",
    inputSchema: z.object({
      leds: z
        .array(z.enum(ledNames))
        .min(1)
        .describe("Which LEDs to act on, e.g. [\"red\"] or every LED for 'all of them'"),
      action: z.enum(["on", "off", "status"]).describe("What to do with the LEDs"),
      duration_seconds: z
        .number()
        .positive()
        .max(MAX_DURATION_SECONDS)
        .optional()
        .describe(
          `Only with action 'on': keep the LEDs on for this many seconds (up to ${MAX_DURATION_SECONDS}), then switch them off`,
        ),
    }),
    run: async ({ leds: names, action, duration_seconds }) => {
      const targets = [...new Set(names)].map((name) => ledByName.get(name)!);
      const setAll = (high: boolean) =>
        Promise.all(targets.map((target) => writePin(target.gpio, high)));

      if (duration_seconds !== undefined) {
        if (action !== "on") {
          throw new Error("duration_seconds can only be used with action 'on'");
        }
        try {
          await setAll(true);
          await sleep(duration_seconds * 1000);
        } finally {
          // Always switch off again, even if something failed while they were on.
          await setAll(false);
        }
        const seconds = `${duration_seconds} second${duration_seconds === 1 ? "" : "s"}`;
        return `Was on for ${seconds}. Now: ${await describeStates(targets)}.`;
      }

      if (action !== "status") {
        await setAll(action === "on");
      }
      return `Now: ${await describeStates(targets)}.`;
    },
  }),
  // Stream tool input as it's generated; the Zod schema still validates it
  // before run() is called.
  eager_input_streaming: true,
};
