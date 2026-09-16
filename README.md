# NextReach — Web Chatbot İletişim Agent'ı

Landing page'de sağ altta duran bir asistan (**Reach**), ziyaretçiyi kısa bir baloncukla karşılar. Form yok: ziyaretçinin **neye ihtiyacı olduğunu**, kim olduğunu ve ekibin ona nasıl ulaşabileceğini konuşarak öğrenir; satış ekibinin harekete geçebileceği bir ihtiyaç profili çıkarır ve talebi kaydeder. Ekip, `/admin` altındaki iç görünümden "bugün kim, neden ulaşmış" sorusunu tek bakışta cevaplar.

**Repo:** https://github.com/KadirCanTufek/nextreach-chatbot
**Canlı link:** https://nextreach-chatbot-tau.vercel.app
**Admin:** https://nextreach-chatbot-tau.vercel.app/admin (erişim anahtarı ile)
**Toplam süre:** ~4 saat 20 dakika, tek oturum (16 Eylül 2026, 11:02–15:20). Saat bazlı döküm: [TIMESHEET.md](TIMESHEET.md). Kalite ve güvenlik turu: [kalite-ve-guvenlik-raporu.md](kalite-ve-guvenlik-raporu.md).

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
| `SALES_EMAIL` | İsteğe bağlı. Kapanışta paylaşılan satış e-postası; boşsa yer tutucu `satis@nextreach.com` |

Yararlı komutlar:

| Komut | Ne yapar |
|---|---|
| `npm run test:chat` | Veritabanı olmadan yalnızca sohbet motorunu dener: senaryolu bir ziyaretçi ile uçtan uca konuşma, profil ve analiz çıktısı. `-- --scenario=decline` ile iletişim vermeyen ziyaretçi + devam modu senaryosu |
| `npm run db:migrate` | Var olan veritabanını yeni şemaya taşır (tekrar çalıştırılabilir); `db:setup` bunu zaten çağırır |
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
4. Zorunlu üç başlık dolunca, özetten **hemen önce** iletişim istenir ve nedeni söylenir: "Ekibin 1 iş günü içinde dönmesi için e-posta ya da telefon, biri yeter." Reddederse ikinci ve son kez, sonucunu ve sınırını söyleyerek istenir ("iletişim bilgisi olmadan ekibim size dönüş yapamıyor… yalnızca bu konuda kullanılır"). Yine reddederse ısrar yok.
5. 2-3 satır özet + "eksik var mı?" → onay → kayıt.

Asistanın sohbette anlamak *zorunda* olduğu üç şey: **hedef veya problem** (somut, "raporlama" değil), **mevcut durum** (platform, bugünkü raporlama yöntemi), **zamanlama** (ne zaman, tetikleyen ne).

**"Yeter" kararı modele bırakılmış ama kodla sınırlandırılmış.** Model sohbeti yalnızca `finalize_conversation` aracını çağırarak bitirebilir. Bu aracın girdisi zod ile doğrulanır; şu kurallar sağlanmadan araç çağrısı **reddedilir** ve model sormaya devam eder. Ret, ziyaretçiye görünen bir hata değildir: sunucu modele "şu eksik" diyen bir araç sonucu döner, model aynı turda bir sonraki soruyu yazar, ziyaretçi sadece o soruyu görür.
- Üç zorunlu başlık somut olmalı; "bilinmiyor" ancak ziyaretçi iki kez sorulmasına rağmen açıkça reddettiyse kabul edilir (`declined_fields`).
- İletişim bilgisi gerekçesiyle istenmiş olmalı (`contact_requested`); verilmediyse ikinci kez sonucu söylenerek istenmiş ve açık ret `declined_fields`'a yazılmış olmalı. Verilmiş olması şart değil.
- Özet yazılmış ve ziyaretçi onaylamış olmalı (`visitor_confirmed`).
- En az 4 ziyaretçi mesajı geçmiş olmalı; erken bitişte (`ended_early`) neden yazılmalı.

Bu kuralları araç açıklamasına yazmak yetmedi: testte model platform sorusundan hemen sonra bitirmeye kalktı. Şemaya koyunca akış düzeldi. Yani model sırayı ve tonu yönetiyor; "yeter" çizgisini kod çiziyor. Bedeli: her reddedilen deneme o turda bir ek model çağrısı (birkaç saniye); tur başına en fazla üç deneme, sonra genel bir soruya düşer.

Üç kapanış yolu: **normal** (özet + onay), **erken** (ziyaretçi "acelem var" der; iletişim tek cümleyle istenir, eldekiyle kapanır, admin'de "erken bitti" etiketi), **tur sınırı** (14 asistan mesajından sonra prompt "toparla" der; sohbet sonsuza uzamaz, maliyet sınırlı kalır).

**Çip protokolü:** Model, yapısal bir soru sorduğunda mesajın sonuna `[[chips: a | b | c]]` ekler. Sunucu bu satırı ayıklar, istemci çip olarak gösterir; tıklanan çip normal bir kullanıcı mesajı olarak gider. Ayrı bir API çağrısı ya da yapılandırılmış çıktı gerekmez, tek turda gelir.

**Akış (streaming):** Cevaplar kelime kelime gelir. Sunucu satır satır JSON olaylar yayınlar (`delta`, `reset`, `end`); istemci metni anında yazar, çip işaretini ekrana sızdırmamak için son köşeli parantezden sonrasını bekletir. Talep kaydedilirken analiz ve veritabanı yazımı kapanış cümlesinden sonra çalışır; ziyaretçi metni hemen görür, "iletildi" etiketi birkaç saniye sonra gelir. "Yeter" kuralı bir araç denemesini reddederse `reset` olayı ekrana yazılanı siler ve model yeniden yazar.

**Tarayıcı hafızası:** Sohbet `sessionStorage`'da tutulur; sayfa yenilense de kaldığı yerden ve aynı oturum kimliğiyle devam eder, panel açıksa açık kalır. Sekme kapanınca silinir.

### 2. Ton ve kişilik

Sıcak, profesyonel, "siz". Kısa cümleler, emoji yok, pazarlama dili yok. Meraklı bir danışman gibi: söyleneni yansıtır, tek soru sorar. Adı var (Reach) çünkü isimsiz asistan formdan farksız hissettirir. "Sadece fiyat sorabilir miyim?" şikayetine doğrudan cevap: fiyat sorulabilir; asistan "mağaza büyüklüğüne göre kademeli, ekip 1 iş günü içinde net teklif verir" der, rakam uydurmaz.

**Kapsam sınırı.** Asistan yalnızca NextReach, e-ticaret analitiği ihtiyacı ve ziyaretçinin talebiyle ilgilenir. Kod yazma, çeviri, ödev, genel bilgi, kişisel tavsiye, başka şirketlerin ürünleri gibi istekleri tek cümleyle reddeder ve konuya çağırır. Rakip kötülemez, fiyat rakamı ve sözleşme koşulu gibi sözler vermez ("ekip netleştirir"), talimat değiştirme denemelerine uymaz, hassas veri istemez, Türkçe hizmet verir. Konu dışı ısrar art arda ikinci kez olursa ya da hakaret varsa `end_conversation` aracıyla sohbeti kapatır: talep oluşmaz, yazı kutusu kapanır, "Yeni sohbet" seçeneği kalır. Test: `npm run test:chat -- --scenario=offtopic`.

**Proaktif ama ölçülü.** Sağ altta başlatıcı her zaman görünür. Sayfa yüklendikten 6 saniye sonra tek satırlık bir baloncuk çıkar ("Merhaba, ben Reach…"), oturumda bir kez, kapatılabilir. Pencere kendiliğinden açılmaz; araştırma, zamansız açılan pencerelerin en çok şikayet edilen kalıp olduğunu gösteriyor. "Bize Ulaşın" butonları da aynı pencereyi açar (PRD'nin açık isteri).

### 3. Satış ekibi iyi lead'i kötüsünden nasıl ayırt edecek?

**10 üzerinden puan, şeffaf rubrikle.** İlk sürümde Sıcak/Ilık/Soğuk etiketi vardı; kaba geldi ve "neden sıcak" sorusuna cevap vermiyordu. Şimdi sohbet bitince ikinci bir Claude çağrısı (yapılandırılmış çıktı) dört bileşeni puanlıyor, beşinciyi ve toplamı kod hesaplıyor:

| Bileşen | Puan | Ne bakılıyor |
|---|---|---|
| İhtiyaç netliği | 0-3 | Genel "raporlama" mı, somut problem mi, ölçülebilir etkisi söylendi mi |
| Ürün uyumu | 0-3 | Gerçek bir e-ticaret firması mı, ölçek, platform, ihtiyaç ürünle örtüşüyor mu |
| Zamanlama | 0-2 | Belirsiz / bu yıl / bu ay ya da tetikleyici var |
| Karar yetkisi | 0-1 | Karar verici ya da ortak karar verici mi |
| İletişim bilgisi | 0-1 | Koddan: e-posta ya da telefon var mı |

Model **sayı uydurmaz, bileşen seçer**; toplamı kod toplar. Değerlendirme iki kaynağa birlikte dayanır: profil alanları ve doluluk oranı, sohbetin tamamındaki niyet. Alanlar dolu ama niyet zayıfsa düşer, alanlar eksik ama zamanlama netse yükselir. Ziyaretçi iletişim bilgisini sonradan bırakırsa (devam modu) iletişim bileşeni 1'e çıkar ve toplam güncellenir.

Çıktı: rozette **7/10** gibi bir puan, detay panelinde bileşen çubukları ve tek cümlelik **gerekçe**; ayrıca **aciliyet** (acil / normal / acil değil). Filtre bantları: 8-10, 5-7, 0-4.

### 4. Admin view'de ne var?

- **Üç sekme:** Nitelikli · İletişimsiz · Spam. Ekip gün içinde yalnızca ilkine bakar; diğerleri kaybolmaz ama önüne çıkmaz. Sekme sayaçları canlı.
- **Filtreler:** Bugün / Bu hafta / Tümü, puan bandı, durum. **Arama kutusu** isim, şirket, e-posta, telefon ve ihtiyaç özetinde anında arar (istemcide; liste zaten yüklü).
- **Puan rozeti, rengi aciliyeti gösterir:** rozette 7/10 gibi puan; yeşil acil değil, sarı normal, kırmızı acil (acil olanlar hafifçe nabız atar). Üstte renk rehberi var. Tek rozetle iki bilgi.
- **Satıra tıkla → sağdan panel** (Notion tarzı): iletişim bilgileri tıklanabilir (mailto / tel), puan bileşenleri çubuklarla, gerekçe, satış için özet, ihtiyaç profili, doluluk, tam sohbet.
- **Durum takibi:** Bekliyor → İşlemde → Olumlu / Olumsuz. "Bekliyor" kimse dokunmadı demek; "İşlemde" ekip iletişime geçti; sonuç iki uçlu, böylece ekip kaç talebin müşteriye döndüğünü görür. Değişiklikte kısa bir bildirim.

### 5. Kötü niyetli kullanım (spam, boş talep, bot)

Katmanlı:
- **Zamanlama:** sohbet açıldıktan 3 saniye içinde biten bir talep insan hızında değildir; kaydedilmez.
- **En az 4 ziyaretçi mesajı** olmadan talep oluşmaz; tek mesajlık "spray" denemeleri kayda dönüşemez.
- **IP rate limit** (Postgres'te): dakikada 20, saatte 120 mesaj; günde 10 talep (aynı ofisten birkaç kişi deneyebilsin diye 5 değil 10). Günlük talep limiti aşılırsa sohbet normal biter ama talep kaydedilmez; bilinçli bir tercih, ayrıntısı karar notunda. Oturum başına 40 mesaj, mesaj başına 1000 karakter. LLM maliyetini de sınırlar.
- **Tur sınırı:** 14 asistan mesajı; sohbet sonsuza uzayamaz.
- **LLM spam sınıflandırması:** analiz aşamasında anlamsız/alakasız içerik `spam` sekmesine düşer, silinmez.
- **Kapsam sınırı:** konu dışı istekler reddedilir, ısrarda sohbet kapatılır (bkz. 2. bölüm). Botu genel amaçlı bir asistan gibi kullanmak mümkün değil.
- **Admin tarafı:** giriş denemesi IP başına 15 dakikada 10; admin API mutasyonları yalnızca aynı origin'den; güvenlik başlıkları (nosniff, frame DENY, referrer, permissions, HSTS). Ayrıntı: `kalite-ve-guvenlik-raporu.md`.
- Tüm doğrulama sunucuda tekrar yapılır; istemciye güvenilmez.

**Neden honeypot yok:** İlk sürümde vardı, formla birlikte kaldırdım. Honeypot, sayfadaki tüm alanları körlemesine dolduran basit form botlarını yakalar; artık gizli alan tıklanınca açılan bir panelin içinde olurdu ve o botlar paneli açmaz. API'ye doğrudan istek atan botlar ise gizli alanı zaten doldurmaz. Sohbet arayüzünde gerçek koruma rate limit, zamanlama, tur kuralları ve içerik sınıflandırmasıdır; hedefli bot trafiği için sıradaki adım Turnstile.

### 6. Ziyaretçi bir soruya cevap vermek istemezse?

- İsteğe bağlı soruysa hemen geçilir. Zorunluysa asistan nedenini bir cümleyle söyler ve bir kez daha nazikçe ister; yine vermezse "belirtilmedi" kabul eder, `declined_fields`'a yazar ve devam eder. Akış hiçbir noktada kilitlenmez.
- İletişim bilgisi vermek istemezse: **iki aşama, sonra saygı.** İlk istek gerekçeli. Reddedilirse ikinci ve son istek sonucu açıkça söyler: iletişim bilgisi olmadan ekip dönüş yapamaz, talep kayda geçer ama cevapsız kalır; bilgi yalnızca bu konuda kullanılır. Yine reddederse suçlama yok, "kapatıldı" yok: asistan notların ekibe iletildiğini, bu haliyle ulaşılamayacağını tek cümleyle söyler, kapıyı açık bırakır (bu pencere ya da satış e-postası) ve ürün sorularına devam etmeyi teklif eder. Talep **İletişimsiz** sekmesine düşer; satış arayamaz ama pazarlama "insanlar ne soruyor" diye okuyabilir.
- **Devam modu.** Talep iletildikten sonra yazı kutusu kapanmaz. Ziyaretçi soru sormaya devam edebilir; iletişim bilgisi bırakmadıysa fiyat/teklif/demo sorduğunda asistan cevabını verir ve tek cümleyle "net teklif için e-posta ya da telefon gerekir" diye hatırlatır. Sonradan e-posta veya telefon yazarsa `add_contact` aracıyla **aynı talebe eklenir**, talep İletişimsiz'den Nitelikli'ye geçer, sohbetin devamı da kayda işlenir. Yani "kapı açık" sözü gerçek.
- Kapanışta paylaşılan satış adresi (`satis@nextreach.com`) bir **yer tutucu**; PRD'de gerçek adres yok. `SALES_EMAIL` ortam değişkeniyle değiştirilir.

---

## 6 saatte neyi yapamadım, daha fazla zamanda ne eklerdim

PRD kapsamındaki isterlerin hepsi teslimde: landing page'de tetiklenen chatbot, saklanan talepler, ekibin listeleyebildiği iç görünüm, deploy ve bu README. Kapsam dışı bırakılanlar (auth, e-posta/SMS, mobil app, çok dilli) PRD'nin kendi kararı. Yapamadığım bir ister yok.

**Nice to have** (daha fazla zamanla eklerdim):
- **Sayfaya özel karşılama.** Şu an tek bir landing page var; iç sayfalar olsaydı fiyatlandırma sayfasından gelen ziyaretçiye farklı bir baloncuk metni eklenebilirdi. Araştırmaya göre sayfaya özel karşılama %25-35 daha iyi etkileşim veriyor.

---

## Proje yapısı

```
src/
  app/
    page.tsx                  Landing page; "Bize Ulaşın" butonları widget'ı açar
    admin/page.tsx            İç görünüm (sekmeler, filtreler, sağ panel, durum)
    admin/login/page.tsx      Erişim anahtarı girişi
    api/chat/route.ts         Sohbet turu (NDJSON akışı): rate limit, LLM, talep kaydı, devam modu
    api/admin/*               Liste, durum güncelleme, giriş/çıkış
  components/
    ChatWidget.tsx            Başlatıcı, baloncuk, panel, çipler, akış okuyucu, sessionStorage
    motion/*                  beUI bileşenleri (registry'den kopyalanmış)
  lib/
    chat-config.ts            Karşılama metni, çipler, baloncuk zamanlaması
    claude.ts                 Sistem promptu, finalize aracı ve "yeter" kuralları, çip protokolü, devam modu (add_contact), analiz
    db.ts                     Neon sorguları
    rate-limit.ts             IP limitleri
    admin-auth.ts             Anahtar/cookie doğrulaması
    schema.sql                Veri şeması
  proxy.ts                    /admin ve /api/admin koruması
kalite-ve-guvenlik-raporu.md  Kalite ve güvenlik turu: yöntem, bulgular, düzeltmeler, öneriler
TIMESHEET.md                  Saat bazlı çalışma dökümü
scripts/
  db-setup.mjs                Şemayı uygular, göçleri çalıştırır
  db-migrate.mjs              Göçler (skor → 10 puan + rubrik, durum adları)
  test-chat.mts               DB'siz uçtan uca sohbet testi
```
