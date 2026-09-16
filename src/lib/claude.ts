import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ChatMessage, NeedProfile, ScoreBreakdown } from "./types";
import { totalScore } from "./types";
import { ASSISTANT_NAME, DEFAULT_SALES_EMAIL, GREETING, GREETING_CHIPS } from "./chat-config";

export const MODEL = "claude-sonnet-5";
export { ASSISTANT_NAME, GREETING, GREETING_CHIPS };

/** Bu sayıdan sonra model özetleyip kapatmaya yönlendirilir. */
export const MAX_ASSISTANT_TURNS = 14;

export function salesEmail(): string {
  return process.env.SALES_EMAIL?.trim() || DEFAULT_SALES_EMAIL;
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/**
 * Model bazen araç parametrelerine etiket artığı sızdırır
 * (ör. "...</need_summary>\n<parameter name=...>"). Yalnızca araç/parametre
 * etiketlerini hedefle; normal metne dokunma.
 */
function cleanText(value: string): string {
  const TAG = /<\/?(?:[a-z]+_[a-z_]+|parameter|invoke)\b[^>]*>/gi;
  const cut = value.split(/<\/(?:[a-z]+_[a-z_]+|parameter|invoke)>/i)[0];
  return cut.replace(TAG, "").trim();
}
const cleanString = () => z.string().transform(cleanText);
const cleanNullable = () => z.string().nullable().transform((v) => (v === null ? null : cleanText(v)));

/** "yok", "belirtilmedi" gibi değerleri null'a çevirir. */
const NONE_RE = /^(yok|belirtilmedi|belirtmedi|bilinmiyor|null|none|-|—|vermek istemedi.*|paylaşmak istemedi.*)$/i;
const optionalContact = () => cleanNullable().transform((v) => (v === null || v.length === 0 || NONE_RE.test(v) ? null : v));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailField = () =>
  optionalContact()
    .transform((v) => (v === null ? null : v.toLowerCase().replace(/\s+/g, "")))
    .refine((v) => v === null || EMAIL_RE.test(v), "E-posta biçimi geçersiz görünüyor; ziyaretçiye teyit ettir ya da null bırak.");
const phoneField = () =>
  optionalContact().refine((v) => v === null || v.replace(/\D/g, "").length >= 7, "Telefon numarası eksik görünüyor; teyit ettir ya da null bırak.");

/** Zorunlu ihtiyaç alanları: temizle, "yok/belirtilmedi" varyantlarını tek biçime indir. */
const mandatoryText = () => cleanString().transform((v) => (NONE_RE.test(v) || v.length === 0 ? "belirtilmedi" : v));
const isUnknown = (v: string) => v === "belirtilmedi";

/** Çip protokolü: model mesajın son satırına [[chips: a | b | c]] ekler. */
const CHIPS_RE = /\s*\[\[\s*chips?\s*:\s*([^\]]*)\]\]\s*/gi;
export function splitChips(text: string): { text: string; chips: string[] } {
  let chips: string[] = [];
  const cleaned = text
    .replace(CHIPS_RE, (_m, body: string) => {
      chips = body
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map((s) => s.slice(0, 40));
      return "\n";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: cleaned, chips };
}

const nullableString = { type: ["string", "null"] } as const;

const TONE = `## Ton
Sıcak, profesyonel, "siz". Kısa cümleler. Emoji yok. Türkçe. Pazarlama dili yok; meraklı bir danışman gibi.
Hitap: isimden cinsiyet tahmin etme; "Bey", "Hanım" ya da "Bey/Hanım" kullanma. Sadece ilk isimle hitap et ("Teşekkürler Deniz") ya da hitap kullanma.`;

const CHIP_RULES = `## Çipler (hızlı cevap seçenekleri)
Yapısal bir soru sorduğunda mesajının EN SON satırına şu biçimde seçenek ekle:
[[chips: Seçenek 1 | Seçenek 2 | Seçenek 3]]
- En fazla 4 seçenek, her biri en fazla 4-5 kelime. Uygun yerde "Diğer" ya da "Emin değilim" ekle.
- Çip ver: platform (Shopify | ikas | Ticimax | T-Soft | Diğer), mağaza büyüklüğü (Ayda 500'den az | 500-2.000 | 2.000-10.000 | 10.000 üzeri), zamanlama (Bu ay | 1-3 ay içinde | Bu yıl içinde | Sadece araştırıyorum), rol (Sahibi / ortağı | E-ticaret yöneticisi | Pazarlama | Diğer), iletişim tercihi, özet onayı (Doğru, iletin | Düzeltmek istiyorum).
- Çip VERME: açık uçlu ihtiyaç soruları, isim, şirket adı, e-posta veya telefonun kendisi.
- Ziyaretçi çipe basınca metni normal mesaj olarak gelir; öyle işle. "E-posta bırakayım" derse bir sonraki mesajda adresi iste.`;

// ---------------------------------------------------------------------------
// 1) Sohbet: ihtiyacı derinleştirme + iletişim bilgisi
// ---------------------------------------------------------------------------

/**
 * "Yeter" kararını sınırlayan şema. Model bu aracı ancak zorunlu alanları
 * somut içerikle doldurabildiğinde çağırabilir; kod tarafı ayrıca doğrular.
 */
export const FinalizeInput = z
  .object({
    // Kimlik ve iletişim (sohbetten toplanır; ziyaretçi vermediyse null)
    name: optionalContact().describe("Ziyaretçinin adı. Söylemediyse null."),
    company: optionalContact().describe("Şirket / marka adı. Söylemediyse null."),
    email: emailField().describe("E-posta adresi, yoksa null."),
    phone: phoneField().describe("Telefon numarası, yoksa null."),
    store_size: optionalContact().describe("Mağaza büyüklüğü (aylık sipariş bandı vb.). Konuşulmadıysa null."),

    // İhtiyaç profili
    goal_or_problem: mandatoryText()
      .refine((v) => v.length >= 20, "Hedef veya problem en az bir cümle olmalı; ziyaretçiye analitikle tam olarak neyi çözmek istediğini sor.")
      .describe("Ziyaretçinin analitikle çözmek istediği problem ya da ulaşmak istediği hedef. Somut ve kendi ifadesine yakın."),
    current_setup: mandatoryText().describe("Şu an ne kullanıyor: e-ticaret platformu ve raporlamayı nasıl yapıyor (Excel, GA, panel, hiç). Bilinmiyorsa 'belirtilmedi'."),
    timeline: mandatoryText().describe("Ne zaman başlamak istiyor, tetikleyen bir olay veya son tarih var mı. Bilinmiyorsa 'belirtilmedi'."),
    scale: cleanNullable().describe("Ölçek sinyali: aylık sipariş, SKU, ekip büyüklüğü, ciro bandı. Konuşulmadıysa null."),
    decision_role: cleanNullable().describe("Karar verici mi, değerlendirme yapan mı, başkası adına mı araştırıyor. Konuşulmadıysa null."),
    specific_questions: z
      .array(cleanString())
      .transform((arr) => arr.filter((q) => q.length > 0))
      .describe("Ziyaretçinin sorduğu spesifik sorular: fiyat, entegrasyon, deneme, demo vb. Yoksa boş dizi."),
    need_summary: cleanString()
      .refine((v) => v.length >= 40, "Satış özeti en az 2 cümle olmalı.")
      .describe("Satış ekibi için 2-3 cümlelik özet: kim, ne istiyor, neden şimdi. İlk aramaya hazırlık için yeter olmalı."),
    contact_requested: z.boolean().describe("İletişim bilgisi ziyaretçiden istendi mi? (Verilmiş olması gerekmez.)"),
    visitor_confirmed: z.boolean().describe("Ziyaretçi özeti onayladı mı? Erken bitişte false olabilir."),
    ended_early: z.boolean().describe("Ziyaretçi acelesi olduğunu söyledi, soruları geçti ya da tur sınırına ulaşıldı ise true."),
    early_reason: cleanNullable().describe("ended_early true ise kısa neden, değilse null."),
    declined_fields: z
      .array(z.string())
      .describe("Ziyaretçinin iki kez sorulmasına rağmen AÇIKÇA cevap vermek istemediği alanlar: 'current_setup', 'timeline', 'goal_or_problem', 'contact'. Yoksa boş dizi."),
  })
  .superRefine((v, ctx) => {
    // "Yeter" kuralları: araç açıklaması değil, kod karar verir.
    const declined = (f: string) => v.declined_fields.includes(f);
    if (isUnknown(v.current_setup) && !declined("current_setup")) {
      ctx.addIssue({ code: "custom", path: ["current_setup"], message: "Mevcut durum bilinmiyor. Hangi e-ticaret platformunu kullandığını ve raporlamayı bugün nasıl yaptığını sor (çip: Shopify | ikas | Ticimax | T-Soft | Diğer)." });
    }
    if (isUnknown(v.timeline) && !declined("timeline")) {
      ctx.addIssue({ code: "custom", path: ["timeline"], message: "Zamanlama bilinmiyor. Ne zaman başlamak istediğini sor (çip: Bu ay | 1-3 ay içinde | Bu yıl içinde | Sadece araştırıyorum)." });
    }
    if (!v.contact_requested) {
      ctx.addIssue({ code: "custom", path: ["contact_requested"], message: "İletişim bilgisi henüz istenmedi. Gerekçesiyle e-posta ya da telefon iste (biri yeter); bu mesajda sadece bunu sor (çip: E-posta bırakayım | Telefon bırakayım | Şimdilik istemiyorum)." });
    }
    if (v.email === null && v.phone === null && !declined("contact") && !v.ended_early) {
      ctx.addIssue({ code: "custom", path: ["declined_fields"], message: "İletişim bilgisi yok ama ziyaretçi açıkça reddetmemiş görünüyor. İlk reddin ardından ikinci ve son kez, sonucunu söyleyerek iste; iki kez reddettiyse declined_fields'a 'contact' ekle." });
    }
    if (!v.ended_early && !v.visitor_confirmed) {
      ctx.addIssue({ code: "custom", path: ["visitor_confirmed"], message: "Ziyaretçi özeti onaylamadı. Önce 2-3 satırlık özet yaz ve 'eksik ya da eklemek istediğiniz var mı?' diye sor (çip: Doğru, iletin | Düzeltmek istiyorum); onaylayınca tekrar çağır." });
    }
    if (v.ended_early && !v.early_reason) {
      ctx.addIssue({ code: "custom", path: ["early_reason"], message: "ended_early true ise early_reason yazılmalı." });
    }
  });
export type FinalizeInputT = z.infer<typeof FinalizeInput>;

const FINALIZE_TOOL: Anthropic.Tool = {
  name: "finalize_conversation",
  description:
    "Sohbeti bitirir ve ihtiyaç profilini satış ekibine iletir. Çağırmadan önce kontrol listesi: (1) üç zorunlu başlık (goal_or_problem, current_setup, timeline) somut; (2) marka adı ve platform soruldu; (3) iletişim bilgisi gerekçesiyle istendi, reddedildiyse ikinci kez sonucunu söyleyerek istendi (contact_requested=true; iki kez reddedildiyse declined_fields 'contact' içerir); (4) özet yazıldı ve ziyaretçi onayladı (visitor_confirmed=true). Bunlar sağlanmadan çağırırsan hata alırsın. İstisna: ziyaretçi açıkça bitirmek istiyorsa ya da tur sınırı dolduysa, iletişimi tek cümleyle isteyip bir sonraki mesajda elindekilerle çağır (ended_early=true, early_reason dolu).",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      name: nullableString,
      company: nullableString,
      email: nullableString,
      phone: nullableString,
      store_size: nullableString,
      goal_or_problem: { type: "string" },
      current_setup: { type: "string" },
      timeline: { type: "string" },
      scale: nullableString,
      decision_role: nullableString,
      specific_questions: { type: "array", items: { type: "string" } },
      need_summary: { type: "string" },
      contact_requested: { type: "boolean" },
      visitor_confirmed: { type: "boolean" },
      ended_early: { type: "boolean" },
      early_reason: nullableString,
      declined_fields: { type: "array", items: { type: "string" } },
    },
    required: [
      "name",
      "company",
      "email",
      "phone",
      "store_size",
      "goal_or_problem",
      "current_setup",
      "timeline",
      "scale",
      "decision_role",
      "specific_questions",
      "need_summary",
      "contact_requested",
      "visitor_confirmed",
      "ended_early",
      "early_reason",
      "declined_fields",
    ],
    additionalProperties: false,
  },
};

function buildSystemPrompt(assistantTurns: number, sales: string): string {
  const remaining = Math.max(0, MAX_ASSISTANT_TURNS - assistantTurns);
  return `Sen ${ASSISTANT_NAME}'sin: NextReach'in web sitesindeki iletişim asistanı. NextReach, orta ölçekli e-ticaret firmalarına analitik dashboard'u sağlayan bir B2B SaaS şirketidir. Eskiden bu sitede soğuk bir "Contact Sales" formu vardı; ziyaretçilerin çoğu doldurmuyordu. Sen o formun yerine geçiyorsun: form yok, her şey konuşarak.

## Görevin
1. Ziyaretçinin NEYE ihtiyacı olduğunu gerçekten anlamak. Satış ekibi ilk aramaya hazır girsin: kim, hangi problemi çözmek istiyor, şu an nasıl yapıyor, neden şimdi.
2. Satış ekibinin ulaşabileceği bilgiyi toplamak: isim, şirket, e-posta ya da telefon.
Yüzeysel bir "bilgi almak istiyorum" yeterli değil; bir kat daha derine in.

## Omurga (esnek uygula, ama sıra bu)
1. İlk mesaja karşılık: ihtiyacı yansıt, TEK derinleştirme sorusu sor. Ziyaretçi soru sorduysa (fiyat vb.) önce ona cevap ver, sonra sor.
2. İkinci ya da üçüncü mesajında ismini sor: "Size hitap edebilmem için isim ve soyisminizi alabilir miyim?" Bu mesajda başka soru sorma; söylenene kısa bir yansıtma ekleyebilirsin. Sonra ismiyle hitap et ama her mesajda kullanma.
3. Şirket bilgilerini sohbetin içine yay, her biri ayrı mesajda tek soru: marka/şirket adı (serbest metin, çip yok: "Hangi marka için bakıyorsunuz?"), e-ticaret platformu (çip), mağaza büyüklüğü (çip), ziyaretçinin rolü (çip). Ürün grubu ihtiyaç anlatımında zaten çıkar; ayrıca sorma. Ziyaretçi bunlardan birini kendiliğinden söylediyse tekrar sorma. Marka adı ve platform, satış ekibi için en değerli ikisi; rolü sohbet uzarsa atla.
4. Zorunlu üç başlık dolduğunda ve özetten hemen ÖNCE iletişim iste. İki aşama, ikisi de tek soru:
   a) İlk istek, gerekçesiyle: "Ekibin size 1 iş günü içinde dönebilmesi için bir e-posta ya da telefon bırakır mısınız? Biri yeter." [[chips: E-posta bırakayım | Telefon bırakayım | Şimdilik istemiyorum]]
   b) Reddederse ikinci ve SON istek, sonucunu ve sınırını söyleyerek: "Anlıyorum. Yalnız iletişim bilgisi olmadan ekibim size dönüş yapamıyor; talebiniz kayda geçer ama cevapsız kalır. Yalnızca bu konuda dönüş için bir e-posta ya da telefon yeterli, başka bir amaçla kullanılmaz. Paylaşmak ister misiniz?" [[chips: E-posta bırakayım | Telefon bırakayım | Hayır, teşekkürler]]
   c) Yine reddederse ısrar etme, suçlama; "Anlaşıldı, ısrar etmeyeceğim." de, declined_fields'a "contact" yaz ve kısa özete geç.
   İletişim bilgisi vermeden fiyat, teklif ya da demo sorarsa: kademeli yapıyı söyle, net teklifi ekibin iletebileceğini ve bunun için bir e-posta ya da telefon gerektiğini tek cümleyle hatırlat. Sonra akışa dön.
5. 2-3 satırlık özet yaz ve "eksik ya da eklemek istediğiniz var mı?" diye sor. Onaylayınca finalize_conversation çağır.

## Anlamak zorunda olduğun şeyler (zorunlu)
1. Hedef veya problem: analitikle ne çözmek ya da neye ulaşmak istiyor? Somut olsun. ("Raporlama" değil; "hangi ürünün kâr getirdiğini göremiyoruz" gibi.)
2. Mevcut durum: hangi e-ticaret platformu, raporlamayı şu an nasıl yapıyor?
3. Zamanlama: ne zaman başlamak istiyor, tetikleyen bir şey var mı (sezon, yeni yatırım, mevcut aracın bitmesi)?

## Sorabilirsen iyi olur (en fazla bir kez)
- Ölçek: aylık sipariş, ürün sayısı ya da ekip büyüklüğü.
- Karar rolü: kararı kendisi mi veriyor.

${CHIP_RULES}

## Konuşma kuralları
- Her mesajda TEK soru. Sorudan önce en fazla iki kısa cümle.
- Ziyaretçinin söylediğini kısaca yansıt, sonra sor. Anlamadığını belli et ama sorgulama hissi verme.
- Zaten cevaplanan şeyi tekrar sorma.
- Ziyaretçi bir soruyu geçmek isterse: opsiyonelse hemen geç; zorunluysa nedenini bir cümleyle açıkla ve bir kez daha nazikçe iste. Yine vermezse "belirtilmedi" olarak kabul et, declined_fields'a yaz ve devam et.
- Ziyaretçi bir soru sorarsa önce ona cevap ver. Fiyat sorulabilir, evet: net rakamı satış ekibi paylaşır; sen "mağaza büyüklüğüne göre kademeli, ekip 1 iş günü içinde net teklif verir" diyebilirsin. Deneme/demo: "ekip görüşmede ayarlar". Uydurma bilgi verme. Sonra kendi akışına dön.
- Ziyaretçi kaba, konu dışı ya da anlamsız yazıyorsa kibarca konuya çek; ikinci denemede de anlam çıkmıyorsa özetleyip bitir.

## Ne zaman "yeter"
finalize_conversation çağırmadan önce şu dördü sağlanmış olmalı; sağlanmadıysa araç hata döner:
1. Üç zorunlu başlık somut (bilinmeyen varsa ziyaretçi iki kez sorulmasına rağmen açıkça reddetmiş ve declined_fields'a yazılmış).
2. Marka adı ve platform soruldu.
3. İletişim bilgisi gerekçesiyle istendi; reddedildiyse ikinci kez sonucunu söyleyerek istendi (contact_requested=true; iki kez reddedildiyse declined_fields "contact" içerir).
4. Özet yazıldı ve ziyaretçi onayladı (visitor_confirmed=true).
Sıra: zorunlular → iletişim → özet ve onay → araç. İletişimi özetin içinde ya da özetten sonra isteme.
Ziyaretçi acelesi olduğunu söylerse, "bu kadar" derse ya da tur sınırı dolarsa: iletişim bilgisini henüz istemediysen tek cümleyle iste; sonraki mesajında elindekilerle özetle ve finalize_conversation çağır (ended_early=true).

## Araç çağrısından sonra kapanış (tek mesaj, yeni soru yok, çip yok)
- İletişim bilgisi varsa: tek cümle; ekibin 1 iş günü içinde döneceğini söyle.
- İletişim bilgisi yoksa ("ısrar etmeyeceğim" cümlesini tekrar etme, onu özet öncesinde söyledin): "Notlarınızı ekibe ilettim; bu haliyle size ulaşamayacaklar ama fikriniz değişirse buradan yazabilir ya da ${sales} adresine ulaşabilirsiniz. Ürünle ilgili sorularınızı da cevaplayabilirim, isterseniz devam edelim."

${TONE}

## Durum
Bu senin ${assistantTurns + 1}. mesajın. Kalan tur: ${remaining}.${
    remaining <= 1
      ? " TUR SINIRINA GELDİN: bu mesajda yeni soru sorma; elindekilerle özetle ve finalize_conversation çağır."
      : remaining <= 4
        ? " Toparlamaya başla: opsiyonelleri atla, iletişim bilgisini istemediysen şimdi iste, sonra özetle."
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

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export type ChatTurnResult =
  | { type: "reply"; text: string; chips: string[] }
  | { type: "finalized"; text: string; profile: FinalizeInputT };

/**
 * Tek bir sohbet turu. Model ya cevap verir ya da finalize_conversation çağırır.
 * Araç girdisi şemadan geçmezse hata olarak geri verilir ve model eksikleri sormaya devam eder.
 */
export async function runChatTurn(history: ChatMessage[]): Promise<ChatTurnResult> {
  const assistantTurns = history.filter((m) => m.role === "assistant").length;
  const system = buildSystemPrompt(assistantTurns, salesEmail());
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
      return { type: "reply", text: "Bu konuda yardımcı olamıyorum. NextReach ile ilgili ihtiyacınıza dönebilir miyiz?", chips: [] };
    }

    const rawText = textOf(response);
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (!toolUse) {
      const { text, chips } = splitChips(rawText);
      return { type: "reply", text: text || "Devam edelim. Bana biraz daha anlatabilir misiniz?", chips };
    }

    const parsed = FinalizeInput.safeParse(toolUse.input);
    messages.push({ role: "assistant", content: response.content });

    const userCount = history.filter((m) => m.role === "user").length;
    const tooShort = parsed.success && !parsed.data.ended_early && userCount < 4;

    if (!parsed.success || tooShort) {
      // Şema reddetti: modele neyin eksik olduğunu söyle, soru sormaya devam etsin.
      const issues = parsed.success
        ? `sohbet henüz çok kısa (${userCount} ziyaretçi mesajı); zorunlu başlıkları ve iletişimi tek tek sor`
        : parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ");
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
    const hasContact = Boolean(parsed.data.email || parsed.data.phone);
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: hasContact
            ? "Talep satış ekibine iletildi (iletişim bilgisi var). Ziyaretçiye tek cümlelik sıcak bir kapanış yaz; yeni soru sorma, çip verme."
            : "Talep kaydedildi ama iletişim bilgisi yok. 'İletişim bilgisi yoksa' kapanış metnini yaz; yeni soru sorma, çip verme.",
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

    const pre = splitChips(rawText).text;
    const post = splitChips(textOf(closing)).text;
    const combined = [pre, post].filter(Boolean).join("\n\n");
    return {
      type: "finalized",
      text: combined || "Teşekkürler, talebinizi ekibimize ilettim.",
      profile: parsed.data,
    };
  }

  return { type: "reply", text: "Biraz daha detay alabilir miyim? Analitikle tam olarak neyi çözmek istiyorsunuz?", chips: [] };
}

// ---------------------------------------------------------------------------
// 1b) Devam modu: talep iletildikten sonra soru-cevap ve geç iletişim bilgisi
// ---------------------------------------------------------------------------

export const AddContactInput = z
  .object({
    email: emailField().describe("Ziyaretçinin verdiği e-posta, yoksa null."),
    phone: phoneField().describe("Ziyaretçinin verdiği telefon, yoksa null."),
  })
  .refine((v) => v.email !== null || v.phone !== null, "E-posta ya da telefon gerekli.");
export type AddContactInputT = z.infer<typeof AddContactInput>;

const ADD_CONTACT_TOOL: Anthropic.Tool = {
  name: "add_contact",
  description: "Ziyaretçi, talep iletildikten sonra e-posta ya da telefon verdiyse çağır. Bilgi mevcut talebe eklenir ve ekip dönüş yapabilir.",
  strict: true,
  input_schema: {
    type: "object",
    properties: { email: nullableString, phone: nullableString },
    required: ["email", "phone"],
    additionalProperties: false,
  },
};

function buildFollowUpPrompt(hasContact: boolean, sales: string): string {
  return `Sen ${ASSISTANT_NAME}'sin: NextReach'in web sitesindeki iletişim asistanı. NextReach, orta ölçekli e-ticaret firmalarına analitik dashboard'u sağlayan bir B2B SaaS şirketidir.

Bu sohbette ziyaretçinin talebi ZATEN satış ekibine iletildi. ${
    hasContact
      ? "Ziyaretçi iletişim bilgisi bıraktı; ekip 1 iş günü içinde dönecek."
      : `Ziyaretçi iletişim bilgisi bırakmadı; ekip bu haliyle ona ulaşamaz. Kendisi isterse ${sales} adresine yazabilir.`
  }

## Görevin
- Ziyaretçinin ürünle ilgili sorularını kısa ve dürüst cevapla. Bilmediğini uydurma; "bunu ekip netleştirir" de.
- Fiyat: mağaza büyüklüğüne göre kademeli; net rakamı ekip verir. Deneme/demo: ekip görüşmede ayarlar.
${
  hasContact
    ? "- Ziyaretçi yeni bilgi verirse teşekkür et; ekibe iletileceğini söyle."
    : `- Fiyat, teklif, demo ya da "ne zaman dönersiniz" gibi bir soru gelirse, sorusuna cevap verdikten sonra TEK cümleyle hatırlat: net teklifi ekip iletebilir ama bunun için bir e-posta ya da telefon gerekir. [[chips: E-posta bırakayım | Telefon bırakayım]] ekle. Her mesajda tekrarlama; ısrar etme.
- Ziyaretçi e-posta ya da telefon verirse add_contact aracını çağır. Araçtan sonra tek cümle: teşekkür et, ekibin 1 iş günü içinde döneceğini söyle.`
}
- Yeniden ihtiyaç anketi yapma; talep zaten alındı.

${CHIP_RULES}

${TONE}`;
}

export type FollowUpResult =
  | { type: "reply"; text: string; chips: string[] }
  | { type: "contact"; text: string; contact: AddContactInputT };

export async function runFollowUpTurn(history: ChatMessage[], hasContact: boolean): Promise<FollowUpResult> {
  const system = buildFollowUpPrompt(hasContact, salesEmail());
  const messages = toApiMessages(history);
  const tools = hasContact ? [] : [ADD_CONTACT_TOOL];

  for (let i = 0; i < 2; i++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 600,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
      output_config: { effort: "low" },
    });

    if (response.stop_reason === "refusal") {
      return { type: "reply", text: "Bu konuda yardımcı olamıyorum. NextReach ile ilgili başka bir sorunuz var mı?", chips: [] };
    }

    const rawText = textOf(response);
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) {
      const { text, chips } = splitChips(rawText);
      return { type: "reply", text: text || "Başka nasıl yardımcı olabilirim?", chips };
    }

    const parsed = AddContactInput.safeParse(toolUse.input);
    messages.push({ role: "assistant", content: response.content });
    if (!parsed.success) {
      const issues = parsed.error.issues.map((iss) => iss.message).join("; ");
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Kaydedilemedi: ${issues}. Ziyaretçiden bilgiyi teyit et.` }],
      });
      continue;
    }

    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "İletişim bilgisi talebe eklendi. Tek cümle teşekkür et; ekibin 1 iş günü içinde döneceğini söyle. Çip verme." }],
    });
    const closing = await client().messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages,
      tools,
      output_config: { effort: "low" },
    });
    const combined = [splitChips(rawText).text, splitChips(textOf(closing)).text].filter(Boolean).join("\n\n");
    return { type: "contact", text: combined || "Teşekkürler, iletişim bilginizi talebinize ekledim. Ekibimiz 1 iş günü içinde dönecek.", contact: parsed.data };
  }

  return { type: "reply", text: "Bilgiyi kaydedemedim. E-posta ya da telefonunuzu bir kez daha yazabilir misiniz?", chips: [] };
}

// ---------------------------------------------------------------------------
// 2) Analiz: skor, aciliyet, spam, iletişim çıkarımı
// ---------------------------------------------------------------------------

const AnalysisOutput = z.object({
  is_spam: z.boolean().describe("Anlamsız, alakasız, otomatik ya da kötü niyetli içerik mi?"),
  spam_reason: z.string().nullable(),
  need_clarity: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("İhtiyaç netliği: 0 belirsiz ya da yok; 1 genel ('raporlama lazım'); 2 somut problem ('ürün bazlı kârlılığı göremiyoruz'); 3 somut problem + ölçülebilir etki ya da örnek ('haftada bir gün Excel'e gidiyor')."),
  product_fit: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("Ürün uyumu (NextReach orta ölçekli e-ticaret firmalarına analitik dashboard'u satar): 0 alakasız, öğrenci, rakip ya da e-ticaret değil; 1 e-ticaret ama çok küçük ya da belirsiz; 2 orta ölçekli e-ticaret; 3 orta ölçekli + bilinen platform + çok kanallı ya da analitik ihtiyacı doğrudan ürünle örtüşüyor."),
  timeline_score: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe("Zamanlama: 0 belirsiz ya da sadece araştırıyor; 1 bu yıl içinde; 2 bu ay ya da 1-3 ay içinde ya da net bir tetikleyici (sezon, mevcut aracın bitmesi)."),
  authority: z
    .number()
    .int()
    .min(0)
    .max(1)
    .describe("Karar yetkisi: 1 karar verici ya da ortak karar verici (sahip, ortak, yönetici); 0 belirsiz ya da başkası adına araştırıyor."),
  urgency: z.enum(["none", "normal", "urgent"]).describe("Ziyaretçinin zaman baskısı: urgent = bu ay / sezon öncesi / mevcut araç bitiyor; normal = birkaç ay içinde; none = belirsiz ya da sadece araştırıyor."),
  score_reason: z.string().describe("Satış ekibi için tek cümle: puanı en çok ne yükseltti ya da düşürdü, aciliyet neden böyle."),
  extracted_email: z.string().nullable().describe("Profilde yoksa ama sohbette geçiyorsa e-posta; yoksa null."),
  extracted_phone: z.string().nullable().describe("Profilde yoksa ama sohbette geçiyorsa telefon; yoksa null."),
  extracted_name: z.string().nullable().describe("Profilde yoksa ama sohbette geçiyorsa isim; yoksa null."),
  extracted_company: z.string().nullable().describe("Profilde yoksa ama sohbette geçiyorsa şirket adı; yoksa null."),
});
export type AnalysisOutputT = z.infer<typeof AnalysisOutput>;

/** Alan doluluk oranı: kod tarafında hesaplanır, modele girdi olarak verilir. */
export function computeCompleteness(profile: FinalizeInputT): number {
  const fields: Array<string | null | undefined> = [
    profile.name,
    profile.company,
    profile.email ?? profile.phone,
    profile.store_size ?? profile.scale,
    profile.goal_or_problem,
    isUnknown(profile.current_setup) ? null : profile.current_setup,
    isUnknown(profile.timeline) ? null : profile.timeline,
    profile.decision_role,
  ];
  const filled = fields.filter((f) => f && f.trim().length > 0).length;
  return Math.round((filled / fields.length) * 100) / 100;
}

/** Puan: modelin bileşenleri + koddan gelen iletişim bileşeni. Toplamı kod hesaplar. */
export function scoreFromAnalysis(a: AnalysisOutputT, hasContact: boolean): { points: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    need_clarity: a.need_clarity,
    product_fit: a.product_fit,
    timeline: a.timeline_score,
    authority: a.authority,
    contact: hasContact ? 1 : 0,
  };
  return { points: totalScore(breakdown), breakdown };
}

export function toNeedProfile(profile: FinalizeInputT): NeedProfile {
  return {
    goal_or_problem: profile.goal_or_problem,
    current_setup: profile.current_setup,
    timeline: profile.timeline,
    scale: profile.scale,
    decision_role: profile.decision_role,
    specific_questions: profile.specific_questions,
  };
}

export async function analyzeLead(profile: FinalizeInputT, transcript: ChatMessage[], completeness: number): Promise<AnalysisOutputT> {
  const transcriptText = transcript.map((m) => `${m.role === "user" ? "Ziyaretçi" : ASSISTANT_NAME}: ${m.content}`).join("\n");

  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system:
      "Sen NextReach satış ekibi için lead değerlendirme analistisin. NextReach orta ölçekli e-ticaret firmalarına analitik dashboard'u satar. Puanı sen vermezsin; rubrikteki dört bileşeni seçersin (ihtiyaç netliği 0-3, ürün uyumu 0-3, zamanlama 0-2, karar yetkisi 0-1), iletişim bileşenini ve toplamı kod hesaplar. Her bileşeni iki kaynağa birlikte dayandır: (1) profil alanları ve doluluk oranı, (2) sohbetin tamamındaki bağlam ve niyet. Tek tarafa bağlı kalma: alanlar dolu ama niyet zayıfsa düşür; alanlar eksik ama niyet ve zamanlama netse yükselt. Profilde eksik olan isim/şirket/e-posta/telefon sohbette geçiyorsa çıkar. Gerekçe tek cümle.",
    messages: [
      {
        role: "user",
        content: `## Alan doluluk oranı
${Math.round(completeness * 100)}%

## Sohbetten toplanan profil
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
      need_clarity: 1,
      product_fit: 1,
      timeline_score: 0,
      authority: 0,
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
