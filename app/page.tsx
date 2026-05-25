"use client";

import { useState, useRef, useEffect } from "react";
import type { ClassicalInfo } from "./api/transcribe/route";

const GENRES = [
  { value: "流行", label: "流行 Pop" },
  { value: "R&B", label: "R&B" },
  { value: "民谣", label: "民谣 Folk" },
  { value: "摇滚", label: "摇滚 Rock" },
  { value: "古风", label: "古风 Classical" },
  { value: "抒情", label: "抒情 Ballad" },
  { value: "电子", label: "电子 Electronic" },
  { value: "嘻哈", label: "嘻哈 Hip-hop" },
];

const MOODS = [
  { value: "快乐", label: "快乐 Happy" },
  { value: "忧伤", label: "忧伤 Sad" },
  { value: "激情", label: "激情 Passionate" },
  { value: "平静", label: "平静 Calm" },
  { value: "思念", label: "思念 Nostalgic" },
  { value: "浪漫", label: "浪漫 Romantic" },
  { value: "孤独", label: "孤独 Lonely" },
  { value: "希望", label: "希望 Hopeful" },
];

const STORAGE_KEY = "mandarin-lyrics-history";

interface HistoryEntry {
  id: string;
  type: "upload" | "generate";
  timestamp: number;
  // lyrics entries
  lyrics?: string;
  songName?: string;
  singerName?: string;
  source?: string;
  theme?: string;
  genre?: string;
  mood?: string;
  // classical entries
  classical?: ClassicalInfo;
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveHistory(h: HistoryEntry[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); }

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + ` ${time}`;
}

function LyricsDisplay({ text }: { text: string }) {
  return (
    <div className="space-y-1 font-mono text-sm leading-relaxed">
      {text.split("\n").map((line, i) => (
        <div key={i} className={/【.*?】/.test(line) ? "text-amber-400 font-semibold mt-5 first:mt-0 tracking-widest text-xs" : "text-white/90"}>
          {line || " "}
        </div>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-white/30 text-xs uppercase tracking-widest">{label}</span>
      <span className="text-white/85 text-sm">{value}</span>
    </div>
  );
}

function ClassicalDisplay({ info }: { info: ClassicalInfo }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-bold text-white leading-tight">{info.piece || "Unknown piece"}</h3>
        {info.opus && <p className="text-amber-400/70 text-sm mt-1">{info.opus}</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <InfoRow label="作曲家 Composer" value={info.composer} />
        <InfoRow label="时期 Period" value={info.period} />
        <InfoRow label="调性 Key" value={info.key} />
        <InfoRow label="年份 Year" value={info.year} />
        {info.performers && <div className="col-span-2"><InfoRow label="演奏者 Performers" value={info.performers} /></div>}
        {info.conductor && <div className="col-span-2"><InfoRow label="指挥 Conductor" value={info.conductor} /></div>}
      </div>

      {info.movements?.length > 0 && (
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest mb-2">乐章 Movements</p>
          <div className="space-y-1.5">
            {info.movements.map((m, i) => (
              <p key={i} className="text-white/70 text-sm">{m}</p>
            ))}
          </div>
        </div>
      )}

      {info.description && (
        <p className="text-white/50 text-sm leading-relaxed border-t border-white/10 pt-4">
          {info.description}
        </p>
      )}
    </div>
  );
}

function classicalToText(info: ClassicalInfo): string {
  const lines = [info.piece, info.opus, "", `作曲家: ${info.composer}`, `时期: ${info.period}`, `调性: ${info.key}`, `年份: ${info.year}`];
  if (info.performers) lines.push(`演奏者: ${info.performers}`);
  if (info.conductor) lines.push(`指挥: ${info.conductor}`);
  if (info.movements?.length) { lines.push("", "乐章:", ...info.movements.map((m) => `  ${m}`)); }
  if (info.description) lines.push("", info.description);
  return lines.filter((l) => l !== undefined).join("\n");
}

interface IdentifyResult {
  title?: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  genre?: string;
  coverArt?: string;
  error?: string;
}

type GenerateStatus = "idle" | "thinking" | "generating" | "done" | "error";
type UploadStatus = "idle" | "uploading" | "done" | "error";
type IdentifyStatus = "idle" | "loading" | "done" | "error";
type Tab = "upload" | "generate" | "identify" | "history";
type UploadMode = "file" | "link";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [uploadMode, setUploadMode] = useState<UploadMode>("file");
  const [classicalMode, setClassicalMode] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Upload state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [songUrl, setSongUrl] = useState("");
  const [transcription, setTranscription] = useState("");
  const [classicalResult, setClassicalResult] = useState<ClassicalInfo | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared metadata
  const [songName, setSongName] = useState("");
  const [singerName, setSingerName] = useState("");

  // Generate state
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>("idle");
  const [copied, setCopied] = useState(false);

  // Identify state
  const [identifyUrl, setIdentifyUrl] = useState("");
  const [identifyStart, setIdentifyStart] = useState("");
  const [identifyEnd, setIdentifyEnd] = useState("");
  const [identifyResult, setIdentifyResult] = useState<IdentifyResult | null>(null);
  const [identifyStatus, setIdentifyStatus] = useState<IdentifyStatus>("idle");

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hasReceivedText = useRef(false);
  const lyricsRef = useRef<HTMLDivElement>(null);

  const isGenerating = generateStatus === "thinking" || generateStatus === "generating";

  useEffect(() => { setHistory(loadHistory()); }, []);
  useEffect(() => {
    if (lyricsRef.current) lyricsRef.current.scrollTop = lyricsRef.current.scrollHeight;
  }, [lyrics]);

  const addToHistory = (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    const newEntry: HistoryEntry = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    setHistory((prev) => { const u = [newEntry, ...prev]; saveHistory(u); return u; });
  };

  const deleteEntry = (id: string) => {
    setHistory((prev) => { const u = prev.filter((e) => e.id !== id); saveHistory(u); return u; });
    if (selectedEntry?.id === id) setSelectedEntry(null);
  };

  // ── Upload ──────────────────────────────────────────────────────────────────
  const handleFileSelect = (file: File) => { setAudioFile(file); setTranscription(""); setClassicalResult(null); setUploadStatus("idle"); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) handleFileSelect(file);
  };

  const transcribe = async () => {
    setUploadStatus("uploading");
    setTranscription(""); setClassicalResult(null); setSongName(""); setSingerName("");

    try {
      let res: Response;
      if (uploadMode === "file" && audioFile) {
        const formData = new FormData();
        formData.append("audio", audioFile);
        if (classicalMode) formData.append("mode", "classical");
        res = await fetch("/api/transcribe", { method: "POST", body: formData });
      } else if (uploadMode === "link" && songUrl.trim()) {
        res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: songUrl.trim(), mode: classicalMode ? "classical" : "lyrics" }),
        });
      } else { setUploadStatus("idle"); return; }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Unknown error");

      if (json.type === "classical") {
        setClassicalResult(json as ClassicalInfo);
        addToHistory({ type: "upload", classical: json as ClassicalInfo, source: uploadMode === "link" ? songUrl.trim() : audioFile?.name });
      } else {
        setTranscription(json.lyrics ?? "");
        setSongName(json.songName ?? "");
        setSingerName(json.singerName ?? "");
        addToHistory({ type: "upload", lyrics: json.lyrics, songName: json.songName, singerName: json.singerName, source: uploadMode === "link" ? songUrl.trim() : audioFile?.name });
      }
      setUploadStatus("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setTranscription(`[错误: ${message}]`);
      setUploadStatus("error");
    }
  };

  // ── Generate ────────────────────────────────────────────────────────────────
  const generate = async () => {
    if (isGenerating) { abortRef.current?.abort(); setGenerateStatus("idle"); return; }
    setLyrics(""); setGenerateStatus("thinking");
    hasReceivedText.current = false;
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, genre, mood, customPrompt }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (!hasReceivedText.current && text.trim()) { hasReceivedText.current = true; setGenerateStatus("generating"); }
        fullText += text;
        setLyrics(fullText);
      }
      if (fullText.trim()) {
        setGenerateStatus("done");
        addToHistory({ type: "generate", lyrics: fullText, songName, singerName, theme, genre, mood });
      } else {
        setGenerateStatus("error");
        setLyrics("[错误: 没有收到内容，请检查 API 密钥设置]");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setGenerateStatus("error");
      setLyrics(`[错误: ${message}]`);
    }
  };

  // ── Identify ────────────────────────────────────────────────────────────────
  const identify = async () => {
    if (!identifyUrl.trim() || !identifyStart.trim() || !identifyEnd.trim()) return;
    setIdentifyStatus("loading");
    setIdentifyResult(null);
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: identifyUrl.trim(), startTime: identifyStart.trim(), endTime: identifyEnd.trim() }),
      });
      const json: IdentifyResult = await res.json();
      setIdentifyResult(json);
      setIdentifyStatus(json.error ? "error" : "done");
    } catch (err) {
      setIdentifyResult({ error: err instanceof Error ? err.message : "Unknown error" });
      setIdentifyStatus("error");
    }
  };

  const copyText = async (text: string) => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Right panel content ─────────────────────────────────────────────────────
  const uploadHasContent = classicalResult || transcription;
  const rightPanelLyrics = activeTab === "history"
    ? (selectedEntry?.lyrics ?? "")
    : activeTab === "upload" ? transcription : lyrics;
  const rightPanelClassical = activeTab === "history" ? selectedEntry?.classical : (activeTab === "upload" ? classicalResult : null);
  const rightPanelHasContent = !!(rightPanelLyrics || rightPanelClassical);

  const copyableText = rightPanelClassical
    ? classicalToText(rightPanelClassical)
    : rightPanelLyrics;

  // History entry header labels
  const historyLabel = (e: HistoryEntry) => {
    if (e.classical) return `${e.classical.piece}${e.classical.composer ? ` — ${e.classical.composer}` : ""}`;
    return [e.songName, e.singerName].filter(Boolean).join(" — ") || (e.lyrics?.split("\n").find((l) => l.trim()) ?? "");
  };

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#0d0818" }}>
      <header className="border-b border-white/10 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <span className="text-2xl">🎵</span>
          <div>
            <h1 className="text-xl font-bold text-amber-400 tracking-wide">词曲生成器</h1>
            <p className="text-xs text-white/40 tracking-widest uppercase">Mandarin Lyrics Generator</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 rounded-xl border border-white/10 w-fit" style={{ backgroundColor: "#1a0f2e" }}>
          {(["upload", "generate", "identify", "history"] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); setEditMode(false); }}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? "bg-amber-400 text-black" : "text-white/50 hover:text-white/80"}`}>
              {tab === "upload" && "上传歌曲 Upload"}
              {tab === "generate" && "生成歌词 Generate"}
              {tab === "identify" && "识别音乐 Identify"}
              {tab === "history" && (
                <span className="flex items-center gap-1.5">
                  历史记录 History
                  {history.length > 0 && <span className="bg-white/20 text-white/70 text-xs rounded-full px-1.5 py-0.5 leading-none">{history.length}</span>}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── Left panel ── */}
          <div className="flex flex-col gap-6">

            {/* Upload tab */}
            {activeTab === "upload" && (
              <div className="rounded-2xl p-6 border border-white/10" style={{ backgroundColor: "#1a0f2e" }}>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest">音频来源</h2>
                  {/* Classical mode toggle */}
                  <button onClick={() => setClassicalMode((v) => !v)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      classicalMode ? "border-violet-400/40 bg-violet-400/10 text-violet-300" : "border-white/10 text-white/40 hover:text-white/60"
                    }`}>
                    <span className={`w-3 h-3 rounded-full border-2 transition-all ${classicalMode ? "bg-violet-400 border-violet-400" : "border-white/30"}`} />
                    古典音乐 Classical
                  </button>
                </div>

                {/* File / Link toggle */}
                <div className="flex gap-1 mb-5 p-1 rounded-lg border border-white/10 w-fit" style={{ backgroundColor: "#0d0818" }}>
                  {(["file", "link"] as UploadMode[]).map((m) => (
                    <button key={m} onClick={() => setUploadMode(m)}
                      className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${uploadMode === m ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
                      {m === "file" ? "本地文件 File" : "在线链接 Link"}
                    </button>
                  ))}
                </div>

                {uploadMode === "file" ? (
                  <>
                    <div onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${dragOver ? "border-amber-400/60 bg-amber-400/5" : "border-white/15 hover:border-white/30"}`}>
                      <div className="text-4xl mb-3 opacity-40">{classicalMode ? "🎻" : "🎵"}</div>
                      {audioFile ? (
                        <div>
                          <p className="text-white/80 text-sm font-medium">{audioFile.name}</p>
                          <p className="text-white/30 text-xs mt-1">{(audioFile.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-white/50 text-sm">拖放音频文件到这里</p>
                          <p className="text-white/25 text-xs mt-1">or click to browse · MP3, WAV, M4A, FLAC</p>
                        </div>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
                  </>
                ) : (
                  <div>
                    <input type="url" value={songUrl} onChange={(e) => setSongUrl(e.target.value)}
                      placeholder={classicalMode ? "粘贴 YouTube 链接（古典音乐）..." : "粘贴 YouTube 或音频链接..."}
                      className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                      style={{ backgroundColor: "#0d0818" }} disabled={uploadStatus === "uploading"} />
                    <p className="text-white/20 text-xs mt-2">
                      {classicalMode ? "古典模式无需下载音频，仅分析视频标题与描述" : "支持 YouTube 链接及直链音频文件"}
                    </p>
                  </div>
                )}

                {(uploadMode === "file" ? audioFile : songUrl.trim()) && (
                  <button onClick={transcribe} disabled={uploadStatus === "uploading"}
                    className={`w-full mt-4 py-3 rounded-xl font-semibold text-sm tracking-wide transition-all ${
                      uploadStatus === "uploading" ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : classicalMode ? "bg-violet-500 text-white hover:bg-violet-400 active:scale-[0.98]"
                        : "bg-amber-400 text-black hover:bg-amber-300 active:scale-[0.98]"
                    }`}>
                    {uploadStatus === "uploading" ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        {classicalMode ? "正在识别乐曲..." : "正在识别歌词..."}
                      </span>
                    ) : classicalMode ? "✦ 识别乐曲" : "✦ 识别歌词"}
                  </button>
                )}

                {/* Song/Singer fields — lyrics mode only */}
                {!classicalMode && (
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">歌名 Song name</label>
                      <input type="text" value={songName} onChange={(e) => setSongName(e.target.value)} placeholder="自动检测"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-white/15 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                        style={{ backgroundColor: "#0d0818" }} />
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">歌手 Singer</label>
                      <input type="text" value={singerName} onChange={(e) => setSingerName(e.target.value)} placeholder="自动检测"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-white/15 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                        style={{ backgroundColor: "#0d0818" }} />
                    </div>
                  </div>
                )}

                <p className="text-white/20 text-xs text-center mt-4">
                  {classicalMode ? "由 Claude 分析乐曲信息" : "由 OpenAI Whisper 提供语音识别"}
                </p>
              </div>
            )}

            {/* Generate tab */}
            {activeTab === "generate" && (
              <div className="rounded-2xl p-6 border border-white/10" style={{ backgroundColor: "#1a0f2e" }}>
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-5">创作设置</h2>

                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">歌名 <span className="text-white/30">Song name</span></label>
                    <input type="text" value={songName} onChange={(e) => setSongName(e.target.value)} placeholder="可选"
                      className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                      style={{ backgroundColor: "#0d0818" }} disabled={isGenerating} />
                  </div>
                  <div>
                    <label className="block text-sm text-white/70 mb-2">歌手 <span className="text-white/30">Singer</span></label>
                    <input type="text" value={singerName} onChange={(e) => setSingerName(e.target.value)} placeholder="可选"
                      className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                      style={{ backgroundColor: "#0d0818" }} disabled={isGenerating} />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2">主题 <span className="text-white/30">Theme</span></label>
                  <input type="text" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例：异乡思念、初恋、追梦..."
                    className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                    style={{ backgroundColor: "#0d0818" }} disabled={isGenerating} />
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2">风格 <span className="text-white/30">Genre</span></label>
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map((g) => (
                      <button key={g.value} onClick={() => setGenre(genre === g.value ? "" : g.value)} disabled={isGenerating}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${genre === g.value ? "bg-amber-400 text-black border-amber-400" : "border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"}`}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-white/70 mb-2">情感基调 <span className="text-white/30">Mood</span></label>
                  <div className="flex flex-wrap gap-2">
                    {MOODS.map((m) => (
                      <button key={m.value} onClick={() => setMood(mood === m.value ? "" : m.value)} disabled={isGenerating}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${mood === m.value ? "bg-purple-500 text-white border-purple-500" : "border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <label className="block text-sm text-white/70 mb-2">特别要求 <span className="text-white/30">Custom prompt</span></label>
                  <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="任何额外要求，例：包含具体地名、押ao韵..." rows={3}
                    className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors resize-none"
                    style={{ backgroundColor: "#0d0818" }} disabled={isGenerating} />
                </div>

                <button onClick={generate}
                  className={`w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all ${isGenerating ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30" : generateStatus === "error" ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30" : "bg-amber-400 text-black hover:bg-amber-300 active:scale-[0.98]"}`}>
                  {generateStatus === "thinking" && <span className="flex items-center justify-center gap-2"><span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />正在构思中...</span>}
                  {generateStatus === "generating" && <span className="flex items-center justify-center gap-2"><span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />正在创作...</span>}
                  {generateStatus === "error" && "✕ 生成失败，重试"}
                  {(generateStatus === "idle" || generateStatus === "done") && "✦ 生成歌词"}
                </button>
              </div>
            )}

            {/* Identify tab */}
            {activeTab === "identify" && (
              <div className="rounded-2xl p-6 border border-white/10" style={{ backgroundColor: "#1a0f2e" }}>
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-2">识别片段音乐</h2>
                <p className="text-white/25 text-xs mb-5">粘贴视频链接并指定时间范围，识别该片段正在播放的音乐</p>

                <div className="mb-4">
                  <label className="block text-xs text-white/40 mb-1.5">视频链接 Video URL</label>
                  <input type="url" value={identifyUrl} onChange={(e) => setIdentifyUrl(e.target.value)}
                    placeholder="YouTube 或其他视频链接..."
                    className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                    style={{ backgroundColor: "#0d0818" }} disabled={identifyStatus === "loading"} />
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">开始时间 Start</label>
                    <input type="text" value={identifyStart} onChange={(e) => setIdentifyStart(e.target.value)}
                      placeholder="1:00"
                      className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                      style={{ backgroundColor: "#0d0818" }} disabled={identifyStatus === "loading"} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">结束时间 End</label>
                    <input type="text" value={identifyEnd} onChange={(e) => setIdentifyEnd(e.target.value)}
                      placeholder="2:20"
                      className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 border border-white/10 focus:outline-none focus:border-amber-400/50 transition-colors"
                      style={{ backgroundColor: "#0d0818" }} disabled={identifyStatus === "loading"} />
                  </div>
                </div>

                <button onClick={identify} disabled={identifyStatus === "loading" || !identifyUrl.trim() || !identifyStart.trim() || !identifyEnd.trim()}
                  className={`w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all ${
                    identifyStatus === "loading" ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : (!identifyUrl.trim() || !identifyStart.trim() || !identifyEnd.trim()) ? "bg-white/5 text-white/20 cursor-not-allowed"
                    : "bg-amber-400 text-black hover:bg-amber-300 active:scale-[0.98]"
                  }`}>
                  {identifyStatus === "loading" ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      正在下载并识别...
                    </span>
                  ) : "✦ 识别音乐"}
                </button>

                <p className="text-white/20 text-xs text-center mt-4">由 Shazam 提供音乐识别</p>
              </div>
            )}

            {/* History tab */}
            {activeTab === "history" && (
              <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ backgroundColor: "#1a0f2e" }}>
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest">历史记录</h2>
                  {history.length > 0 && (
                    <button onClick={() => { if (confirm("清除所有历史记录？")) { setHistory([]); saveHistory([]); setSelectedEntry(null); } }}
                      className="text-xs text-white/30 hover:text-red-400 transition-colors">全部清除</button>
                  )}
                </div>

                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <div className="text-4xl opacity-20">📜</div>
                    <p className="text-white/20 text-sm">暂无记录</p>
                    <p className="text-white/10 text-xs">识别或生成歌词后自动保存</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5 max-h-[520px] overflow-y-auto">
                    {history.map((entry) => (
                      <div key={entry.id} onClick={() => setSelectedEntry(entry)}
                        className={`px-6 py-4 cursor-pointer transition-all group flex items-start justify-between gap-3 ${selectedEntry?.id === entry.id ? "bg-amber-400/10 border-l-2 border-amber-400" : "hover:bg-white/5 border-l-2 border-transparent"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              entry.classical ? "bg-violet-500/20 text-violet-400"
                              : entry.type === "upload" ? "bg-blue-500/20 text-blue-400"
                              : "bg-purple-500/20 text-purple-400"
                            }`}>
                              {entry.classical ? "古典" : entry.type === "upload" ? "识别" : "生成"}
                            </span>
                            <span className="text-white/25 text-xs">{formatTime(entry.timestamp)}</span>
                          </div>
                          <p className="text-white/70 text-sm truncate font-medium">{historyLabel(entry)}</p>
                          {entry.source && <p className="text-white/30 text-xs truncate mt-0.5">{entry.source}</p>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id); }}
                          className="text-white/0 group-hover:text-white/30 hover:!text-red-400 transition-colors text-sm flex-shrink-0 mt-0.5">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right panel ── */}
          <div className="flex flex-col">
            <div className="rounded-2xl border border-white/10 flex flex-col flex-1 min-h-[480px]" style={{ backgroundColor: "#1a0f2e" }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest">
                  {activeTab === "upload" ? (classicalMode ? "乐曲信息" : "识别结果")
                    : activeTab === "generate" ? "生成歌词"
                    : activeTab === "identify" ? "识别结果"
                    : selectedEntry ? (selectedEntry.classical ? "乐曲信息" : "歌词详情") : "选择记录"}
                </h2>
                {(rightPanelHasContent || (activeTab === "identify" && identifyResult && !identifyResult.error)) && (
                  <div className="flex items-center gap-2">
                    {!rightPanelClassical && activeTab !== "history" && (
                      <button onClick={() => setEditMode((v) => !v)}
                        className={`text-xs transition-colors px-3 py-1 rounded-lg border ${editMode ? "text-amber-400 border-amber-400/30 bg-amber-400/10" : "text-white/40 hover:text-white/70 border-white/10 hover:border-white/20"}`}>
                        {editMode ? "✓ 完成编辑" : "编辑"}
                      </button>
                    )}
                    <button onClick={() => copyText(copyableText)}
                      className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1 rounded-lg border border-white/10 hover:border-white/20">
                      {copied ? "✓ 已复制" : "复制"}
                    </button>
                    {activeTab !== "history" && (
                      <button onClick={() => { setEditMode(false); if (activeTab === "upload") { setTranscription(""); setClassicalResult(null); setUploadStatus("idle"); } else { setLyrics(""); setGenerateStatus("idle"); } }}
                        className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1 rounded-lg border border-white/10 hover:border-white/20">清除</button>
                    )}
                  </div>
                )}
              </div>

              <div ref={lyricsRef} className="flex-1 overflow-y-auto px-6 py-5">
                {/* Empty states */}
                {!rightPanelHasContent && activeTab === "upload" && uploadStatus === "idle" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-4xl opacity-20">{classicalMode ? "🎻" : "🎤"}</div>
                    <p className="text-white/20 text-sm">{classicalMode ? "上传或粘贴古典音乐链接" : "上传歌曲，自动识别歌词"}</p>
                    <p className="text-white/10 text-xs">{classicalMode ? "Get composer, movements & piece info" : "Upload a song to extract its lyrics"}</p>
                  </div>
                )}
                {!rightPanelHasContent && activeTab === "upload" && uploadStatus === "uploading" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-3xl animate-pulse">{classicalMode ? "🎻" : "🎵"}</div>
                    <p className="text-amber-400/60 text-sm">{classicalMode ? "正在识别乐曲..." : "正在识别与整理歌词..."}</p>
                    <p className="text-white/20 text-xs">{classicalMode ? "Analyzing with Claude" : "Transcribing · Cleaning up with Claude"}</p>
                  </div>
                )}
                {!rightPanelHasContent && activeTab === "generate" && generateStatus === "idle" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-4xl opacity-20">🎼</div>
                    <p className="text-white/20 text-sm">填写左侧设置，点击生成歌词</p>
                  </div>
                )}
                {!rightPanelHasContent && activeTab === "generate" && generateStatus === "thinking" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-3xl animate-pulse">✦</div>
                    <p className="text-amber-400/60 text-sm">正在构思...</p>
                  </div>
                )}
                {/* Identify empty/loading/result states */}
                {activeTab === "identify" && identifyStatus === "idle" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-4xl opacity-20">🎬</div>
                    <p className="text-white/20 text-sm">输入视频链接与时间范围</p>
                    <p className="text-white/10 text-xs">Paste a video URL and specify a time range</p>
                  </div>
                )}
                {activeTab === "identify" && identifyStatus === "loading" && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-3xl animate-pulse">🎵</div>
                    <p className="text-amber-400/60 text-sm">正在下载片段并识别音乐...</p>
                    <p className="text-white/20 text-xs">Downloading clip · Matching with Shazam</p>
                  </div>
                )}
                {activeTab === "identify" && identifyResult && identifyStatus !== "loading" && (
                  <div>
                    {identifyResult.error ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                        <div className="text-4xl opacity-30">❓</div>
                        <p className="text-red-400/70 text-sm">{identifyResult.error}</p>
                        <p className="text-white/20 text-xs">Try a longer clip or a different time range</p>
                      </div>
                    ) : (
                      <div className="flex gap-5">
                        {identifyResult.coverArt && (
                          <img src={identifyResult.coverArt} alt="Cover art"
                            className="w-28 h-28 rounded-xl object-cover flex-shrink-0 border border-white/10" />
                        )}
                        <div className="flex-1 min-w-0 space-y-3">
                          <div>
                            <h3 className="text-xl font-bold text-white leading-tight">{identifyResult.title}</h3>
                            {identifyResult.artist && <p className="text-amber-400/80 text-sm mt-0.5">{identifyResult.artist}</p>}
                          </div>
                          <div className="space-y-2">
                            <InfoRow label="专辑 Album" value={identifyResult.album} />
                            <InfoRow label="发行年份 Released" value={identifyResult.releaseDate} />
                            <InfoRow label="流派 Genre" value={identifyResult.genre} />
                          </div>
                          <div className="pt-2">
                            <p className="text-white/20 text-xs">
                              {identifyStart} → {identifyEnd}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "history" && !selectedEntry && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="text-4xl opacity-20">👈</div>
                    <p className="text-white/20 text-sm">点击左侧记录查看内容</p>
                  </div>
                )}

                {/* Classical info display */}
                {rightPanelClassical && <ClassicalDisplay info={rightPanelClassical} />}

                {/* Lyrics display */}
                {!rightPanelClassical && rightPanelLyrics && (
                  <div className="h-full">
                    {editMode && activeTab !== "history" ? (
                      <textarea value={rightPanelLyrics}
                        onChange={(e) => { if (activeTab === "upload") setTranscription(e.target.value); else setLyrics(e.target.value); }}
                        className="w-full h-full min-h-[360px] bg-transparent text-white/90 text-sm font-mono leading-relaxed resize-none focus:outline-none border border-white/10 rounded-lg p-3 focus:border-amber-400/30 transition-colors"
                        spellCheck={false} />
                    ) : (
                      <div>
                        {/* Song name / singer header */}
                        {(activeTab !== "history" ? (songName || singerName) : (selectedEntry?.songName || selectedEntry?.singerName)) && (
                          <div className="mb-5 pb-4 border-b border-white/10">
                            {(activeTab !== "history" ? songName : selectedEntry?.songName) && (
                              <h3 className="text-lg font-bold text-white">{activeTab !== "history" ? songName : selectedEntry?.songName}</h3>
                            )}
                            {(activeTab !== "history" ? singerName : selectedEntry?.singerName) && (
                              <p className="text-amber-400/70 text-sm mt-0.5">{activeTab !== "history" ? singerName : selectedEntry?.singerName}</p>
                            )}
                          </div>
                        )}
                        <LyricsDisplay text={rightPanelLyrics} />
                        {isGenerating && <span className="inline-block w-0.5 h-4 bg-amber-400 animate-pulse ml-0.5 align-middle" />}
                        {(uploadStatus === "done" || generateStatus === "done") && activeTab !== "history" && (
                          <p className="mt-6 text-white/20 text-xs text-right">✦ 完成</p>
                        )}
                        {activeTab === "history" && selectedEntry && (
                          <div className="mt-6 pt-4 border-t border-white/5 text-white/20 text-xs space-y-1">
                            <p>{formatTime(selectedEntry.timestamp)}</p>
                            {selectedEntry.source && <p>{selectedEntry.source}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
