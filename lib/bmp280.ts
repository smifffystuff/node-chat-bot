import { setTimeout as sleep } from "node:timers/promises";
import { readRegisters, writeRegister } from "./i2c";

// Driver for the Bosch BMP280 (temperature, pressure) and BME280 (adds
// humidity), as found on HW-611 boards. Takes one measurement in forced mode
// per read, so the sensor sleeps in between and doesn't warm itself up.
// Register map and compensation formulas are from the Bosch datasheets.

const REG_CHIP_ID = 0xd0;
const REG_CALIB_TP = 0x88; // 24 bytes: temperature and pressure calibration
const REG_CALIB_H1 = 0xa1;
const REG_CALIB_H2 = 0xe1; // 7 bytes: rest of the humidity calibration
const REG_CTRL_HUM = 0xf2;
const REG_STATUS = 0xf3;
const REG_CTRL_MEAS = 0xf4;
const REG_DATA = 0xf7;

const CHIP_BMP280 = 0x58;
const CHIP_BME280 = 0x60;
const ADDRESSES = [0x76, 0x77] as const;

export type Reading = {
  chip: "BMP280" | "BME280";
  temperatureC: number;
  pressureHpa: number;
  humidityPercent?: number;
};

type Calibration = {
  T: number[];
  P: number[];
  H?: number[];
};

const u16 = (b: number[], i: number) => b[i] | (b[i + 1] << 8);
const s16 = (b: number[], i: number) => (u16(b, i) << 16) >> 16;
const s12 = (n: number) => (n << 20) >> 20;
const s8 = (n: number) => (n << 24) >> 24;

async function findChip(bus: number, address?: number) {
  const candidates = address === undefined ? ADDRESSES : [address];
  for (const candidate of candidates) {
    let id: number;
    try {
      [id] = await readRegisters(bus, candidate, REG_CHIP_ID, 1);
    } catch (error) {
      // A missing bus is worth reporting as is; otherwise nothing answered
      // at this address, so try the next one.
      if (error instanceof Error && error.message.includes("not found")) throw error;
      continue;
    }
    if (id === CHIP_BMP280 || id === CHIP_BME280) {
      return { address: candidate, isBme: id === CHIP_BME280 };
    }
    throw new Error(`Device at 0x${candidate.toString(16)} has unknown chip ID 0x${id.toString(16)}`);
  }
  const tried = candidates.map((a) => `0x${a.toString(16)}`).join(" or ");
  throw new Error(`No BMP280/BME280 answered on I2C bus ${bus} at ${tried}. Check the wiring.`);
}

async function readCalibration(bus: number, address: number, isBme: boolean): Promise<Calibration> {
  const b = await readRegisters(bus, address, REG_CALIB_TP, 24);
  const T = [u16(b, 0), s16(b, 2), s16(b, 4)];
  const P = [u16(b, 6), ...Array.from({ length: 8 }, (_, i) => s16(b, 8 + i * 2))];
  if (!isBme) return { T, P };

  const [h1] = await readRegisters(bus, address, REG_CALIB_H1, 1);
  const h = await readRegisters(bus, address, REG_CALIB_H2, 7);
  const H = [
    h1,
    s16(h, 0),
    h[2],
    s12((h[3] << 4) | (h[4] & 0x0f)),
    s12((h[5] << 4) | (h[4] >> 4)),
    s8(h[6]),
  ];
  return { T, P, H };
}

function compensate(cal: Calibration, adcT: number, adcP: number, adcH?: number) {
  const [T1, T2, T3] = cal.T;
  let var1 = (adcT / 16384 - T1 / 1024) * T2;
  let var2 = (adcT / 131072 - T1 / 8192) ** 2 * T3;
  const tFine = var1 + var2;
  const temperatureC = tFine / 5120;

  const [P1, P2, P3, P4, P5, P6, P7, P8, P9] = cal.P;
  var1 = tFine / 2 - 64000;
  var2 = (var1 * var1 * P6) / 32768;
  var2 = var2 + var1 * P5 * 2;
  var2 = var2 / 4 + P4 * 65536;
  var1 = ((P3 * var1 * var1) / 524288 + P2 * var1) / 524288;
  var1 = (1 + var1 / 32768) * P1;
  if (var1 === 0) throw new Error("Invalid pressure calibration data");
  let p = 1048576 - adcP;
  p = ((p - var2 / 4096) * 6250) / var1;
  var1 = (P9 * p * p) / 2147483648;
  var2 = (p * P8) / 32768;
  const pressureHpa = (p + (var1 + var2 + P7) / 16) / 100;

  if (!cal.H || adcH === undefined) return { temperatureC, pressureHpa };

  const [H1, H2, H3, H4, H5, H6] = cal.H;
  let h = tFine - 76800;
  h = (adcH - (H4 * 64 + (H5 / 16384) * h)) *
    ((H2 / 65536) * (1 + (H6 / 67108864) * h * (1 + (H3 / 67108864) * h)));
  h = h * (1 - (H1 * h) / 524288);
  const humidityPercent = Math.min(100, Math.max(0, h));
  return { temperatureC, pressureHpa, humidityPercent };
}

// Calibration is fixed per chip, so read it once per address.
const calibrationCache = new Map<string, Promise<Calibration>>();

/** Take one measurement. Tries 0x76 then 0x77 if no address is given. */
export async function readSensor(bus: number, address?: number): Promise<Reading> {
  const chip = await findChip(bus, address);
  const key = `${bus}:${chip.address}`;
  let calibration = calibrationCache.get(key);
  if (!calibration) {
    calibration = readCalibration(bus, chip.address, chip.isBme);
    calibrationCache.set(key, calibration);
    calibration.catch(() => calibrationCache.delete(key));
  }
  const cal = await calibration;

  // Oversampling x1 for each measurement, forced mode (measure once, then sleep).
  // ctrl_hum only takes effect after a write to ctrl_meas, so it goes first.
  if (chip.isBme) await writeRegister(bus, chip.address, REG_CTRL_HUM, 0b001);
  await writeRegister(bus, chip.address, REG_CTRL_MEAS, (0b001 << 5) | (0b001 << 2) | 0b01);

  // Takes about 10 ms; wait until the "measuring" bit clears.
  for (let attempt = 0; ; attempt++) {
    await sleep(10);
    const [status] = await readRegisters(bus, chip.address, REG_STATUS, 1);
    if ((status & 0b1000) === 0) break;
    if (attempt >= 20) throw new Error("Sensor didn't finish measuring");
  }

  const d = await readRegisters(bus, chip.address, REG_DATA, chip.isBme ? 8 : 6);
  const adcP = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  const adcT = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4);
  const adcH = chip.isBme ? (d[6] << 8) | d[7] : undefined;

  return { chip: chip.isBme ? "BME280" : "BMP280", ...compensate(cal, adcT, adcP, adcH) };
}
