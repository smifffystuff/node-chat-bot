import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

// I2C access via `i2ctransfer` (from i2c-tools, which ships with Raspberry Pi
// OS). Needs I2C enabled (`sudo raspi-config nonint do_i2c 0`, then reboot)
// and the user to be in the `i2c` group.

const run = promisify(execFile);

async function i2ctransfer(bus: number, ...messages: string[]): Promise<string> {
  if (!existsSync(`/dev/i2c-${bus}`)) {
    throw new Error(
      `I2C bus ${bus} not found (/dev/i2c-${bus}). Enable I2C with ` +
        "`sudo raspi-config nonint do_i2c 0` and reboot.",
    );
  }
  const { stdout } = await run("i2ctransfer", ["-y", String(bus), ...messages], {
    timeout: 5000,
  });
  return stdout;
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

/** Read `length` bytes starting at `register` from the device at `address`. */
export async function readRegisters(
  bus: number,
  address: number,
  register: number,
  length: number,
): Promise<number[]> {
  // Output looks like: "0x58 0x00 0x1f"
  const output = await i2ctransfer(bus, `w1@${hex(address)}`, hex(register), `r${length}`);
  const bytes = output.trim().split(/\s+/).map(Number);
  if (bytes.length !== length || bytes.some(Number.isNaN)) {
    throw new Error(`Unexpected i2ctransfer output: ${output.trim()}`);
  }
  return bytes;
}

/** Write one byte to `register` on the device at `address`. */
export async function writeRegister(
  bus: number,
  address: number,
  register: number,
  value: number,
): Promise<void> {
  await i2ctransfer(bus, `w2@${hex(address)}`, hex(register), hex(value));
}
