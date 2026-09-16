# NextReach — Web Chatbot İletişim Agent'ı

Landing page'de sağ altta duran bir asistan (**Reach**), ziyaretçiyi kısa bir baloncukla karşılar. Form yok: ziyaretçinin **neye ihtiyacı olduğunu**, kim olduğunu ve ekibin ona nasıl ulaşabileceğini konuşarak öğrenir; satış ekibinin harekete geçebileceği bir ihtiyaç profili çıkarır ve talebi kaydeder. Ekip, `/admin` altındaki iç görünümden "bugün kim, neden ulaşmış" sorusunu tek bakışta cevaplar.

**Repo:** https://github.com/KadirCanTufek/nextreach-chatbot
**Canlı link:** https://nextreach-chatbot-tau.vercel.app
**Admin:** https://nextreach-chatbot-tau.vercel.app/admin (erişim anahtarı ile)
**Toplam süre:** _(teslimde doldurulacak)_

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
| `DATABASE_URL` | Neon Postgres bağlantı dizesi (pooled) |
| `ADMIN_KEY` | `/admin` girişi için tek erişim anahtarı (uzun ve rastgele seçin) |

Yararlı komutlar:

| Komut | Ne yapar |
|---|---|
| `npm run test:chat` | Veritabanı olmadan yalnızca sohbet motorunu dener: senaryolu bir ziyaretçi ile uçtan uca konuşma, profil ve analiz çıktısı |
| `npm run typecheck` / `npm run lint` | Tip ve lint kontrolü |

Deploy: Vercel'e bağlayın, aynı üç değişkeni Environment Variables'a girin. Şemayı bir kez `npm run db:setup` ile uygulayın. Fonksiyon bölgesi `vercel.json` ile Frankfurt'a (fra1) sabitlendi; Neon da aynı bölgede.

---

## Teknoloji seçimi ve gerekçesi

| Katman | Seçim | Neden |
|---|---|---|
| Uygulama | **Next.js 16 (App Router) + TypeScript + Tailwind 4** | Tek repo, tek deploy. Frontend, API route'ları ve auth proxy'si aynı projede. Vercel'e sıfır konfigürasyonla çıkıyor. |
| Sohbet motoru | **Claude Sonnet 5** (`@anthropic-ai/sdk`) | Türkçe doğal diyalog kalitesi yüksek, yapılandırılmış çıktı (tool use + `strict`) güvenilir. Kural tabanlı bir akış "konuşma" hissi vermiyor; tamamen LLM ama sınırları kodda. |
| Veri | **Neon Postgres** (`@neondatabase/serverless`) | Ücretsiz, serverless'a uygun. Talepleri listeleme ve filtreleme için ilişkisel DB doğal seçim. ORM kullanmadım; şema tek dosya (`src/lib/schema.sql`), sorgular okunabilir. |
| Doğrulama | **zod** | Hem HTTP isteklerini hem modelin araç çıktısını aynı şemayla doğruluyor. "Yeter" kuralları da burada. |
| Arayüz hareketi | **beUI** (shadcn registry) + **motion** | Admin'de sekmeler, yan panel, rozet ve sayaç animasyonları; widget'ta panel, baloncuk ve çip geçişleri. Bileşenler projeye kaynak olarak kopyalanır (`src/components/motion`), dış bağımlılık `motion`. Küçük hareketler "form" hissini kırıyor. |
| Auth | Yok (kapsam dışı). Admin için **env'den tek erişim anahtarı** + httpOnly cookie | Auth sistemi PRD'de kapsam dışı; ama admin'i açıkta bırakmak istemedim. 15 dakikalık basit koruma. |

---

## PRD'de muğlak bırakılan yerleri nasıl yorumladım

### 1. Chatbot ne soracak, hangi sırayla, ne zaman "yeter" diyecek?

**Form yok, her şey sohbette.** İlk sürümde kısa bir tanışma formu (isim, e-posta, şirket) ve ardından sohbet vardı. Araştırma ve tartışma sonunda kaldırdım: "Nasıl yardımcı olabilirim?" diye seslenip tıklayanın önüne form çıkarmak, PRD'deki "form çok soğuk" şikayetini küçültülmüş halde geri getiriyor. Veriler de aynı yöne işaret ediyor: statik formlar %2-3, sohbet %15-25 dönüşüm; teknoloji alıcılarının %81'i formu doldurmuyor, %71'i tanımadığı satıcıyla bilgi paylaşmak istemediği için. Bu yüzden iletişim bilgisi **değer verildikten sonra** istenir.

**Omurga:**
1. İhtiyaç önce. İlk mesaja yansıtma + tek derinleştirme sorusu.
2. İkinci-üçüncü mesajda isim sorusu: "Size hitap edebilmem için isim ve soyisminizi alabilir miyim?"
3. Şirket bilgileri sohbetin içine yayılır: marka adı (serbest metin), platform, mağaza büyüklüğü, rol. Yapısal olanlar **çiplerle** sorulur (Shopify | ikas | Ticimax | T-Soft | Diğer gibi): mobilde yazmayı azaltır, veriyi standartlaştırır.
4. Zorunlu üç başlık dolunca, özetten **hemen önce** iletişim istenir ve nedeni söylenir: "Ekibin 1 iş günü içinde dönmesi için e-posta ya da telefon, biri yeter." Bir kez istenir; vermezse ısrar yok.
5. 2-3 satır özet + "eksik var mı?" → onay → kayıt.

Asistanın sohbette anlamak *zorunda* olduğu üç şey: **hedef veya problem** (somut, "raporlama" değil), **mevcut durum** (platform, bugünkü raporlama yöntemi), **zamanlama** (ne zaman, tetikleyen ne).

**"Yeter" kararı modele bırakılmış ama kodla sınırlandırılmış.** Model sohbeti yalnızca `finalize_conversation` aracını çağırarak bitirebilir. Bu aracın girdisi zod ile doğrulanır ve şu kurallar sağlanmadan araç hata döner, model sormaya devam eder:
- Üç zorunlu başlık somut olmalı; "bilinmiyor" ancak ziyaretçi iki kez sorulmasına rağmen açıkça reddettiyse kabul edilir (`declined_fields`).
- İletişim bilgisi en az bir kez, gerekçesiyle istenmiş olmalı (`contact_requested`); verilmiş olması şart değil.
- Özet yazılmış ve ziyaretçi onaylamış olmalı (`visitor_confirmed`).
- En az 4 ziyaretçi mesajı geçmiş olmalı; erken bitişte (`ended_early`) neden yazılmalı.

Bu kuralları araç açıklamasına yazmak yetmedi: testte model platform sorusundan hemen sonra bitirmeye kalktı. Şemaya koyunca akış düzeldi. Yani model sırayı ve tonu yönetiyor; "yeter" çizgisini kod çiziyor.

Üç kapanış yolu: **normal** (özet + onay), **erken** (ziyaretçi "acelem var" der; iletişim tek cümleyle istenir, eldekiyle kapanır, admin'de "erken bitti" etiketi), **tur sınırı** (14 asistan mesajından sonra prompt "toparla" der; sohbet sonsuza uzamaz, maliyet sınırlı kalır).

**Çip protokolü:** Model, yapısal bir soru sorduğunda mesajın sonuna `[[chips: a | b | c]]` ekler. Sunucu bu satırı ayıklar, istemci çip olarak gösterir; tıklanan çip normal bir kullanıcı mesajı olarak gider. Ayrı bir API çağrısı ya da yapılandırılmış çıktı gerekmez, tek turda gelir.

### 2. Ton ve kişilik

Sıcak, profesyonel, "siz". Kısa cümleler, emoji yok, pazarlama dili yok. Meraklı bir danışman gibi: söyleneni yansıtır, tek soru sorar. Adı var (Reach) çünkü isimsiz asistan formdan farksız hissettirir. "Sadece fiyat sorabilir miyim?" şikayetine doğrudan cevap: fiyat sorulabilir; asistan "mağaza büyüklüğüne göre kademeli, ekip 1 iş günü içinde net teklif verir" der, rakam uydurmaz.

**Proaktif ama ölçülü.** Sağ altta başlatıcı her zaman görünür. Sayfa yüklendikten 6 saniye sonra tek satırlık bir baloncuk çıkar ("Merhaba, ben Reach…"), oturumda bir kez, kapatılabilir. Pencere kendiliğinden açılmaz; araştırma, zamansız açılan pencerelerin en çok şikayet edilen kalıp olduğunu gösteriyor. "Bize Ulaşın" butonları da aynı pencereyi açar (PRD'nin açık isteri).

### 3. Satış ekibi iyi lead'i kötüsünden nasıl ayırt edecek?

Sohbet bitince ikinci bir Claude çağrısı (yapılandırılmış çıktı) talebi değerlendirir. **İki kaynağı birlikte** kullanır: kodun hesapladığı **alan doluluk oranı** (8 alan) ve **sohbetin tamamındaki niyet**. Tek tarafa bağlı kalmaz: doluluk yüksek ama niyet zayıfsa düşürür, doluluk düşük ama zamanlama netse yükseltir. Profilde eksik kalan iletişim bilgisi sohbette geçiyorsa buradan çıkarılır ve admin'de "sohbetten" etiketiyle görünür.

Çıktı: **Sıcak / Ilık / Soğuk** etiketi, **aciliyet** (acil / normal / acil değil) ve tek cümlelik **gerekçe**. Sıcak = e-ticaret firması + net problem + yakın zamanlama.

### 4. Admin view'de ne var?

- **Üç sekme:** Nitelikli · İletişimsiz · Spam. Ekip gün içinde yalnızca ilkine bakar; diğerleri kaybolmaz ama önüne çıkmaz. Sekme sayaçları canlı.
- **Filtreler:** Bugün / Bu hafta / Tümü, skor, durum.
- **Skor rozeti, rengi aciliyeti gösterir:** yeşil acil değil, sarı normal, kırmızı acil (acil olanlar hafifçe nabız atar). Üstte renk rehberi var. Tek rozetle iki bilgi.
- **Satıra tıkla → sağdan panel** (Notion tarzı): iletişim bilgileri tıklanabilir (mailto / tel), satış için özet, ihtiyaç profili, değerlendirme gerekçesi, doluluk, tam sohbet.
- **Durum takibi:** Yeni → Arandı → Kapandı; değişiklikte kısa bir bildirim.

### 5. Kötü niyetli kullanım (spam, boş talep, bot)

Katmanlı:
- **Honeypot:** pencerede görünmeyen bir alan. Dolu gelirse LLM'e gidilmez, bota "başarılı" görünen sahte cevap döner.
- **Zamanlama:** sohbet açıldıktan 3 saniye içinde biten bir talep insan hızında değildir; kaydedilmez.
- **IP rate limit** (Postgres'te): dakikada 20, saatte 120 mesaj; günde 5 talep. Oturum başına 40 mesaj, mesaj başına 1000 karakter. LLM maliyetini de sınırlar.
- **Tur sınırı:** 14 asistan mesajı; sohbet sonsuza uzayamaz.
- **LLM spam sınıflandırması:** analiz aşamasında anlamsız/alakasız içerik `spam` sekmesine düşer, silinmez.
- Tüm doğrulama sunucuda tekrar yapılır; istemciye güvenilmez.

### 6. Ziyaretçi bir soruya cevap vermek istemezse?

- İsteğe bağlı soruysa hemen geçilir. Zorunluysa asistan nedenini bir cümleyle söyler ve bir kez daha nazikçe ister; yine vermezse "belirtilmedi" kabul eder, `declined_fields`'a yazar ve devam eder. Akış hiçbir noktada kilitlenmez.
- İletişim bilgisi vermek istemezse: ısrar yok. Talep **İletişimsiz** sekmesine düşer; satış arayamaz ama pazarlama "insanlar ne soruyor" diye okuyabilir. Analiz, sohbette geçen bir e-posta/telefon varsa yakalar.

---

## 6 saatte yapamadıklarım, daha fazla zamanda ne eklerdim

- **Streaming cevap.** Asistan cevabı tek parça geliyor; "yazıyor" animasyonu var ama token akışı yok. Soğuk başlangıçta ilk cevap uzun sürebiliyor; ilk ekleyeceğim şey bu.
- **Oturum kalıcılığı.** Sayfa yenilenirse sohbet gider. `sessionStorage` ile 10 dakikalık iş.
- **Sayfaya özel karşılama.** Fiyatlandırma bölümünden gelen ziyaretçiye farklı baloncuk; araştırmaya göre %25-35 daha iyi etkileşim.
- **Cloudflare Turnstile.** Rate limit ve honeypot yeterli başlangıç; hedefli bot trafiği için görünmez captcha.
- **E-posta bildirimi.** Kapsam dışıydı; Resend ile "yeni sıcak lead" maili 20 dakika.
- **Admin'de arama ve sayfalama.** 500 kayıt limiti var, arama yok.
- **Eval seti.** `scripts/test-chat.mts` tek senaryo; 20-30 senaryoyla "yeter" kararının ve skorlamanın tutarlılığını sayıyla ölçmek isterim.
- **Prompt cache.** Sistem promptu her turda küçük değişiyor (tur sayacı). Sayacı kullanıcı mesajına taşıyıp sistem promptunu sabitlemek cache'i açar.

---

## Proje yapısı

```
src/
  app/
    page.tsx                  Landing page; "Bize Ulaşın" butonları widget'ı açar
    admin/page.tsx            İç görünüm (sekmeler, filtreler, sağ panel, durum)
    admin/login/page.tsx      Erişim anahtarı girişi
    api/chat/route.ts         Sohbet turu: honeypot, rate limit, LLM, talep kaydı
    api/admin/*               Liste, durum güncelleme, giriş/çıkış
  components/
    ChatWidget.tsx            Başlatıcı, baloncuk, panel, çipler
    motion/*                  beUI bileşenleri (registry'den kopyalanmış)
  lib/
    chat-config.ts            Karşılama metni, çipler, baloncuk zamanlaması
    claude.ts                 Sistem promptu, finalize aracı ve "yeter" kuralları, çip protokolü, analiz
    db.ts                     Neon sorguları
    rate-limit.ts             IP limitleri
    admin-auth.ts             Anahtar/cookie doğrulaması
    schema.sql                Veri şeması
  proxy.ts                    /admin ve /api/admin koruması
scripts/
  db-setup.mjs                Şemayı uygular
  test-chat.mts               DB'siz uçtan uca sohbet testi
```
