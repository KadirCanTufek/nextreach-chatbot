import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzeLead, computeCompleteness, runChatTurn, toNeedProfile } from "@/lib/claude";
import { insertLead } from "@/lib/db";
import { LIMITS, checkLeadRate, checkMessageRate, getClientIp } from "@/lib/rate-limit";
import type { ChatResponse, LeadKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bot sinyali: sohbet açıldıktan bu kadar kısa süre sonra talep oluşamaz. */
const MIN_CONVERSATION_MS = 3000;

const Body = z.object({
  sessionId: z.string().min(8).max(64),
  startedAt: z.number().int().positive(),
  website: z.string().optional(), // honeypot
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(LIMITS.maxMessageLength),
      }),
    )
    .min(1)
    .max(LIMITS.maxMessagesPerSession),
});

function reply(body: ChatResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[chat] beklenmeyen hata", err);
    return reply({ reply: "Şu an cevap veremiyorum. Lütfen bir dakika sonra tekrar deneyin.", done: false }, 503);
  }
}

async function handle(req: NextRequest) {
  const ip = getClientIp(req.headers);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Geçersiz istek.", issues: parsed.error.issues }, { status: 400 });
  }
  const { sessionId, startedAt, website, messages } = parsed.data;

  // Honeypot dolu: bot. Sessizce "başarılı" görünen bir cevap ver, LLM'e gitme.
  if (website && website.trim().length > 0) {
    return reply({ reply: "Teşekkürler, ekibimiz sizinle iletişime geçecek.", done: true });
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user" || !lastMessage.content.trim()) {
    return NextResponse.json({ error: "Son mesaj ziyaretçiden gelmeli." }, { status: 400 });
  }

  const rate = await checkMessageRate(ip);
  if (!rate.ok) return reply({ reply: rate.reason, done: false }, 429);

  const turn = await runChatTurn(messages);

  if (turn.type === "reply") {
    return reply({ reply: turn.text, chips: turn.chips, done: false });
  }

  // --- Sohbet bitti: talep oluştur ---
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_CONVERSATION_MS) {
    // İnsan hızında değil: kaydetme, ama kullanıcıya normal görün.
    return reply({ reply: turn.text, done: true });
  }

  const leadRate = await checkLeadRate(ip);
  if (!leadRate.ok) return reply({ reply: turn.text, done: true });

  const transcript = [...messages, { role: "assistant" as const, content: turn.text }];
  const profile = turn.profile;
  const completeness = computeCompleteness(profile);
  const analysis = await analyzeLead(profile, transcript, completeness);

  // İletişim bilgisi: önce modelin topladığı profil, yoksa analizin sohbetten çıkardığı
  const email = profile.email ?? analysis.extracted_email ?? null;
  const phone = profile.phone ?? analysis.extracted_phone ?? null;
  const name = profile.name ?? analysis.extracted_name ?? null;
  const company = profile.company ?? analysis.extracted_company ?? null;
  const contactInferred = profile.email === null && profile.phone === null && Boolean(email || phone);
  const hasContact = Boolean(email || phone);

  let kind: LeadKind = "qualified";
  if (analysis.is_spam) kind = "spam";
  else if (!hasContact) kind = "no_contact";

  const leadId = await insertLead({
    sessionId,
    ip,
    name,
    email,
    phone,
    company,
    storeSize: profile.store_size ?? profile.scale ?? null,
    contactInferred,
    needSummary: profile.need_summary,
    needProfile: toNeedProfile(profile),
    endedEarly: profile.ended_early,
    kind,
    score: kind === "spam" ? null : analysis.score,
    urgency: kind === "spam" ? null : analysis.urgency,
    scoreReason: analysis.is_spam ? analysis.spam_reason : analysis.score_reason,
    completeness,
    transcript,
  });

  return reply({ reply: turn.text, done: true, leadId });
}
