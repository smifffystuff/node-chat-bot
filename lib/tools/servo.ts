import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { leds } from "@/config/leds";
import { servos, type ServoConfig } from "@/config/servos";
import { PWM_PINS, readPulse, setPulse, stopPulse } from "../pwm";

// Standard hobby servos expect a pulse every 20 ms.
const PERIOD_US = 20_000;
// Roughly how long a small servo takes to turn, so the tool returns once the
// move has finished (SG90: about 0.1 s per 60 degrees, plus some margin).
const MS_PER_DEGREE = 3;
const MIN_MOVE_MS = 150;

// Catch config mistakes at startup rather than on the first tool call.
function validateConfig(config: readonly ServoConfig[]) {
  if (config.length === 0) throw new Error("config/servos.ts: no servos configured");
  const names = new Set<string>();
  const pins = new Set<number>(leds.map((led) => led.gpio));
  for (const { name, gpio, minPulseUs, maxPulseUs, maxAngle } of config) {
    if (!/^[a-z0-9_-]+$/.test(name)) {
      throw new Error(`config/servos.ts: invalid servo name "${name}" (use lowercase, no spaces)`);
    }
    if (!(gpio in PWM_PINS)) {
      throw new Error(`config/servos.ts: servo "${name}" is on GPIO ${gpio}, which has no hardware PWM (use 12, 13, 18 or 19)`);
    }
    if (!(minPulseUs > 0 && minPulseUs < maxPulseUs && maxPulseUs < PERIOD_US)) {
      throw new Error(`config/servos.ts: servo "${name}" needs 0 < minPulseUs < maxPulseUs < ${PERIOD_US}`);
    }
    if (!(maxAngle > 0 && maxAngle <= 360)) {
      throw new Error(`config/servos.ts: servo "${name}" has invalid maxAngle ${maxAngle}`);
    }
    if (names.has(name)) throw new Error(`config/servos.ts: duplicate servo name "${name}"`);
    if (pins.has(gpio)) {
      throw new Error(`config/servos.ts: GPIO ${gpio} is used by more than one servo or LED`);
    }
    names.add(name);
    pins.add(gpio);
  }
}
validateConfig(servos);

const servoByName = new Map<string, ServoConfig>(servos.map((servo) => [servo.name, servo]));
const servoNames = servos.map((servo) => servo.name) as [string, ...string[]];

const servoList = servos
  .map(
    (servo: ServoConfig) =>
      `${servo.name} (0-${servo.maxAngle} degrees${servo.description ? `, ${servo.description}` : ""})`,
  )
  .join(", ");

function angleToPulse(servo: ServoConfig, angle: number): number {
  const fraction = (servo.reversed ? servo.maxAngle - angle : angle) / servo.maxAngle;
  return servo.minPulseUs + fraction * (servo.maxPulseUs - servo.minPulseUs);
}

function pulseToAngle(servo: ServoConfig, pulseUs: number): number {
  const fraction = (pulseUs - servo.minPulseUs) / (servo.maxPulseUs - servo.minPulseUs);
  const angle = fraction * servo.maxAngle;
  return servo.reversed ? servo.maxAngle - angle : angle;
}

/** The angle the servo is holding, or null if it isn't being driven. */
async function currentAngle(servo: ServoConfig): Promise<number | null> {
  const pulse = await readPulse(servo.gpio);
  return pulse === null ? null : pulseToAngle(servo, pulse);
}

const formatAngle = (angle: number) => `${Math.round(angle * 10) / 10} degrees`;

export const servo = {
  ...betaZodTool({
    name: "servo",
    description:
      `Turn a servo motor wired to the Raspberry Pi. Available servos: ${servoList}. ` +
      "Angles are absolute positions: 0 is fully right, the maximum is fully left, and " +
      "the middle (e.g. 90 of 180) is centre. Use 'turn_to' with angle to move to a " +
      "position ('turn to 45 degrees', 'centre it'). Use 'turn_by' with degrees and " +
      "direction to move relative to where it is now ('rotate 30 degrees to the left'); " +
      "moves past either end stop at the end. Use 'status' to read the current angle, and " +
      "'release' to stop driving the servo so it goes limp and quiet (its position is then " +
      "unknown until the next 'turn_to'). Returns once the move has finished, with the angle.",
    inputSchema: z.object({
      servo: z.enum(servoNames).describe("Which servo to act on"),
      action: z.enum(["turn_to", "turn_by", "status", "release"]).describe("What to do"),
      angle: z
        .number()
        .min(0)
        .optional()
        .describe("For 'turn_to': the position to turn to, in degrees from fully right"),
      degrees: z
        .number()
        .positive()
        .optional()
        .describe("For 'turn_by': how many degrees to turn"),
      direction: z
        .enum(["left", "right"])
        .optional()
        .describe("For 'turn_by': which way to turn (left = towards higher angles)"),
    }),
    run: async ({ servo: name, action, angle, degrees, direction }) => {
      const target = servoByName.get(name)!;

      if (action === "status") {
        const now = await currentAngle(target);
        return now === null
          ? `${name} is released (not being driven), so its position is unknown.`
          : `${name} is at ${formatAngle(now)}.`;
      }

      if (action === "release") {
        await stopPulse(target.gpio);
        return `${name} released; it is no longer holding its position.`;
      }

      const from = await currentAngle(target);
      let to: number;
      let note = "";
      if (action === "turn_to") {
        if (angle === undefined) throw new Error("'turn_to' needs an angle");
        if (angle > target.maxAngle) {
          throw new Error(`${name} can only turn to 0-${target.maxAngle} degrees`);
        }
        to = angle;
      } else {
        if (degrees === undefined || direction === undefined) {
          throw new Error("'turn_by' needs degrees and a direction");
        }
        if (from === null) {
          throw new Error(
            `${name}'s position is unknown because it isn't being driven; use 'turn_to' first`,
          );
        }
        const wanted = from + (direction === "left" ? degrees : -degrees);
        to = Math.min(target.maxAngle, Math.max(0, wanted));
        if (to !== wanted) note = ` It stopped at its ${direction} limit.`;
      }

      await setPulse(target.gpio, PERIOD_US, angleToPulse(target, to));
      // From an unknown position, allow for a move across the full range.
      const distance = from === null ? target.maxAngle : Math.abs(to - from);
      await sleep(Math.max(MIN_MOVE_MS, distance * MS_PER_DEGREE));
      return `${name} is now at ${formatAngle(to)}.${note}`;
    },
  }),
  // Stream tool input as it's generated; the Zod schema still validates it
  // before run() is called.
  eager_input_streaming: true,
};
