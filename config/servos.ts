// Servos wired to the Raspberry Pi. To add one, wire it up and add an entry
// here; the `servo` tool picks it up automatically.
//
// - name:        what you and Claude call it ("servo", "pan", ...). Lowercase,
//                unique, no spaces.
// - gpio:        BCM GPIO number of the signal wire. Must be a hardware PWM
//                pin: 12, 13, 18 or 19.
// - minPulseUs / maxPulseUs: pulse widths, in microseconds, for 0 degrees and
//                for maxAngle. 500-2500 suits most SG90/MG90S servos. If the
//                servo buzzes or strains at either end, move these inwards.
// - maxAngle:    how far the servo can turn, usually 180.
// - reversed:    by default a higher angle turns left (anticlockwise, looking
//                at the horn). Set to true if "left" turns it the other way.
// - description: optional extra detail Claude can use, e.g. what it's attached to.

export type ServoConfig = {
  name: string;
  gpio: number;
  minPulseUs: number;
  maxPulseUs: number;
  maxAngle: number;
  reversed?: boolean;
  description?: string;
};

export const servos = [
  { name: "servo", gpio: 18, minPulseUs: 500, maxPulseUs: 2500, maxAngle: 180 },
] as const satisfies readonly ServoConfig[];
