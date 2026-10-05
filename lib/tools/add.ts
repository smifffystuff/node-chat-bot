import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const addNumbers = {
  ...betaZodTool({
    name: "add_numbers",
    description: "Add two numbers together and return the sum.",
    inputSchema: z.object({
      a: z.number().describe("The first number"),
      b: z.number().describe("The second number"),
    }),
    run: async ({ a, b }) => {
      return String(a + b);
    },
  }),
  // Stream tool input as it's generated; the Zod schema still validates it
  // before run() is called.
  eager_input_streaming: true,
};
