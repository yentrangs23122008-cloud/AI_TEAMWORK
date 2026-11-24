import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Máy chủ chưa có OPENAI_API_KEY trong .env.local." }, { status: 503 });

  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
    const context = typeof body.context === "string" ? body.context.slice(0, 12000) : "";
    if (!messages.length) return NextResponse.json({ error: "Bạn chưa nhập câu hỏi." }, { status: 400 });

    const safeMessages = messages
      .filter((m: any) => ["user", "assistant"].includes(m?.role) && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 5000) }));
    if (!safeMessages.length) return NextResponse.json({ error: "Nội dung câu hỏi không hợp lệ." }, { status: 400 });

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        messages: [
          { role: "system", content: "Bạn là trợ lý AI của AI TeamWork. Trả lời bằng tiếng Việt, rõ ràng, thực tế, ưu tiên hỗ trợ quản lý dự án, phân công, deadline, họp nhóm và cải thiện hiệu suất. Không bịa dữ liệu; nếu thiếu thông tin hãy nêu rõ. Dữ liệu công việc của nhóm được cung cấp dưới đây chỉ là ngữ cảnh tham khảo.\n\n" + context },
          ...safeMessages,
        ],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      const message = data?.error?.message || "OpenAI chưa xử lý được yêu cầu.";
      return NextResponse.json({ error: message }, { status: upstream.status });
    }
    return NextResponse.json({ reply: data?.choices?.[0]?.message?.content || "Mình chưa tạo được câu trả lời." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lỗi máy chủ AI." }, { status: 500 });
  }
}
