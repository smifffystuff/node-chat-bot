import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sensor } from "@/config/sensor";
import { readSensor } from "../bmp280";

export const readEnvironment = {
  ...betaZodTool({
    name: "read_environment",
    description:
      "Read the environment sensor wired to the Raspberry Pi (an HW-611 board: BMP280 or BME280)" +
      (sensor.description ? `, ${sensor.description}` : "") +
      ". Returns the current temperature in °C and air pressure in hPa, plus relative " +
      "humidity in % if the board is a BME280. Takes a fresh reading on every call.",
    inputSchema: z.object({}),
    run: async () => {
      const r = await readSensor(sensor.bus, sensor.address);
      const parts = [
        `Temperature: ${r.temperatureC.toFixed(1)} °C`,
        `Pressure: ${r.pressureHpa.toFixed(1)} hPa`,
      ];
      if (r.humidityPercent !== undefined) {
        parts.push(`Humidity: ${r.humidityPercent.toFixed(0)} %`);
      }
      return `${parts.join(", ")} (${r.chip}).`;
    },
  }),
  // Stream tool input as it's generated; the Zod schema still validates it
  // before run() is called.
  eager_input_streaming: true,
};
