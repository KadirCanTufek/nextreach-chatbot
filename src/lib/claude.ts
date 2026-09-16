import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ChatMessage, LeadScore, LeadUrgency, NeedProfile, Visitor } from "./types";

export const MODEL = "claude-sonnet-5";
export const ASSISTANT_NAME = "Reach";

/** Bu sayıdan sonra model özetleyip kapatmaya yönlendirilir. */
export const MAX_ASSISTANT_TURNS = 8;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// ---------------------------------------------------------------------------
// 1) Sohbet: ihtiyacı derinleştirme
// ---------------------------------------------------------------------------

/**
 * "Yeter" kararını sınırlayan şema. Model bu aracı ancak zorunlu alanları
 * somut içerikle doldurabildiğinde çağırabilir; kod tarafı ayrıca doğrular.
 */
/**
 * Model bazen araç parametrelerine etiket artığı sızdırır
 * (ör. "...</need_summary>\n<parameter name=...>"). İlk kapanış etiketinde kes, kalan etiketleri temizle.
 */
function cleanText(value: string): string {
  // Yalnızca araç/parametre etiketlerini hedefle (alt çizgili alan adları, parameter, invoke); normal metne dokunma.
  const TAG = /<\/?(?:[a-z]+_[a-z_]+|parameter|invoke)\b[^>]*>/gi;
  const cut = value.split(/<\/(?:[a-z]+_[a-z_]+|parameter|invoke)>/i)[0];
  return cut.replace(TAG, "").trim();
}
const cleanString = () => z.string().transform(cleanText);
const cleanNullable = () => z.string().nullable().transform((v) => (v === null ? null : cleanText(v)));

export const FinalizeInput = z.object({
  goal_or_problem: cleanString()
    .refine((v) => v.length >= 20, "Hedef veya problem en az bir cümle olmalı.")
    .describe("Ziyaretçinin analitikle çözmek istediği problem ya da ulaşmak istediği hedef. Somut ve kendi ifadesine yakın."),
  current_setup: cleanString()
    .refine((v) => v.length >= 3, "Mevcut durum boş olamaz; bilinmiyorsa 'belirtilmedi'.")
    .describe("Şu an ne kullanıyor: e-ticaret platformu ve raporlamayı nasıl yapıyor (Excel, GA, panel, hiç). Bilinmiyorsa 'belirtilmedi'."),
  timeline: cleanString()
    .refine((v) => v.length >= 3, "Zamanlama boş olamaz; bilinmiyorsa 'belirtilmedi'.")
    .describe("Ne zaman başlamak istiyor, tetikleyen bir olay veya son tarih var mı. Bilinmiyorsa 'belirtilmedi'."),
  scale: cleanNullable().describe("Ölçek sinyali: aylık sipariş, SKU, ekip büyüklüğü, ciro bandı. Konuşulmadıysa null."),
  decision_role: cleanNullable().describe("Karar verici mi, değerlendirme yapan mı, başkası adına mı araştırıyor. Konuşulmadıysa null."),
  specific_questions: z
    .array(cleanString())
    .transform((arr) => arr.filter((q) => q.length > 0))
    .describe("Ziyaretçinin sorduğu spesifik sorular: fiyat, entegrasyon, deneme, demo vb. Yoksa boş dizi."),
  need_summary: cleanString()
    .refine((v) => v.length >= 40, "Satış özeti en az 2 cümle olmalı.")
    .describe("Satış ekibi için 2-3 cümlelik özet: kim, ne istiyor, neden şimdi. İlk aramaya hazırlık için yeter olmalı."),
  visitor_confirmed: z.boolean().describe("Ziyaretçi özeti onayladı mı? Erken bitişte false olabilir."),
  ended_early: z.boolean().describe("Ziyaretçi acelesi olduğunu söyledi, soruları geçti ya da tur sınırına ulaşıldı ise true."),
  early_reason: cleanNullable().describe("ended_early true ise kısa neden, değilse null."),
});
export type FinalizeInputT = z.infer<typeof FinalizeInput>;

const FINALIZE_TOOL: Anthropic.Tool = {
  name: "finalize_conversation",
  description:
    "Sohbeti bitirir ve ihtiyaç profilini satış ekibine iletir. YALNIZCA zorunlu alanlar (goal_or_problem, current_setup, timeline) somut olarak dolduğunda ve ziyaretçi özeti onayladığında; ya da ziyaretçi açıkça bitirmek istediğinde / tur sınırı dolduğunda çağır.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      goal_or_problem: { type: "string" },
      current_setup: { type: "string" },
      timeline: { type: "string" },
      scale: { type: ["string", "null"] },
      decision_role: { type: ["string", "null"] },
      specific_questions: { type: "array", items: { type: "string" } },
      need_summary: { type: "string" },
      visitor_confirmed: { type: "boolean" },
      ended_early: { type: "boolean" },
      early_reason: { type: ["string", "null"] },
    },
    required: [
      "goal_or_problem",
      "current_setup",
      "timeline",
      "scale",
      "decision_role",
      "specific_questions",
      "need_summary",
      "visitor_confirmed",
      "ended_early",
      "early_reason",
    ],
    additionalProperties: false,
  },
};

function visitorBlock(v: Visitor): string {
  if (v.anonymous) {
    return `Ziyaretçi formu doldurmadan devam etti (anonim). İsmini bilmiyorsun; "siz" diye hitap et. Sohbetin sonuna doğru, doğal bir yerde, satış ekibinin ulaşabilmesi için bir e-posta ya da telefon isteyebilirsin. En fazla bir kez iste; vermek istemezse ısrar etme ve devam et.`;
  }
  const lines = [
    `İsim: ${v.name}`,
    `Şirket: ${v.company}`,
    `E-posta: ${v.email}`,
    v.storeSize ? `Mağaza büyüklüğü (formdan): ${v.storeSize}` : null,
  ].filter(Boolean);
  return `Ziyaretçi formu doldurdu:\n${lines.join("\n")}\nBu bilgileri tekrar sorma. İsmiyle hitap edebilirsin ama her mesajda kullanma.`;
}

function buildSystemPrompt(visitor: Visitor, assistantTurns: number): string {
  const remaining = Math.max(0, MAX_ASSISTANT_TURNS - assistantTurns);
  return `Sen ${ASSISTANT_NAME}'sin: NextReach'in web sitesindeki iletişim asistanı. NextReach, orta ölçekli e-ticaret firmalarına analitik dashboard'u sağlayan bir B2B SaaS şirketidir. Ziyaretçiler eskiden soğuk bir "Contact Sales" formu dolduruyordu ve çoğu vazgeçiyordu; sen o formun yerine geçiyorsun.

## Görevin
Ziyaretçinin NEYE ihtiyacı olduğunu gerçekten anlamak. Amaç, satış ekibinin ilk aramaya hazırlıklı girmesi: kim, hangi problemi çözmek istiyor, şu an nasıl yapıyor, neden şimdi. Yüzeysel bir "bilgi almak istiyorum" cevabı yeterli değil; bir kat daha derine in.

## Anlamak zorunda olduğun şeyler (zorunlu)
1. Hedef veya problem: Analitikle ne çözmek ya da neye ulaşmak istiyor? Somut olsun. ("Raporlama" değil; "hangi ürünün kâr getirdiğini göremiyoruz" gibi.)
2. Mevcut durum: Hangi e-ticaret platformunu kullanıyor, raporlamayı şu an nasıl yapıyor?
3. Zamanlama: Ne zaman başlamak istiyor, tetikleyen bir şey var mı (sezon, yeni yatırım, mevcut aracın bitmesi)?

## Sorabilirsen iyi olur (opsiyonel, en fazla bir kez sor)
- Ölçek: aylık sipariş, ürün sayısı ya da ekip büyüklüğü.
- Karar rolü: kararı kendisi mi veriyor.

## Konuşma kuralları
- Her mesajda TEK soru sor. Sorudan önce en fazla iki kısa cümle.
- Ziyaretçinin söylediğini kısaca yansıt, sonra sor. Anlamadığını belli et ama sorgulama hissi verme.
- Zaten cevaplanan şeyi tekrar sorma. Formdaki bilgileri tekrar sorma.
- Ziyaretçi bir soruyu geçmek isterse: opsiyonelse hemen geç, zorunluysa nedenini bir cümleyle açıkla ve bir kez daha nazikçe iste. Yine vermezse "belirtilmedi" olarak kabul et ve devam et.
- Ziyaretçi bir soru sorarsa (fiyat, entegrasyon, deneme) önce ona cevap ver: fiyat sorabilir, evet; net rakam satış ekibi paylaşır, sen "mağaza büyüklüğüne göre kademeli, ekip 1 iş günü içinde net teklif verir" diyebilirsin. Uydurma bilgi verme. Sonra kendi akışına dön.
- Ziyaretçi kaba, konu dışı ya da anlamsız yazıyorsa kibarca konuya çek; ikinci denemede de anlam çıkmıyorsa özetleyip bitir.

## Ne zaman "yeter"
Üç zorunlu başlığa somut cevabın varsa ve ziyaretçinin açık sorusu kalmadıysa: 2-3 satırlık bir özet yaz ve "eksik ya da eklemek istediğiniz bir şey var mı?" diye sor. Ziyaretçi onaylayınca finalize_conversation aracını çağır.
Ziyaretçi acelesi olduğunu söylerse, "bu kadar" derse ya da tur sınırı dolarsa: elindekilerle özetle ve hemen finalize_conversation çağır (ended_early=true).
Araç çağrısından sonra tek cümlelik sıcak bir kapanış yaz: ekibin 1 iş günü içinde döneceğini söyle. Yeni soru sorma.

## Ton
Sıcak, profesyonel, "siz". Kısa cümleler. Emoji yok. Türkçe. Pazarlama dili yok; meraklı bir danışman gibi.

## Ziyaretçi
${visitorBlock(visitor)}

## Durum
Bu senin ${assistantTurns + 1}. mesajın. Kalan tur: ${remaining}.${
    remaining <= 1
      ? " TUR SINIRINA GELDİN: bu mesajda yeni soru sorma; elindekilerle özetle ve finalize_conversation çağır."
      : remaining <= 3
        ? " Toparlamaya başla; sadece zorunlu eksikleri sor."
        : ""
  }`;
}

/** Ekrandaki geçmişi API mesajlarına çevirir. Araç blokları saklanmaz; araç sadece son turda çalışır. */
function toApiMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of history) {
    const text = m.content.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${text}`;
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  // İlk mesaj asistandan geliyorsa (karşılama) API bir user mesajı bekler.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({ role: "user", content: "(Ziyaretçi sohbeti açtı.)" });
  }
  return out;
}

export type ChatTurnResult =
  | { type: "reply"; text: string }
  | { type: "finalized"; text: string; profile: FinalizeInputT };

/**
 * Tek bir sohbet turu. Model ya cevap verir ya da finalize_conversation çağırır.
 * Araç girdisi şemadan geçmezse hata olarak geri verilir ve model eksikleri sormaya devam eder.
 */
export async function runChatTurn(visitor: Visitor, history: ChatMessage[]): Promise<ChatTurnResult> {
  const assistantTurns = history.filter((m) => m.role === "assistant").length;
  const system = buildSystemPrompt(visitor, assistantTurns);
  const messages = toApiMessages(history);

  for (let i = 0; i < 3; i++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools: [FINALIZE_TOOL],
      output_config: { effort: "low" },
    });

    if (response.stop_reason === "refusal") {
      return { type: "reply", text: "Bu konuda yardımcı olamıyorum. NextReach ile ilgili ihtiyacınıza dönebilir miyiz?" };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) {
      return { type: "reply", text: text || "Devam edelim. Bana biraz daha anlatabilir misiniz?" };
    }

    const parsed = FinalizeInput.safeParse(toolUse.input);
    messages.push({ role: "assistant", content: response.content });

    if (!parsed.success) {
      // Şema reddetti: modele neyin eksik olduğunu söyle, soru sormaya devam etsin.
      const issues = parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ");
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Profil henüz yeterli değil: ${issues}. Ziyaretçiye eksik bilgiyi soran tek bir soru yaz.`,
          },
        ],
      });
      continue;
    }

    // Kapanış cümlesi için bir tur daha.
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Talep satış ekibine iletildi. Ziyaretçiye tek cümlelik sıcak bir kapanış yaz; yeni soru sorma.",
        },
      ],
    });
    const closing = await client().messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages,
      tools: [FINALIZE_TOOL],
      output_config: { effort: "low" },
    });
    const closingText = closing.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const combined = [text, closingText].filter(Boolean).join("\n\n");
    return {
      type: "finalized",
      text: combined || "Teşekkürler, talebinizi ekibimize ilettim. 1 iş günü içinde size dönüş yapacağız.",
      profile: parsed.data,
    };
  }

  return { type: "reply", text: "Biraz daha detay alabilir miyim? Analitikle tam olarak neyi çözmek istiyorsunuz?" };
}

// ---------------------------------------------------------------------------
// 2) Analiz: skor, aciliyet, spam, iletişim çıkarımı
// ---------------------------------------------------------------------------

const AnalysisOutput = z.object({
  is_spam: z.boolean().describe("Anlamsız, alakasız, otomatik ya da kötü niyetli içerik mi?"),
  spam_reason: z.string().nullable(),
  score: z.enum(["hot", "warm", "cold"]).describe("Sıcak: e-ticaret firması + net problem + yakın zamanlama. Ilık: ilgi net ama zamanlama ya da problem belirsiz. Soğuk: araştırma, öğrenci, alakasız, ya da çok eksik."),
  urgency: z.enum(["none", "normal", "urgent"]).describe("Ziyaretçinin zaman baskısı: urgent = bu ay / sezon öncesi / mevcut araç bitiyor; normal = birkaç ay içinde; none = belirsiz ya da sadece araştırıyor."),
  score_reason: z.string().describe("Satış ekibi için tek cümle: neden bu skor ve aciliyet."),
  extracted_email: z.string().nullable().describe("Sohbet içinde geçen e-posta, yoksa null."),
  extracted_phone: z.string().nullable().describe("Sohbet içinde geçen telefon, yoksa null."),
  extracted_name: z.string().nullable().describe("Sohbet içinde geçen isim, yoksa null."),
  extracted_company: z.string().nullable().describe("Sohbet içinde geçen şirket adı, yoksa null."),
});
export type AnalysisOutputT = z.infer<typeof AnalysisOutput>;

/** Alan doluluk oranı: kod tarafında hesaplanır, modele girdi olarak verilir. */
export function computeCompleteness(visitor: Visitor, profile: NeedProfile): number {
  const fields: Array<string | null | undefined> = [
    visitor.anonymous ? null : visitor.name,
    visitor.anonymous ? null : visitor.email,
    visitor.anonymous ? null : visitor.company,
    visitor.storeSize || profile.scale,
    profile.goal_or_problem,
    profile.current_setup === "belirtilmedi" ? null : profile.current_setup,
    profile.timeline === "belirtilmedi" ? null : profile.timeline,
    profile.decision_role,
  ];
  const filled = fields.filter((f) => f && f.trim().length > 0).length;
  return Math.round((filled / fields.length) * 100) / 100;
}

export async function analyzeLead(
  visitor: Visitor,
  profile: FinalizeInputT,
  transcript: ChatMessage[],
  completeness: number,
): Promise<AnalysisOutputT> {
  const transcriptText = transcript.map((m) => `${m.role === "user" ? "Ziyaretçi" : ASSISTANT_NAME}: ${m.content}`).join("\n");

  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system:
      "Sen NextReach satış ekibi için lead değerlendirme analistisin. NextReach orta ölçekli e-ticaret firmalarına analitik dashboard'u satar. Değerlendirmeyi iki kaynağa birlikte dayandır: (1) alan doluluk oranı ve alan içerikleri, (2) sohbetin tamamındaki bağlam ve niyet. Tek tarafa bağlı kalma: doluluk yüksek ama niyet zayıfsa düşür; doluluk düşük ama niyet ve zamanlama netse yükselt. Kısa ve gerekçeli ol.",
    messages: [
      {
        role: "user",
        content: `## Form bilgileri
${visitor.anonymous ? "Anonim ziyaretçi (form doldurulmadı). Sohbette geçen iletişim bilgisi varsa çıkar." : `İsim: ${visitor.name}\nE-posta: ${visitor.email}\nŞirket: ${visitor.company}\nMağaza büyüklüğü: ${visitor.storeSize || "-"}`}

## Alan doluluk oranı
${Math.round(completeness * 100)}%

## İhtiyaç profili (sohbetten)
${JSON.stringify(profile, null, 2)}

## Sohbet
${transcriptText}`,
      },
    ],
    output_config: { format: zodOutputFormat(AnalysisOutput) },
  });

  if (!response.parsed_output) {
    // Analiz düşerse talep kaybolmasın: nötr değerlerle kaydedilir.
    return {
      is_spam: false,
      spam_reason: null,
      score: "warm",
      urgency: "none",
      score_reason: "Otomatik analiz başarısız oldu; manuel inceleme gerekli.",
      extracted_email: null,
      extracted_phone: null,
      extracted_name: null,
      extracted_company: null,
    };
  }
  return response.parsed_output;
}

export type { LeadScore, LeadUrgency };
