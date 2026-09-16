// DB olmadan yalnızca Claude katmanını dener: `npm run test:chat`
import { analyzeLead, computeCompleteness, runChatTurn } from "../src/lib/claude.ts";
import type { ChatMessage, Visitor } from "../src/lib/types.ts";

const visitor: Visitor = {
  name: "Ayşe Yılmaz",
  email: "ayse@modaevi.com",
  company: "Moda Evi",
  storeSize: "",
  anonymous: false,
};

// Senaryolu ziyaretçi: sırayla bu cevapları verir.
const script = [
  "Merhaba, biz kadın giyim satıyoruz. Reklam harcamamız artıyor ama hangi ürünler gerçekten kâr bırakıyor bilmiyoruz.",
  "ikas kullanıyoruz. Raporları Excel'e çekip elle birleştiriyoruz, haftada bir gün gidiyor.",
  "Aylık 3000 civarı sipariş. Kararı ben veriyorum, ortağımla birlikte.",
  "Kasım indirimlerinden önce oturmuş olsun istiyoruz, yani ekim sonu gibi. Fiyat ne kadar?",
  "Evet doğru, eklemek istediğim yok.",
  "Teşekkürler.",
];

const messages: ChatMessage[] = [
  { role: "assistant", content: "Merhaba Ayşe, ben Reach. Analitik tarafında şu an sizi en çok ne zorluyor?" },
];
console.log(`Reach: ${messages[0].content}\n`);

let finalized = null;
for (const line of script) {
  messages.push({ role: "user", content: line });
  console.log(`Ziyaretçi: ${line}`);
  const t0 = Date.now();
  const turn = await runChatTurn(visitor, messages);
  console.log(`Reach (${Date.now() - t0} ms): ${turn.text}\n`);
  messages.push({ role: "assistant", content: turn.text });
  if (turn.type === "finalized") {
    finalized = turn.profile;
    break;
  }
}

if (!finalized) {
  console.log("!! Sohbet senaryo bitmeden finalize olmadı.");
  process.exit(1);
}

console.log("=== İhtiyaç profili ===");
console.log(JSON.stringify(finalized, null, 2));

const completeness = computeCompleteness(visitor, finalized);
const t1 = Date.now();
const analysis = await analyzeLead(visitor, finalized, messages, completeness);
console.log(`\n=== Analiz (${Date.now() - t1} ms, doluluk ${Math.round(completeness * 100)}%) ===`);
console.log(JSON.stringify(analysis, null, 2));
