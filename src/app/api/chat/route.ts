import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzeLead, computeCompleteness, runChatTurn, runFollowUpTurn, scoreFromAnalysis, toNeedProfile, type TurnHooks } from "@/lib/claude";
import { addLeadContact, appendLeadTranscript, getLeadForSession, insertLead } from "@/lib/db";
import { LIMITS, checkLeadRate, checkMessageRate, getClientIp } from "@/lib/rate-limit";
import type { ChatMessage, ChatResponse, LeadKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bot sinyali: sohbet açıldıktan bu kadar kısa süre sonra talep oluşamaz. */
const MIN_CONVERSATION_MS = 3000;

const Body = z.object({
  sessionId: z.string().min(8).max(64),
  startedAt: z.number().int().positive(),
  leadId: z.string().uuid().optional(), // devam modu
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
type BodyT = z.infer<typeof Body>;

/**
 * Cevap NDJSON akışı olarak döner: her satır bir olay.
 *   {"t":"delta","text":"..."}  metin parçası
 *   {"t":"reset"}               ekrana yazılanı sil (reddedilen araç denemesi)
 *   {"t":"end", ...ChatResponse} son durum (çipler, done, leadId, contactAdded, ended)
 *   {"t":"error","message":"..."}
 * Ön kontroller (geçersiz istek, rate limit) akış başlamadan JSON olarak döner.
 */
export async function POST(req: NextRequest) {
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
  const body = parsed.data;
  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== "user" || !lastMessage.content.trim()) {
    return NextResponse.json({ error: "Son mesaj ziyaretçiden gelmeli." }, { status: 400 });
  }

  const rate = await checkMessageRate(ip);
  if (!rate.ok) {
    const res: ChatResponse = { reply: rate.reason, done: Boolean(body.leadId), leadId: body.leadId };
    return NextResponse.json(res, { status: 429 });
  }

  let lead: { id: string; hasContact: boolean } | null = null;
  if (body.leadId) {
    lead = await getLeadForSession(body.leadId, body.sessionId);
    if (!lead) return NextResponse.json({ error: "Talep bulunamadı." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const hooks: TurnHooks = {
        onDelta: (text) => send({ t: "delta", text }),
        onReset: () => send({ t: "reset" }),
      };
      try {
        const result = lead ? await handleFollowUp(body, lead, hooks) : await handleTurn(body, ip, hooks);
        send({ t: "end", ...result });
      } catch (err) {
        console.error("[chat] beklenmeyen hata", err);
        send({ t: "error", message: "Şu an cevap veremiyorum. Lütfen bir dakika sonra tekrar deneyin." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Devam modu: talep zaten iletildi; soru-cevap ve geç iletişim bilgisi. */
async function handleFollowUp(body: BodyT, lead: { id: string; hasContact: boolean }, hooks: TurnHooks): Promise<ChatResponse> {
  const { sessionId, messages } = body;
  const follow = await runFollowUpTurn(messages, lead.hasContact, hooks);
  // Yalnızca bu turun mesajları eklenir; istemcinin gönderdiği geçmiş kayıtlı transkriptin yerine geçmez.
  const appended: ChatMessage[] = [messages[messages.length - 1], { role: "assistant", content: follow.text }];

  if (follow.type === "ended") {
    await appendLeadTranscript(lead.id, sessionId, appended);
    return { reply: follow.text, done: true, leadId: lead.id, ended: follow.reason };
  }

  let contactAdded = false;
  if (follow.type === "contact") {
    contactAdded = await addLeadContact(lead.id, sessionId, follow.contact.email, follow.contact.phone);
  }
  await appendLeadTranscript(lead.id, sessionId, appended);
  return {
    reply: follow.text,
    chips: follow.type === "reply" ? follow.chips : [],
    done: true,
    leadId: lead.id,
    ...(contactAdded ? { contactAdded: true } : {}),
  };
}

/** Ana akış: ihtiyacı derinleştir; model "yeter" deyince talebi kaydet. */
async function handleTurn(body: BodyT, ip: string, hooks: TurnHooks): Promise<ChatResponse> {
  const { sessionId, startedAt, messages } = body;
  const turn = await runChatTurn(messages, hooks);

  if (turn.type === "reply") return { reply: turn.text, chips: turn.chips, done: false };
  if (turn.type === "ended") return { reply: turn.text, done: true, ended: turn.reason }; // kapsam dışı: kayıt yok

  // --- Sohbet bitti: talep oluştur ---
  if (Date.now() - startedAt < MIN_CONVERSATION_MS) {
    // İnsan hızında değil: kaydetme, ama kullanıcıya normal görün.
    return { reply: turn.text, done: true };
  }
  const leadRate = await checkLeadRate(ip);
  if (!leadRate.ok) return { reply: turn.text, done: true };

  const transcript: ChatMessage[] = [...messages, { role: "assistant", content: turn.text }];
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
  const scored = kind === "spam" ? null : scoreFromAnalysis(analysis, hasContact);

  const newLeadId = await insertLead({
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
    scorePoints: scored?.points ?? null,
    scoreBreakdown: scored?.breakdown ?? null,
    urgency: kind === "spam" ? null : analysis.urgency,
    scoreReason: analysis.is_spam ? analysis.spam_reason : analysis.score_reason,
    completeness,
    transcript,
  });

  return { reply: turn.text, done: true, leadId: newLeadId };
}
