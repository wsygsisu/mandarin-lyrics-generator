import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, unlink } from "fs/promises";
import { parseBuffer } from "music-metadata";

export const maxDuration = 120;

const openai = new OpenAI();
const anthropic = new Anthropic();

const YTDLP = process.env.YTDLP_PATH ?? "/Users/meercat/anaconda3/bin/yt-dlp";
const YOUTUBE_SUPPORTED = !!process.env.YTDLP_PATH || process.platform !== "linux";
const NODE = "/usr/local/bin/node";

const AUDIO_MIME: Record<string, string> = {
  webm: "audio/webm",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

// ── YouTube helpers ──────────────────────────────────────────────────────────

interface YTMeta {
  title: string;
  description: string;
  channel: string;
  tags: string[];
}

async function getYouTubeMeta(url: string): Promise<YTMeta> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      url,
      "--no-download",
      "--dump-json",
      "--js-runtimes", `node:${NODE}`,
      "--quiet",
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) { reject(new Error(stderr || `yt-dlp exit ${code}`)); return; }
      try {
        const data = JSON.parse(stdout.trim());
        resolve({
          title: data.title ?? "",
          description: String(data.description ?? "").slice(0, 800),
          channel: data.channel ?? data.uploader ?? "",
          tags: data.tags ?? [],
        });
      } catch {
        reject(new Error("Failed to parse yt-dlp metadata"));
      }
    });
  });
}

async function downloadYouTubeAudio(url: string): Promise<{ file: File; title: string; channel: string }> {
  const outTemplate = join(tmpdir(), `yt-${Date.now()}.%(ext)s`);
  const { title, channel } = await getYouTubeMeta(url);

  const filePath = await new Promise<string>((resolve, reject) => {
    const proc = spawn(YTDLP, [
      url,
      "--format", "bestaudio",
      "--no-playlist",
      "--js-runtimes", `node:${NODE}`,
      "--print", "after_move:filepath",
      "-o", outTemplate,
      "--quiet",
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      const path = stdout.trim();
      if (code === 0 && path) resolve(path);
      else reject(new Error(stderr || `yt-dlp exit ${code}`));
    });
  });

  const buffer = await readFile(filePath);
  await unlink(filePath).catch(() => {});
  const ext = filePath.split(".").pop() || "webm";
  return { file: new File([buffer], `audio.${ext}`, { type: AUDIO_MIME[ext] ?? "audio/webm" }), title, channel };
}

// ── Classical identification ─────────────────────────────────────────────────

export interface ClassicalInfo {
  composer: string;
  piece: string;
  opus: string;
  key: string;
  period: string;
  performers: string;
  conductor: string;
  year: string;
  movements: string[];
  description: string;
}

async function identifyClassical(meta: {
  ytTitle?: string; ytDescription?: string; ytChannel?: string; ytTags?: string[];
  fileTitle?: string; fileAlbum?: string; fileArtist?: string; fileComposer?: string;
}): Promise<ClassicalInfo> {
  const lines: string[] = [];
  if (meta.ytTitle) lines.push(`YouTube title: "${meta.ytTitle}"`);
  if (meta.ytChannel) lines.push(`YouTube channel: "${meta.ytChannel}"`);
  if (meta.ytDescription) lines.push(`YouTube description:\n${meta.ytDescription}`);
  if (meta.ytTags?.length) lines.push(`YouTube tags: ${meta.ytTags.join(", ")}`);
  if (meta.fileComposer) lines.push(`File composer tag: "${meta.fileComposer}"`);
  if (meta.fileTitle) lines.push(`File title tag: "${meta.fileTitle}"`);
  if (meta.fileAlbum) lines.push(`File album tag: "${meta.fileAlbum}"`);
  if (meta.fileArtist) lines.push(`File artist tag: "${meta.fileArtist}"`);

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `You are a classical music expert. Identify the musical piece from the metadata below and return structured information.

${lines.join("\n")}

Return valid JSON only — no markdown, no extra text:
{
  "composer": "full composer name",
  "piece": "full piece name",
  "opus": "opus/catalogue number e.g. Op. 67, BWV 565, K. 525 — empty string if none",
  "key": "key e.g. C minor — empty string if none",
  "period": "one of: Medieval, Renaissance, Baroque, Classical, Romantic, Impressionist, Modern, Contemporary",
  "performers": "performer(s) name — empty string if unknown",
  "conductor": "conductor name — empty string if not applicable",
  "year": "year composed e.g. 1808 — empty string if unknown",
  "movements": ["movement names as array — empty array if not applicable"],
  "description": "2-3 sentence description of the piece for a general audience"
}`,
    }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("No response from Claude");

  try {
    return JSON.parse(block.text.trim()) as ClassicalInfo;
  } catch {
    throw new Error("Failed to parse Claude response");
  }
}

// ── Lyrics cleanup ───────────────────────────────────────────────────────────

interface LyricsResult {
  songName: string;
  singerName: string;
  lyrics: string;
}

async function cleanAndExtractMeta(
  rawText: string,
  context: { title?: string; channel?: string; fileTitle?: string; fileArtist?: string }
): Promise<LyricsResult> {
  const ctxLines: string[] = [];
  if (context.title) ctxLines.push(`YouTube title: "${context.title}"`);
  if (context.channel) ctxLines.push(`YouTube channel: "${context.channel}"`);
  if (context.fileTitle) ctxLines.push(`Audio file title tag: "${context.fileTitle}"`);
  if (context.fileArtist) ctxLines.push(`Audio file artist tag: "${context.fileArtist}"`);

  const ctxBlock = ctxLines.length ? `\nAvailable metadata:\n${ctxLines.join("\n")}` : "";

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `You are given a raw audio transcription of a Chinese song.${ctxBlock}

Tasks:
1. Identify the song name — use metadata if available, otherwise infer from transcription
2. Identify the singer/artist name — use metadata if available
3. Clean the transcription: strip credits, cast lists (演唱, 编剧, 主演, show titles, etc.), and non-lyric content. Format actual lyrics with one natural phrase per line.

Respond with valid JSON only — no markdown:
{
  "songName": "song name or empty string",
  "singerName": "artist name or empty string",
  "lyrics": "cleaned lyrics here"
}

Raw transcription:
${rawText}`,
    }],
  });

  const block = response.content[0];
  if (block.type !== "text") return { lyrics: rawText, songName: "", singerName: "" };
  try {
    const parsed = JSON.parse(block.text.trim());
    return { lyrics: parsed.lyrics ?? rawText, songName: parsed.songName ?? "", singerName: parsed.singerName ?? "" };
  } catch {
    return { lyrics: block.text.trim(), songName: "", singerName: "" };
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  try {
    const isFormData = contentType.includes("multipart/form-data");
    const body = isFormData ? null : await req.json();
    const mode: "lyrics" | "classical" = (body?.mode) ?? "lyrics";
    const url: string | undefined = body?.url;

    // ── Classical mode ──────────────────────────────────────────────────────
    if (mode === "classical") {
      if (url && isYouTubeUrl(url)) {
        if (!YOUTUBE_SUPPORTED) {
          return Response.json({ error: "YouTube links are only supported when running locally. Please upload an audio file instead." }, { status: 400 });
        }
        const meta = await getYouTubeMeta(url);
        const info = await identifyClassical({
          ytTitle: meta.title, ytDescription: meta.description,
          ytChannel: meta.channel, ytTags: meta.tags,
        });
        return Response.json({ type: "classical", ...info });
      }

      if (isFormData) {
        const formData = await req.formData();
        const file = formData.get("audio") as File | null;
        if (!file) return new Response("No file provided", { status: 400 });
        const buf = Buffer.from(await file.arrayBuffer());
        const meta = await parseBuffer(buf, { mimeType: file.type }).catch(() => null);
        const info = await identifyClassical({
          fileComposer: meta?.common.composer,
          fileTitle: meta?.common.title,
          fileAlbum: meta?.common.album,
          fileArtist: meta?.common.artist,
        });
        return Response.json({ type: "classical", ...info });
      }

      return new Response("Unsupported source for classical mode", { status: 400 });
    }

    // ── Lyrics mode ─────────────────────────────────────────────────────────
    let audioFile: File;
    let metaCtx: Parameters<typeof cleanAndExtractMeta>[1] = {};

    if (isFormData) {
      const formData = await req.formData();
      const file = formData.get("audio") as File | null;
      if (!file) return new Response("No audio file provided", { status: 400 });
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const meta = await parseBuffer(buf, { mimeType: file.type });
        metaCtx = { fileTitle: meta.common.title, fileArtist: meta.common.artist };
        audioFile = new File([buf], file.name, { type: file.type });
      } catch {
        audioFile = file;
      }
    } else if (url) {
      if (isYouTubeUrl(url)) {
        if (!YOUTUBE_SUPPORTED) {
          return Response.json({ error: "YouTube links are only supported when running locally. Please upload an audio file instead." }, { status: 400 });
        }
        const result = await downloadYouTubeAudio(url);
        audioFile = result.file;
        metaCtx = { title: result.title, channel: result.channel };
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const ext = url.split(".").pop()?.split("?")[0] || "mp3";
        audioFile = new File([arrayBuffer], `audio.${ext}`, { type: res.headers.get("content-type") || "audio/mpeg" });
      }
    } else {
      return new Response("No audio provided", { status: 400 });
    }

    const rawTranscription = await openai.audio.transcriptions.create({
      file: audioFile, model: "whisper-1", language: "zh", response_format: "text",
    });

    const result = await cleanAndExtractMeta(rawTranscription as unknown as string, metaCtx);
    return Response.json({ type: "lyrics", ...result });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
