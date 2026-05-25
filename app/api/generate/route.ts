import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Lazy-initialised so the build phase never instantiates without API keys
let _client: Anthropic | null = null;
const getClient = () => { if (!_client) _client = new Anthropic(); return _client; };

const SYSTEM_PROMPT = `你是一位才华横溢的中文歌词作者，精通各种音乐风格，深谙中国诗词之美。你能创作出情感真挚、意境深远、朗朗上口的现代中文歌词。

请根据用户的要求创作完整的中文歌词（简体中文），包含以下结构：

【主歌一】
（4-6行，引入故事或情感背景）

【副歌】
（4-6行，情感高潮，朗朗上口，是整首歌的核心）

【主歌二】
（4-6行，深化故事或情感转折）

【副歌】
（重复）

【桥段】
（4-6行，情感升华或强烈对比，为最后副歌蓄力）

【副歌】
（重复，可略作变化）

创作要求：
- 只使用简体中文，不混入英文
- 押韵自然流畅，不强求生硬押韵
- 意象生动具体，避免空洞表达
- 节奏感强，适合演唱
- 情感真实细腻
- 词汇优美，兼顾现代感与诗意`;

export async function POST(req: NextRequest) {
  const { theme, genre, mood, customPrompt } = await req.json();

  const parts: string[] = ["请根据以下要求创作一首完整的中文歌词："];
  if (theme) parts.push(`主题：${theme}`);
  if (genre) parts.push(`风格：${genre}`);
  if (mood) parts.push(`情感基调：${mood}`);
  if (customPrompt) parts.push(`特别要求：${customPrompt}`);

  const userMessage = parts.join("\n");

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        const stream = getClient().messages.stream({
          model: "claude-opus-4-7",
          max_tokens: 4096,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          thinking: { type: "adaptive" } as any,
          output_config: { effort: "high" } as any,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "未知错误";
        controller.enqueue(encoder.encode(`\n\n[错误: ${message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
