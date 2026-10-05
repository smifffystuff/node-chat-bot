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
  red-led.ts            red_led: switch the LED on GPIO 14 on/off, or check it
  index.ts              List of tools passed to Claude
lib/gpio.ts             readPin/writePin helpers (uses Raspberry Pi's pinctrl)
lib/types.ts            Types shared by the UI and the API route
```

1. The page sends the conversation so far (text only) to `POST /api/chat`.
2. The route uses the SDK's **tool runner** (`client.beta.messages.toolRunner`) with streaming on. The runner sends the request to Claude, runs any tool Claude asks for, sends the result back, and repeats until Claude gives a final answer.
3. The route streams events back to the page as newline-delimited JSON, one object per line:
   - `{"type":"text","text":"..."}`: a piece of the reply
   - `{"type":"tool","name":"add_numbers","input":{...}}`: Claude called a tool
   - `{"type":"error","error":"..."}`: something went wrong
4. The page appends text to the reply bubble as it arrives and shows each tool call as a 🔧 badge.

### Model settings

Set in `app/api/chat/route.ts`:

- **Model:** `claude-opus-5-5`, with `effort: "medium"`. For a cheaper, faster bot, switch to `claude-sonnet-5-5`.
- **Refusal fallback:** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If a safety check declines a request, the API retries it on a fallback model.
- **System prompt:** `SYSTEM_PROMPT` in the same file.

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
- **Hardware access:** `run()` runs on the server (the Pi), so it can use any Node library, such as an I2C package. For simple GPIO, use `readPin` / `writePin` from `lib/gpio.ts`, as `red-led.ts` does. They call Raspberry Pi's `pinctrl` tool, so the user running the app must be in the `gpio` group.
- **Errors:** to report a failure, throw an error inside `run()`. Claude gets the error message and can tell the user.

## Limitations

- **No saved history:** the conversation lives only in the browser tab and is lost on reload.
- **Text-only history:** earlier turns are sent back to Claude as text only. Earlier tool calls and their results aren't included.
- **No authentication:** anyone on your network who can reach the Pi can use the bot, and your API credits. Don't expose it to the internet as-is.
