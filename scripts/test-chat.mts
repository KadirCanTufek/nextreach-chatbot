// DB olmadan yalnızca Claude katmanını dener: `npm run test:chat`
// Ziyaretçi, asistanın sorusuna anahtar kelimeyle tepki veren basit bir kural motoru.
import { GREETING, analyzeLead, computeCompleteness, runChatTurn } from "../src/lib/claude";
import type { ChatMessage } from "../src/lib/types";

const persona = {
  name: "Ayşe Yılmaz",
  company: "Moda Evi",
  email: "ayse@modaevi.com",
};

function answer(question: string, chips: string[], turn: number): string {
  // 1) Çip varsa kategorisine göre seç (gerçek kullanıcı da çoğunlukla çipe basar)
  const chipHas = (k: string) => chips.find((c) => c.toLowerCase().includes(k.toLowerCase()));
  if (chipHas("shopify") || chipHas("ikas")) return "ikas";
  if (chipHas("500-2.000")) return chipHas("500-2.000")!;
  if (chipHas("sahibi")) return chipHas("sahibi")!;
  if (chipHas("bu ay") || chipHas("1-3 ay")) return "Kasım indirimlerinden önce oturmuş olsun istiyoruz, ekim sonu gibi.";
  if (chipHas("e-posta bırak")) return chipHas("e-posta bırak")!;
  if (chipHas("doğru")) return chipHas("doğru")!;

  // 2) Çip yoksa sorunun son cümlesine bak
  const sentences = question.replace(/\n+/g, " ").split(/(?<=[.?!])\s+/).filter(Boolean);
  const last = (sentences[sentences.length - 1] ?? question).toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => last.includes(k));
  if (has("hitap", "isminiz", "soyisminiz", "adınız", "nasıl seslen")) return persona.name;
  if (has("e-posta", "telefon", "numara", "ulaşabil", "iletişim bilgi", "iletişime geç", "adresinizi")) return persona.email;
  if (has("marka", "şirket", "firma", "mağazanızın adı", "hangi mağaza")) return persona.company;
  if (has("platform", "altyapı", "shopify", "ikas", "ticimax")) return "ikas";
  if (has("sipariş", "büyüklü", "hacim", "ölçek")) return "Aylık 1500 sipariş civarı";
  if (has("ürün grubu", "sektör", "ne satıyor", "kategori")) return "Kadın giyim";
  if (has("ne zaman", "zamanlama", "başlamay", "tarih", "sezon", "acele")) return "Kasım indirimlerinden önce oturmuş olsun istiyoruz, ekim sonu gibi.";
  if (has("rol", "karar", "pozisyon", "unvan")) return "Sahibiyim, ortağımla birlikte karar veriyoruz";
  if (has("eksik", "eklemek", "doğru mu", "onayl")) return "Doğru, iletin";
  if (has("excel", "takip", "rapor", "nasıl yapıyor", "hangi araç", "şu an")) return "Raporları Excel'e çekip elle birleştiriyoruz, haftada bir gün gidiyor.";
  if (turn === 0) return "Reklam harcamamız artıyor ama hangi ürünler gerçekten kâr bırakıyor bilmiyoruz.";
  return "Ürün bazında kârlılığı görmek istiyoruz; reklam bütçesini ona göre dağıtacağız.";
}

const messages: ChatMessage[] = [{ role: "assistant", content: GREETING }];
console.log(`Reach: ${GREETING}\n`);

let finalized = null;
let lastChips: string[] = [];
for (let turn = 0; turn < 16; turn++) {
  const lastAssistant = messages[messages.length - 1].content;
  const line = answer(lastAssistant, lastChips, turn);
  messages.push({ role: "user", content: line });
  console.log(`Ziyaretçi: ${line}`);
  const t0 = Date.now();
  const result = await runChatTurn(messages);
  const chipsNote = result.type === "reply" && result.chips.length ? `  [çipler: ${result.chips.join(" | ")}]` : "";
  console.log(`Reach (${Date.now() - t0} ms): ${result.text}${chipsNote}\n`);
  messages.push({ role: "assistant", content: result.text });
  lastChips = result.type === "reply" ? result.chips : [];
  if (result.type === "finalized") {
    finalized = result.profile;
    break;
  }
}

if (!finalized) {
  console.log("!! Sohbet 16 turda finalize olmadı.");
  process.exit(1);
}

console.log("=== Profil ===");
console.log(JSON.stringify(finalized, null, 2));
const completeness = computeCompleteness(finalized);
const t1 = Date.now();
const analysis = await analyzeLead(finalized, messages, completeness);
console.log(`\n=== Analiz (${Date.now() - t1} ms, doluluk ${Math.round(completeness * 100)}%) ===`);
console.log(JSON.stringify(analysis, null, 2));
