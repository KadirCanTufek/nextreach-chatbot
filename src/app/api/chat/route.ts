import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzeLead, computeCompleteness, runChatTurn } from "@/lib/claude";
import { insertLead } from "@/lib/db";
import { LIMITS, checkLeadRate, checkMessageRate, getClientIp } from "@/lib/rate-limit";
import type { ChatResponse, LeadKind, NeedProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bot sinyali: sohbet açıldıktan bu kadar kısa süre sonra talep oluşamaz. */
const MIN_CONVERSATION_MS = 3000;

const Body = z.object({
  sessionId: z.string().min(8).max(64),
  startedAt: z.number().int().positive(),
  website: z.string().optional(), // honeypot
  visitor: z.object({
    name: z.string().max(120),
    email: z.string().max(200),
    company: z.string().max(200),
    storeSize: z.string().max(100),
    anonymous: z.boolean(),
  }),
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
  const { sessionId, startedAt, website, visitor, messages } = parsed.data;

  // Honeypot dolu: bot. Sessizce "başarılı" görünen bir cevap ver, LLM'e gitme.
  if (website && website.trim().length > 0) {
    return reply({ reply: "Teşekkürler, ekibimiz sizinle iletişime geçecek.", done: true });
  }

  // Form doğrulaması (anonim değilse zorunlu alanlar dolu ve e-posta geçerli olmalı)
  if (!visitor.anonymous) {
    const emailOk = z.string().email().safeParse(visitor.email).success;
    if (!visitor.name.trim() || !visitor.company.trim() || !emailOk) {
      return NextResponse.json({ error: "İsim, geçerli e-posta ve şirket zorunludur." }, { status: 400 });
    }
  }

  const rate = await checkMessageRate(ip);
  if (!rate.ok) return reply({ reply: rate.reason, done: false }, 429);

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return NextResponse.json({ error: "Son mesaj ziyaretçiden gelmeli." }, { status: 400 });
  }

  const turn = await runChatTurn(visitor, messages);

  if (turn.type === "reply") {
    return reply({ reply: turn.text, done: false });
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
  const profile: NeedProfile = {
    goal_or_problem: turn.profile.goal_or_problem,
    current_setup: turn.profile.current_setup,
    timeline: turn.profile.timeline,
    scale: turn.profile.scale,
    decision_role: turn.profile.decision_role,
    specific_questions: turn.profile.specific_questions,
  };
  const completeness = computeCompleteness(visitor, profile);
  const analysis = await analyzeLead(visitor, turn.profile, transcript, completeness);

  // İletişim bilgisi: formdan; anonimse sohbetten çıkarılan
  const email = visitor.anonymous ? analysis.extracted_email : visitor.email;
  const phone = visitor.anonymous ? analysis.extracted_phone : null;
  const name = visitor.anonymous ? analysis.extracted_name : visitor.name;
  const company = visitor.anonymous ? analysis.extracted_company : visitor.company;
  const hasContact = Boolean(email || phone);

  let kind: LeadKind = "qualified";
  if (analysis.is_spam) kind = "spam";
  else if (!hasContact) kind = "no_contact";

  const leadId = await insertLead({
    sessionId,
    ip,
    name: name || null,
    email: email || null,
    phone: phone || null,
    company: company || null,
    storeSize: visitor.storeSize || turn.profile.scale || null,
    contactInferred: visitor.anonymous && hasContact,
    needSummary: turn.profile.need_summary,
    needProfile: profile,
    endedEarly: turn.profile.ended_early,
    kind,
    score: kind === "spam" ? null : analysis.score,
    urgency: kind === "spam" ? null : analysis.urgency,
    scoreReason: analysis.is_spam ? analysis.spam_reason : analysis.score_reason,
    completeness,
    transcript,
  });

  return reply({ reply: turn.text, done: true, leadId });
}
