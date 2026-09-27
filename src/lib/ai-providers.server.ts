import type { AiSuggestion } from "./ai.functions";

export type AiProvider = "lovable" | "gemini";
const PROMPT = `You are an image-forensics assistant inside ENHANCE!. Tools: entropy enhancement (threshold 0–6.3 bits selects pixels by 9x9 Shannon entropy; strength 1–3 sharpens selected luminance), KELD band map, lane-comb unit-step probe and 16x16 quantization fingerprint (GCD) probe. Look at the image and measurements, then reply ONLY as JSON: {"threshold":number,"strength":number,"summary":string,"observations":string[]}. Give 2–4 short observations and suggest which probe to check next. Be concrete and cautious; never claim tampering as fact.`;

function normalize(text: string): AiSuggestion {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned no usable settings. Please try again.");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(match[0]);
  } catch {
    throw new Error("AI returned invalid settings. Please try again.");
  }
  const number = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.round(Math.max(lo, Math.min(hi, v)) * 10) / 10
      : null;
  return {
    threshold: number(value["threshold"], 0, 6.3),
    strength: number(value["strength"], 1, 3),
    summary:
      typeof value["summary"] === "string"
        ? value["summary"].slice(0, 600)
        : "No summary returned.",
    observations: Array.isArray(value["observations"])
      ? value["observations"]
          .filter((x): x is string => typeof x === "string")
          .slice(0, 4)
          .map((x) => x.slice(0, 300))
      : [],
  };
}

export async function requestSuggestion(
  input: {
    provider: AiProvider;
    image: string;
    metrics: Record<string, string | number>;
  },
  dependencies: { env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch } = {},
): Promise<AiSuggestion> {
  const env = dependencies.env ?? process.env;
  const fetcher = dependencies.fetch ?? fetch;
  const key = input.provider === "gemini" ? env["GEMINI_API_KEY"] : env["LOVABLE_API_KEY"];
  if (!key)
    throw new Error(
      `${input.provider === "gemini" ? "Gemini" : "Lovable"} AI is not configured on the server.`,
    );
  const prompt = `${PROMPT}\n\nMeasurements: ${JSON.stringify(input.metrics)}`;
  const image = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
  if (!image || input.image.length > 3_000_000)
    throw new Error("Use a small JPEG, PNG, or WebP preview.");

  if (input.provider === "gemini") {
    const model = env["GEMINI_MODEL"] ?? "gemini-3.8-flash";
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("Invalid Gemini model name.");
    const res = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { type: "text", text: prompt },
          { type: "image", data: image[2], mime_type: image[1] },
        ],
        response_format: { type: "text", mime_type: "application/json" },
      }),
    });
    if (!res.ok) throw providerError(res.status, "Gemini");
    const result = await res.json();
    if (result.status !== "completed") throw new Error("Gemini did not finish its analysis.");
    const output = result.steps
      ?.filter((step: { type: string }) => step.type === "model_output")
      .flatMap((step: { content?: { type: string; text?: string }[] }) => step.content ?? [])
      .filter((part: { type: string }) => part.type === "text")
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
    return normalize(output ?? "");
  }

  const res = await fetcher("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: input.image },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw providerError(res.status, "Lovable");
  const events = await res.text();
  let output = "";
  for (const line of events.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.output_text.delta") output += event.delta ?? "";
      if (event.type === "error" || event.type === "response.failed")
        throw new Error("Lovable AI could not complete the analysis.");
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return normalize(output);
}

function providerError(status: number, provider: string) {
  if (status === 429) return new Error(`${provider} is busy. Try again in a minute.`);
  if (status === 401 || status === 403)
    return new Error(`${provider} credentials were rejected. Check the server secret.`);
  if (status === 402) return new Error(`${provider} credits are used up.`);
  return new Error(`${provider} request failed (${status}).`);
}
