// LEDs wired to the Raspberry Pi. To add one, wire it up and add an entry
// here; the `led` tool picks it up automatically.
//
// - name:        what you and Claude call it ("red", "blue", ...). Lowercase,
//                unique, no spaces.
// - gpio:        BCM GPIO number (not the physical header pin number).
// - description: optional extra detail Claude can use, e.g. its location.

export type LedConfig = {
  name: string;
  gpio: number;
  description?: string;
};

export const leds = [
  { name: "red", gpio: 14 },
  { name: "blue", gpio: 15 },
  { name: "green", gpio: 23 },
] as const satisfies readonly LedConfig[];
