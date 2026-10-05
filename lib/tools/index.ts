import { addNumbers } from "./add";
import { led } from "./led";
import { wait } from "./wait";

// Every tool Claude can call. To add a new one (e.g. reading a GPIO pin or a
// sensor on the Pi), create a file next to add.ts and append it here.
export const tools = [addNumbers, led, wait];
