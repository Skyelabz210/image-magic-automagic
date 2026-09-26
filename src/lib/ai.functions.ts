import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image: z.string().startsWith("data:image/").max(3_000_000),
  metrics: z.record(z.string(), z.union([z.string(), z.number()])),
});

export type AiSuggestion = {
  threshold: number | null;
  strength: number | null;
  summary: string;
  observations: string[];
};

const PROMPT = `You are an image-forensics assistant inside ENHANCE!, a browser image enhancement tool.
Tools: entropy enhancement (threshold 0–6.3 bits selects pixels whose 9x9 Shannon entropy is at or above it; strength 1–3 sharpens luminance on selected pixels), KELD band map, lane-comb unit-step probe, and 16x16 quantization fingerprint (GCD) probe.
Look at the image and the measurements, then reply with ONLY a JSON object:
{"threshold": number, "strength": number, "summary": string (max 2 sentences), "observations": string[] (2-4 short bullets about what is visible, likely compression/editing traces, and which probe to check next)}.
Be concrete and cautious; never claim tampering as fact.`;

export const suggestSettings = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }): Promise<AiSuggestion> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this app.");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
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
              { type: "input_text", text: `${PROMPT}\n\nMeasurements: ${JSON.stringify(data.metrics)}` },
              { type: "input_image", image_url: data.image },
            ],
          },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      console.error(`AI request failed [${res.status}]: ${body}`);
      if (res.status === 429) throw new Error("AI is busy right now. Please try again in a minute.");
      if (res.status === 402) throw new Error("AI credits are used up for this workspace. Add credits to continue.");
      let msg = "";
      try { msg = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? ""; } catch { /* ignore */ }
      throw new Error(`AI request failed (${res.status})${msg ? `: ${msg}` : ""}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          if (ev.type === "error" || ev.type === "response.failed")
            throw new Error(ev.error?.message ?? ev.response?.error?.message ?? "AI request failed.");
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { threshold: null, strength: null, summary: text.trim() || "No suggestion returned.", observations: [] };
    try {
      const j = JSON.parse(match[0]);
      const num = (v: unknown, lo: number, hi: number) =>
        typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : null;
      return {
        threshold: num(j.threshold, 0, 6.3),
        strength: num(j.strength, 1, 3),
        summary: String(j.summary ?? ""),
        observations: Array.isArray(j.observations) ? j.observations.map(String).slice(0, 4) : [],
      };
    } catch {
      return { threshold: null, strength: null, summary: text.trim(), observations: [] };
    }
  });
