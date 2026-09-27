import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestSuggestion } from "./ai-providers.server";

const Input = z.object({
  image: z
    .string()
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(3_000_000),
  metrics: z.record(z.string(), z.union([z.string(), z.number()])),
  provider: z.enum(["lovable", "gemini"]),
});

export type AiSuggestion = {
  threshold: number | null;
  strength: number | null;
  summary: string;
  observations: string[];
};

export const suggestSettings = createServerFn({ method: "POST" })
  .validator((d) => Input.parse(d))
  .handler(async ({ data }): Promise<AiSuggestion> => requestSuggestion(data));
