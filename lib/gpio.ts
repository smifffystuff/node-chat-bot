import { execFile } from "node:child_process";
import { promisify } from "node:util";

// GPIO access via Raspberry Pi's `pinctrl` tool (ships with Raspberry Pi OS).
// It sets the pin and exits, and the pin keeps its state afterwards. Needs
// the user to be in the `gpio` group. GPIO numbers are BCM numbers.

const run = promisify(execFile);

async function pinctrl(...args: string[]): Promise<string> {
  const { stdout } = await run("pinctrl", args, { timeout: 5000 });
  return stdout;
}

/** Configure a pin as an output and drive it high (true) or low (false). */
export async function writePin(gpio: number, high: boolean): Promise<void> {
  await pinctrl("set", String(gpio), "op", high ? "dh" : "dl");
}

/** Read a pin's current level: true for high, false for low. */
export async function readPin(gpio: number): Promise<boolean> {
  // Output looks like: "14: op dh pd | hi // GPIO14 = output"
  const output = await pinctrl("get", String(gpio));
  const level = output.match(/\|\s*(hi|lo)\b/)?.[1];
  if (!level) throw new Error(`Unexpected pinctrl output: ${output.trim()}`);
  return level === "hi";
}
