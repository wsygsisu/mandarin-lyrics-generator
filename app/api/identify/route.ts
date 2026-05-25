import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

export const maxDuration = 120;

const IS_VERCEL = process.env.VERCEL === "1";
const YTDLP = process.env.YTDLP_PATH ?? "/Users/meercat/anaconda3/bin/yt-dlp";
const NODE = "/usr/local/bin/node";
const PYTHON = "/Users/meercat/anaconda3/bin/python3";
const FFMPEG = "/Users/meercat/anaconda3/lib/python3.10/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1";
const IDENTIFY_SCRIPT = join(process.cwd(), "scripts/identify.py");

// Parse "1:00", "01:20", "1:00:00" → "00:01:00"
function toHMS(t: string): string {
  const parts = t.trim().split(":").map((p) => p.padStart(2, "0"));
  if (parts.length === 2) return `00:${parts[0]}:${parts[1]}`;
  if (parts.length === 3) return parts.join(":");
  // bare seconds
  const secs = parseInt(t, 10);
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `00:${m}:${s}`;
}

async function downloadClip(url: string, start: string, end: string): Promise<string> {
  const outTemplate = join(tmpdir(), `clip-${Date.now()}.%(ext)s`);

  const filePath = await new Promise<string>((resolve, reject) => {
    const proc = spawn(YTDLP, [
      url,
      "--download-sections", `*${start}-${end}`,
      "--format", "bestaudio",
      "--no-playlist",
      "--js-runtimes", `node:${NODE}`,
      "-x", "--audio-format", "mp3",
      "--ffmpeg-location", FFMPEG,
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
      else reject(new Error(stderr || `yt-dlp exited with code ${code}`));
    });
  });

  return filePath;
}

async function runIdentify(audioPath: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [IDENTIFY_SCRIPT, audioPath]);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(stderr || "Failed to parse identify output"));
      }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    if (IS_VERCEL) {
      return Response.json({ error: "Music identification is only supported when running locally. This feature requires yt-dlp and Python which are not available on the server." }, { status: 400 });
    }

    const { url, startTime, endTime } = await req.json();

    if (!url || !startTime || !endTime) {
      return Response.json({ error: "url, startTime and endTime are required" }, { status: 400 });
    }

    const start = toHMS(startTime);
    const end = toHMS(endTime);
    const clipPath = await downloadClip(url, start, end);

    try {
      const result = await runIdentify(clipPath);
      return Response.json(result);
    } finally {
      await unlink(clipPath).catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
