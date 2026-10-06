# node-chat-bot

A simple chatbot that runs on a Raspberry Pi 5 and talks to Claude through the Anthropic API. Replies stream in as they're written, and Claude can call **tools**, which are small functions that run on the Pi. The first tool just adds two numbers; the point is to make it easy to add tools that use the Pi's peripherals (GPIO, sensors and so on) later.

Built with Next.js (App Router), TypeScript, Tailwind CSS and the official [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Anthropic API key:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   `.env` is git-ignored. The key is only used on the server and is never sent to the browser.

## Running

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload, for use on the Pi itself (http://localhost:3000) |
| `npm run dev:lan` | Dev server reachable from other devices on your network |
| `npm run build` then `npm start` | Production build, faster on the Pi and reachable from your network |
| `npm run lint` | Run ESLint |

From a phone or another computer, open **http://raspberrypi5.local:3000**.

### Notes

- **Dev mode from other devices:** Next.js blocks dev-server requests from hosts it doesn't recognise, which leaves the page loaded but not interactive (for example, the Send button never enables). `next.config.ts` allows `192.168.*.*` and `raspberrypi5.local` through `allowedDevOrigins`. If you use a different hostname or network range, add it there. Production mode doesn't have this check.
- **Stopping `npm start`:** on Ctrl+C, production mode waits for open connections to close before it exits, so an open browser tab (often a phone) can keep it running. Close the tab, or press **Ctrl+\\** to force it to quit.

## Pull request checks and branch protection

GitHub Actions runs these checks on every pull request targeting `main`, pushes to
`main`, and manual workflow runs, using Node.js 22 LTS and `npm ci`:

- `node-chat-bot / lint` — `npm run lint`
- `node-chat-bot / typecheck` — `npx next typegen`, then `npx tsc --noEmit`
- `node-chat-bot / build` — `npm run build`

Type generation supplies Next.js route helpers such as `LayoutProps` on a clean
checkout. There is no test script yet. The build downloads Google Fonts, so it
needs network access to Google Fonts.

### Results comment

After the checks finish, a **Post results comment** job posts a summary table on
the pull request, and updates that same comment on later pushes. For each failed
check it includes the last 60 lines of error output and the command to reproduce
it locally.

If the repository secret `ANTHROPIC_API_KEY` is set, failed runs also send the
error output and the PR's diff to Claude (`claude-opus-5-5`), and its suggested
fixes are added to the comment. This only happens when a check fails, and each
call costs a few cents. Without the secret, the comment still shows the errors.
To set it (a separate key from the one in `.env` makes it easy to revoke or
limit):

```bash
gh secret set ANTHROPIC_API_KEY
```

The comment job is skipped for PRs from forks, which can't read secrets or write
comments. The logic lives in `.github/scripts/ci-report.mjs`.

### Branch protection

Branch protection is a repository setting, configured as a ruleset under
**Settings > Rules > Rulesets** targeting `main`, with:

- **Require a pull request before merging**
- **Require status checks to pass**, listing the three check names above
- **Require signed commits**
- **Restrict deletions**

Required human approvals are optional and should be left off by default for a
solo maintainer: the owner cannot approve their own pull request.

## How it works

```
app/page.tsx            Chat UI (client component)
app/api/chat/route.ts   POST /api/chat: calls Claude and streams the reply back
lib/tools/              Tools Claude can call
  add.ts                add_numbers: example tool
  led.ts                led: switch LEDs from config/leds.ts on/off, check them, or light them for N seconds
  servo.ts              servo: turn servos from config/servos.ts to an angle or by N degrees left/right
  wait.ts               wait: pause between steps (approximate timing)
  index.ts              List of tools passed to Claude
lib/gpio.ts             readPin/writePin helpers (uses Raspberry Pi's pinctrl)
lib/pwm.ts              Hardware PWM helpers (kernel sysfs interface), used for servos
config/leds.ts          LEDs wired to the Pi: name and GPIO number for each
config/servos.ts        Servos wired to the Pi: GPIO, pulse range and angle range for each
lib/types.ts            Types shared by the UI and the API route
```

1. The page sends the conversation so far to `POST /api/chat`, including Claude's earlier tool calls and their results, so Claude knows what it has actually done.
2. The route uses the SDK's **tool runner** (`client.beta.messages.toolRunner`) with streaming on. The runner sends the request to Claude, runs any tool Claude asks for, sends the result back, and repeats until Claude gives a final answer.
3. The route streams events back to the page as newline-delimited JSON, one object per line:
   - `{"type":"text","text":"..."}`: a piece of the reply
   - `{"type":"tool","name":"add_numbers","input":{...}}`: Claude called a tool
   - `{"type":"error","error":"..."}`: something went wrong
   - `{"type":"history","messages":[...]}`: sent last, when the reply completed. This is the full conversation, which the page stores and sends back unchanged with the next message
4. The page appends text to the reply bubble as it arrives and shows each tool call as a 🔧 badge.

### Model settings

Set in `app/api/chat/route.ts`:

- **Model:** `claude-opus-5-5`, with `effort: "medium"`. For a cheaper, faster bot, switch to `claude-sonnet-5-5`.
- **Refusal fallback:** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If a safety check declines a request, the API retries it on a fallback model.
- **System prompt:** `SYSTEM_PROMPT` in the same file.

## Adding an LED

Wire the LED to a free GPIO pin (with a resistor), then add a line to `config/leds.ts`:

```ts
export const leds = [
  { name: "red", gpio: 14 },
  { name: "blue", gpio: 15 },
  { name: "green", gpio: 23 },
  { name: "yellow", gpio: 18, description: "on the front panel" },
] as const satisfies readonly LedConfig[];
```

`name` is what you call it in chat ("turn the yellow LED on"); use lowercase with no spaces. `gpio` is the BCM GPIO number, not the physical pin number on the header. `description` is optional extra detail for Claude. `npm run dev` picks the change up automatically; for production, rebuild and restart (`npm run build && npm start`). Mistakes such as a duplicate name or two LEDs on the same GPIO are reported as soon as the app builds or starts, so the CI build check catches them too.

## Wiring a servo

A hobby servo (SG90, MG90S and similar) has three wires:

| Wire | Connect to |
| --- | --- |
| Orange (or yellow/white): signal | GPIO 18 (physical pin 12) |
| Red: power | 5V (physical pin 2 or 4) |
| Brown (or black): ground | GND (physical pin 6, or any GND pin) |

The signal pin must be a hardware PWM pin: GPIO 12, 13, 18 or 19. Software PWM makes servos jitter. These pins use the Pi 5's PWM0 controller, which is off by default, so turn it on once and reboot:

```bash
echo "dtoverlay=pwm,pin=18,func=2" | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

The overlay enables PWM0 for all four pins; the app switches whichever pin it uses to PWM itself. A small servo like an SG90 can run from the Pi's 5V pin. For anything bigger, or several servos, use a separate 5V supply and connect its ground to the Pi's ground, otherwise current spikes can reset the Pi.

The servo is set up in `config/servos.ts`. You can then say things like "turn to 45 degrees", "rotate 30 degrees to the left", "centre the servo" or "where is the servo pointing?". 0 degrees is fully right and 180 is fully left. If "left" turns it the wrong way, set `reversed: true`. If it buzzes or strains at either end, move `minPulseUs` and `maxPulseUs` inwards (for example 600 and 2400). A servo holds its position, and may hum, until you ask Claude to release it.

## Adding a tool

1. Create a file in `lib/tools/`, using `add.ts` as a template:

   ```ts
   import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
   import { z } from "zod";

   export const readTemperature = {
     ...betaZodTool({
       name: "read_temperature",
       description: "Read the current temperature from the sensor, in Celsius.",
       inputSchema: z.object({}),
       run: async () => {
         // Talk to the hardware here and return the result as a string.
         return "21.5";
       },
     }),
     eager_input_streaming: true,
   };
   ```

2. Add it to the list in `lib/tools/index.ts`:

   ```ts
   export const tools = [addNumbers, readTemperature];
   ```

That's it. The tool runner handles the rest. Some tips:

- **Descriptions:** Claude decides when to use a tool from its `description`, so say clearly what it does and what it returns.
- **Input checking:** inputs are checked against the Zod schema before `run()` is called, so `run()` always gets correctly typed values.
- **Hardware access:** `run()` runs on the server (the Pi), so it can use any Node library, such as an I2C package. For simple GPIO, use `readPin` / `writePin` from `lib/gpio.ts`, as `led.ts` does. They call Raspberry Pi's `pinctrl` tool, so the user running the app must be in the `gpio` group.
- **Errors:** to report a failure, throw an error inside `run()`. Claude gets the error message and can tell the user.
- **Timing:** Claude makes one tool call per step (`disable_parallel_tool_use` in `route.ts`), so steps run in order. Time between steps includes Claude deciding what to do next, typically 1-3 seconds. If something must be timed precisely, such as "on for 1 second", do the timing inside a single `run()`, as the `led` tool's `duration_seconds` does.

## Limitations

- **No saved history:** the conversation lives only in the browser tab and is lost on reload.
- **No authentication:** anyone on your network who can reach the Pi can use the bot, and your API credits. Don't expose it to the internet as-is.
