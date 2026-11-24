import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Máy chủ chưa có OPENAI_API_KEY trong .env.local." }, { status: 503 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Không nhận được tệp ghi âm." }, { status: 400 });
    if (file.size > 24 * 1024 * 1024) return NextResponse.json({ error: "Bản ghi vượt quá 24 MB. Hãy ghi âm thành đoạn ngắn hơn." }, { status: 413 });

    const upstreamForm = new FormData();
    upstreamForm.append("file", new Blob([await file.arrayBuffer()], { type: file.type || "audio/webm" }), file.name || "ai-teamwork-recording.webm");
    upstreamForm.append("model", "gpt-transcribe");
    upstreamForm.append("languages[]", "vi");
    upstreamForm.append("response_format", "json");

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    });
    const data = await upstream.json();
    if (!upstream.ok) return NextResponse.json({ error: data?.error?.message || "Không chuyển được âm thanh thành văn bản." }, { status: upstream.status });
    return NextResponse.json({ text: data.text || "" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lỗi xử lý bản ghi." }, { status: 500 });
  }
}
