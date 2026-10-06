import { access, constants, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { setPinFunction } from "./gpio";

// Hardware PWM through the kernel's sysfs interface, using the Pi 5's RP1 PWM0
// block, which needs `dtoverlay=pwm,pin=18,func=2` in config.txt. The channel
// is exported here and the pin is switched to its PWM function with pinctrl.
// Raspberry Pi OS's udev rules give the `gpio` group write access to exported
// channels. GPIO numbers are BCM numbers.

/** The PWM0 channel and pinctrl alt function for each pin that has one. */
export const PWM_PINS: Record<number, { channel: number; fn: string }> = {
  12: { channel: 0, fn: "a0" },
  13: { channel: 1, fn: "a0" },
  18: { channel: 2, fn: "a3" },
  19: { channel: 3, fn: "a3" },
};

// RP1's PWM0 block (PWM1, at 1f0009c000, drives the fan). It is only
// enabled with a PWM overlay in config.txt; see the README. The pwmchip
// number can change between kernels.
const PWM0_DEVICE = "1f00098000.pwm";

let chipPath: Promise<string> | undefined;

function findChip(): Promise<string> {
  chipPath ??= (async () => {
    for (const chip of await readdir("/sys/class/pwm")) {
      const path = `/sys/class/pwm/${chip}`;
      if ((await realpath(path)).includes(`/${PWM0_DEVICE}/`)) return path;
    }
    throw new Error(
      "Hardware PWM0 not found: add dtoverlay=pwm,pin=18,func=2 to /boot/firmware/config.txt and reboot",
    );
  })();
  chipPath.catch(() => (chipPath = undefined));
  return chipPath;
}

function pinInfo(gpio: number) {
  const info = PWM_PINS[gpio];
  if (!info) throw new Error(`GPIO ${gpio} has no hardware PWM (use 12, 13, 18 or 19)`);
  return info;
}

async function channelPath(gpio: number): Promise<string> {
  const { channel } = pinInfo(gpio);
  const chip = await findChip();
  const path = `${chip}/pwm${channel}`;
  try {
    await access(path);
    return path;
  } catch {
    await writeFile(`${chip}/export`, String(channel));
  }
  // udev fixes the new channel's permissions shortly after export.
  for (let i = 0; i < 50; i++) {
    try {
      await access(`${path}/enable`, constants.W_OK);
      return path;
    } catch {
      await sleep(20);
    }
  }
  throw new Error(`PWM channel for GPIO ${gpio} isn't writable (is the user in the gpio group?)`);
}

const read = async (file: string) => Number((await readFile(file, "utf8")).trim());

/** Output pulses of `pulseUs` microseconds every `periodUs` on the pin. */
export async function setPulse(gpio: number, periodUs: number, pulseUs: number): Promise<void> {
  const path = await channelPath(gpio);
  const period = Math.round(periodUs * 1000);
  const duty = Math.round(pulseUs * 1000);
  // The duty cycle can never exceed the period, so order the writes to suit.
  if ((await read(`${path}/period`)) !== period) {
    if ((await read(`${path}/duty_cycle`)) > period) await writeFile(`${path}/duty_cycle`, "0");
    await writeFile(`${path}/period`, String(period));
  }
  await writeFile(`${path}/duty_cycle`, String(duty));
  await writeFile(`${path}/enable`, "1");
  await setPinFunction(gpio, pinInfo(gpio).fn);
}

/** The current pulse width in microseconds, or null if the output is off. */
export async function readPulse(gpio: number): Promise<number | null> {
  const path = await channelPath(gpio);
  if ((await read(`${path}/enable`)) !== 1) return null;
  return (await read(`${path}/duty_cycle`)) / 1000;
}

/** Stop the pulses. The pin is left as an input, so nothing drives it. */
export async function stopPulse(gpio: number): Promise<void> {
  const path = await channelPath(gpio);
  await writeFile(`${path}/enable`, "0");
  await setPinFunction(gpio, "ip");
}
