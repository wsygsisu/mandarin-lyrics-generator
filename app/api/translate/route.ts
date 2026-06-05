import { Mistral } from "@mistralai/mistralai";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

let _mistral: Mistral | null = null;
const getMistral = () => {
  if (!_mistral) _mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });
  return _mistral;
};

const SINGLISH_PROMPT = `You are an expert in Singlish — the unique creole spoken in Singapore that mixes English with Malay, Hokkien, Cantonese, and Tamil words.

Translate the given Chinese song lyrics into Singlish. Keep the poetic and emotional feel of the original, but express it in authentic Singlish style:

- Use Singlish particles naturally: lah, lor, leh, meh, hor, ah, sia, one, what
- Sprinkle in Malay/Hokkien words where they fit: shiok, bojio, sian, walao, aiyo, paiseh, steady, confirm
- Keep the sentence rhythm loose and natural, like how Singaporeans actually talk/sing
- Preserve the emotional meaning — heartbreak, longing, joy should still come through
- Make it sound like a real Singaporean song, not a parody

Return only the translated lyrics, no explanation.`;

export async function POST(req: NextRequest) {
  try {
    const { lyrics } = await req.json();
    if (!lyrics?.trim()) {
      return Response.json({ error: "No lyrics provided" }, { status: 400 });
    }
    if (!process.env.MISTRAL_API_KEY) {
      return Response.json({ error: "MISTRAL_API_KEY is not configured" }, { status: 500 });
    }

    const result = await getMistral().chat.complete({
      model: "mistral-small-latest",
      messages: [
        { role: "system", content: SINGLISH_PROMPT },
        { role: "user", content: lyrics.trim() },
      ],
    });

    const raw = result.choices?.[0]?.message?.content ?? "";
    // SDK v2 can return string or ContentChunk[] — handle both
    const translated = typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.map((c: { type: string; text?: string }) => c.text ?? "").join("")
        : "";

    if (!translated) {
      return Response.json({ error: "Mistral returned empty response" }, { status: 500 });
    }
    return Response.json({ singlish: translated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
