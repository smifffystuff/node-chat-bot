// HW-611 environment sensor (BMP280, or BME280 on boards that also measure
// humidity) wired to the Pi's I2C pins:
//
//   HW-611  ->  Pi header
//   VCC     ->  3.3V (pin 1)   - not 5V
//   GND     ->  GND  (pin 6)
//   SCL     ->  GPIO 3 / SCL (pin 5)
//   SDA     ->  GPIO 2 / SDA (pin 3)
//   CSB     ->  3.3V (pin 17)  - selects I2C; if left floating the chip can
//                                start up in SPI mode and never answer
//   SDO     ->  GND  (pin 9)   - address 0x76 (3.3V instead gives 0x77);
//                                floating leaves the address undefined
//
// GPIO 2 and 3 are then in use by I2C, so don't put LEDs on them.
//
// - bus:         I2C bus number; 1 is the one on header pins 3 and 5.
// - address:     0x76 or 0x77. Leave it out to try both.
// - description: optional extra detail Claude can use, e.g. its location.

export type SensorConfig = {
  bus: number;
  address?: 0x76 | 0x77;
  description?: string;
};

export const sensor: SensorConfig = {
  bus: 1,
};
