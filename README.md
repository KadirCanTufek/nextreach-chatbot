# NextReach — Web Chatbot İletişim Agent'ı

Landing page'deki "Bize Ulaşın" butonuna tıklayan ziyaretçiyi soğuk bir form yerine bir sohbet karşılar. Kısa bir tanışma adımından sonra asistan (adı **Reach**) ziyaretçinin **neye ihtiyacı olduğunu** konuşarak anlar, satış ekibinin harekete geçebileceği bir ihtiyaç profili çıkarır ve talebi kaydeder. Ekip, `/admin` altındaki iç görünümden "bugün kim, neden ulaşmış" sorusunu tek bakışta cevaplar.

**Canlı link:** _(deploy sonrası eklenecek)_
**Toplam süre:** _(README teslimde doldurulacak)_

---

## Nasıl çalıştırılır (lokal)

```bash
npm install
cp .env.example .env.local     # üç anahtarı doldurun
npm run db:setup               # Neon'a şemayı uygular
npm run dev                    # http://localhost:3000
```

`.env.local` içeriği:

| Değişken | Açıklama |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API anahtarı |
| `DATABASE_URL` | Neon Postgres bağlantı dizesi |
| `ADMIN_KEY` | `/admin` girişi için tek erişim anahtarı (uzun ve rastgele seçin) |

Admin görünümü: `http://localhost:3000/admin` → `ADMIN_KEY` ile giriş.

Deploy: Vercel'e bağlayın, aynı üç değişkeni Environment Variables'a girin. Neon'u Vercel Marketplace'ten eklerseniz `DATABASE_URL` otomatik gelir. Şemayı bir kez `npm run db:setup` ile uygulayın.

---

## Teknoloji seçimi ve gerekçesi

| Katman | Seçim | Neden |
|---|---|---|
| Uygulama | **Next.js 16 (App Router) + TypeScript + Tailwind** | Tek repo, tek deploy. Frontend, API route'ları ve auth proxy'si aynı projede. Vercel'e sıfır konfigürasyonla çıkıyor. |
| Sohbet motoru | **Claude Sonnet 5** (`@anthropic-ai/sdk`) | Türkçe doğal diyalog kalitesi yüksek, yapılandırılmış çıktı (tool use + `strict`) güvenilir. 6 saatte kural tabanlı bir akış yazmaktan daha iyi "konuşma" hissi veriyor. |
| Veri | **Neon Postgres** (`@neondatabase/serverless`) | Ücretsiz, serverless'a uygun, Vercel entegrasyonu tek tık. Talepleri listeleme ve filtreleme için ilişkisel DB doğal seçim. ORM kullanmadım; şema tek dosya (`src/lib/schema.sql`), sorgular okunabilir. |
| Doğrulama | **zod** | Hem HTTP isteklerini hem modelin araç çıktısını aynı şemayla doğruluyor. |
| Auth | Yok (kapsam dışı). Admin için **env'den tek erişim anahtarı** + httpOnly cookie | Auth sistemi PRD'de kapsam dışı; ama admin'i açıkta bırakmak istemedim. 15 dakikalık basit koruma. |

---

## PRD'de muğlak bırakılan yerleri nasıl yorumladım

### 1. Chatbot ne soracak, hangi sırayla, ne zaman "yeter" diyecek?

**İki adım.** Önce kısa bir tanışma: isim, iş e-postası, şirket (zorunlu) ve mağaza büyüklüğü (isteğe bağlı). Bunlar konuşarak sorulacak şeyler değil; form üç saniyede dolar ve satışın "kim bu" sorusunu peşinen kapatır. Sonra sohbet başlar ve asıl iş burada: **ihtiyacı derinleştirmek.**

Asistanın sohbette anlamak *zorunda* olduğu üç şey var:
1. **Hedef veya problem** — analitikle ne çözmek istiyor? ("Raporlama" değil, "hangi ürünün kâr getirdiğini göremiyoruz" seviyesinde.)
2. **Mevcut durum** — hangi e-ticaret platformu, raporlamayı şu an nasıl yapıyor?
3. **Zamanlama** — ne zaman başlamak istiyor, tetikleyen bir şey var mı?

İsteğe bağlı olarak en fazla bir kez sorduğu: ölçek (sipariş/ürün/ekip) ve karar rolü.

**"Yeter" kararı modele bırakılmış ama şemayla sınırlandırılmış.** Model sohbeti yalnızca `finalize_conversation` aracını çağırarak bitirebilir. Bu aracın şemasında üç zorunlu alan var ve kod tarafında zod ile doğrulanıyor: hedef en az bir cümle olmalı, özet en az 40 karakter olmalı. Şema reddederse araç çağrısı hata olarak modele geri döner ve model eksik olanı sormaya devam eder. Yani model sırayı ve tonu yönetiyor; "yeter" çizgisini şema çiziyor.

Üç kapanış yolu:
- **Normal:** üç zorunlu başlık dolu, açık soru yok → 2-3 satır özet + "eksik var mı?" → onay → finalize.
- **Erken:** ziyaretçi "acelem var" / "bu kadar" derse elindekiyle özetler ve `ended_early=true` ile kapatır.
- **Tur sınırı:** 8 asistan mesajından sonra sistem promptu "yeni soru sorma, özetle" der. Sohbet sonsuza uzamaz, maliyet sınırlı kalır.

### 2. Ton ve kişilik

Sıcak, profesyonel, "siz". Kısa cümleler, emoji yok, pazarlama dili yok. Meraklı bir danışman gibi: söyleneni yansıtır, tek soru sorar. Adı var (Reach) çünkü isimsiz asistan formdan farksız hissettirir. "Sadece fiyat sorabilir miyim?" şikayetine doğrudan cevap: fiyat sorulabilir, asistan "mağaza büyüklüğüne göre kademeli, ekip 1 iş günü içinde net teklif verir" der, rakam uydurmaz.

### 3. Satış ekibi iyi lead'i kötüsünden nasıl ayırt edecek?

Sohbet bitince ikinci bir Claude çağrısı (yapılandırılmış çıktı) talebi değerlendirir. **İki kaynağı birlikte** kullanır: kodun hesapladığı **alan doluluk oranı** ve **sohbetin tamamındaki niyet**. Tek tarafa bağlı kalmaz: doluluk yüksek ama niyet zayıfsa düşürür, doluluk düşük ama zamanlama netse yükseltir.

Çıktı: **Sıcak / Ilık / Soğuk** etiketi, **aciliyet** (acil / normal / acil değil) ve tek cümlelik **gerekçe**. Sıcak = e-ticaret firması + net problem + yakın zamanlama.

### 4. Admin view'de ne var?

- **Üç sekme:** Nitelikli · İletişimsiz · Spam. Ekip gün içinde yalnızca ilkine bakar; diğerleri kaybolmaz ama önüne çıkmaz.
- **Filtreler:** Bugün / Bu hafta / Tümü, skor, durum.
- **Skor rozeti, rengi aciliyeti gösterir:** yeşil acil değil, sarı normal, kırmızı acil. Üstte renk rehberi var. Tek rozetle iki bilgi.
- **Satıra tıkla → sağdan panel** (Notion tarzı): satış için özet, ihtiyaç profili, değerlendirme gerekçesi, doluluk, tam sohbet.
- **Durum takibi:** Yeni → Arandı → Kapandı.

### 5. Kötü niyetli kullanım (spam, boş talep, bot)

Katmanlı:
- **Honeypot:** formda görünmeyen bir alan. Dolu gelirse LLM'e gidilmez, bota "başarılı" görünen sahte cevap döner.
- **Zamanlama:** sohbet açıldıktan 3 saniye içinde biten bir talep insan hızında değildir; kaydedilmez.
- **IP rate limit** (Postgres'te): dakikada 20, saatte 120 mesaj; günde 5 talep. Oturum başına 40 mesaj, mesaj başına 1000 karakter. LLM maliyetini de sınırlar.
- **LLM spam sınıflandırması:** analiz aşamasında anlamsız/alakasız içerik `spam` sekmesine düşer, silinmez.
- **Form doğrulaması** sunucuda tekrar yapılır; istemciye güvenilmez.

### 6. Ziyaretçi bir soruya cevap vermek istemezse?

- Sohbette: isteğe bağlı soruysa hemen geçilir. Zorunluysa asistan nedenini bir cümleyle söyler ve bir kez daha nazikçe ister; yine vermezse "belirtilmedi" kabul eder ve devam eder. Akış hiçbir noktada kilitlenmez.
- Formda: "Şimdilik bilgi vermeden soru sormak istiyorum" bağlantısı var. Anonim sohbet sonunda analiz, konuşmada geçen e-posta/telefon/isim varsa çıkarır ve `sohbetten` etiketiyle kaydeder. Hiç iletişim yoksa talep **İletişimsiz** sekmesine düşer: satış arayamaz ama pazarlama "insanlar ne soruyor" diye okuyabilir.

---

## 6 saatte yapamadıklarım, daha fazla zamanda ne eklerdim

- **Streaming cevap.** Şu an asistan cevabı tek parça geliyor; "yazıyor" animasyonu var ama token akışı yok. İlk ekleyeceğim şey bu.
- **Oturum kalıcılığı.** Sayfa yenilenirse sohbet gider. `sessionStorage` ile 10 dakikalık iş.
- **Cloudflare Turnstile.** Rate limit ve honeypot yeterli başlangıç; hedefli bot trafiği için görünmez captcha.
- **E-posta bildirimi.** Kapsam dışıydı; Resend ile "yeni sıcak lead" maili 20 dakika.
- **Admin'de arama ve sayfalama.** 500 kayıt limiti var, arama yok.
- **Eval seti.** 20-30 örnek sohbetle "yeter" kararının ve skorlamanın tutarlılığını ölçmek. Prompt değişikliklerini gözle değil sayıyla test etmek isterim.
- **Prompt cache.** Sistem promptu her turda küçük değişiyor (tur sayacı). Sayacı kullanıcı mesajına taşıyıp sistem promptunu sabitlemek cache'i açar.

---

## Proje yapısı

```
src/
  app/
    page.tsx                  Landing page + "Bize Ulaşın" tetikleyici
    admin/page.tsx            İç görünüm (liste, filtre, sağ panel, durum)
    admin/login/page.tsx      Erişim anahtarı girişi
    api/chat/route.ts         Sohbet turu: honeypot, rate limit, LLM, talep kaydı
    api/admin/*               Liste, durum güncelleme, giriş/çıkış
  components/ChatWidget.tsx   İki adımlı widget: tanışma formu → sohbet
  lib/
    claude.ts                 Sistem promptu, finalize aracı, sohbet turu, analiz
    db.ts                     Neon sorguları
    rate-limit.ts             IP limitleri
    admin-auth.ts             Anahtar/cookie doğrulaması
    schema.sql                Veri şeması
  proxy.ts                    /admin ve /api/admin koruması
scripts/db-setup.mjs          Şemayı uygular
```
