# Kalite ve Güvenlik Raporu

**Proje:** NextReach Web Chatbot İletişim Agent'ı · **Tarih:** 16 Eylül 2026 · **Kapsam:** `main` dalının tamamı (uygulama kodu, scriptler, yapılandırma, canlı ortam).

## Yöntem

| Kontrol | Araç / yol | Sonuç |
|---|---|---|
| Tip güvenliği | `tsc --noEmit` (strict) | Hata yok |
| Statik analiz | ESLint (next/core-web-vitals + typescript) | Hata yok; kopyalanan beUI dosyaları için bir kural istisnası (`react-hooks/set-state-in-effect`), gerekçesi config'de |
| Üretim derlemesi | `next build` | Başarılı |
| Bağımlılık denetimi | `npm audit` (prod ve dev) | 0 zafiyet |
| Gizli bilgi taraması | `git grep`, `git log -p`, `.gitignore` kontrolü | Repoda ve geçmişte anahtar yok; `.env.local` ve `.vercel` izlenmiyor |
| Kod içi kalıp taraması | `dangerouslySetInnerHTML`, `eval`, ham SQL, `console.*`, env kullanımı | HTML enjeksiyonu yok; SQL yalnızca parametreli tagged template (tek ham sorgu kurulum scriptinde, kaynağı repo içindeki şema dosyası); tek `console.error` (hata izleme) |
| Elle inceleme | Kimlik doğrulama, yetkilendirme, girdi doğrulama, oran sınırlama, prompt güvenliği, veri gizliliği | Aşağıdaki bulgular |
| Davranış testleri | `scripts/test-chat.mts` (3 senaryo), Playwright görsel QA, canlı uçtan uca testler | Geçti |

## Bulgular ve durumları

Önem: **Y** yüksek, **O** orta, **D** düşük, **B** bilgi.

| # | Önem | Alan | Bulgu | Durum |
|---|---|---|---|---|
| 1 | O | HTTP başlıkları | Güvenlik başlıkları yoktu (nosniff, frame, referrer, permissions, HSTS). | **Düzeltildi.** `next.config.ts` tüm yollara başlık ekliyor; `X-Powered-By` kapatıldı. CSP bilinçli olarak eklenmedi (aşağıda). |
| 2 | O | Admin girişi | `/api/admin/login` deneme sınırı yoktu. Anahtar 48 hex karakter (192 bit) olduğu için kaba kuvvet pratikte imkânsız, ancak sınırsız deneme kabul etmek iyi pratik değil. | **Düzeltildi.** IP başına 15 dakikada 10 deneme; aşımda 429 ve kullanıcıya açık mesaj. Denemeler `rate_events` tablosunda (`kind = 'login'`, göç 003). |
| 3 | O | CSRF | Admin API çerezle yetkilendiriliyor; `SameSite=Lax` çoğu çapraz site isteğini engeller ancak tek savunma katmanıydı. | **Düzeltildi.** Proxy, `/api/admin/*` altındaki GET dışı istekleri yalnızca aynı origin'den kabul ediyor (Origin başlığı host ile eşleşmeli), aksi halde 403. |
| 4 | O | Veri bütünlüğü | Devam modunda istemcinin gönderdiği sohbet geçmişi kayıtlı transkriptin yerine yazılıyordu; ziyaretçi kendi talebinin geçmişini değiştirebilirdi. | **Düzeltildi.** Yalnızca o turun iki mesajı kayıtlı transkriptin sonuna ekleniyor. |
| 5 | D | Girdi doğrulama | Admin giriş gövdesinde anahtar uzunluğu sınırsızdı. | **Düzeltildi.** Tip ve 200 karakter sınırı. |
| 6 | B | Kimlik doğrulama | Tek erişim anahtarı; çerezde anahtarın kendisi değil SHA-256 özeti; karşılaştırma `timingSafeEqual`; çerez `httpOnly`, `secure` (üretim), 12 saat. Kullanıcı bazlı hesap ve denetim izi yok (PRD: auth kapsam dışı). | Kabul edildi; gerçek kullanımda gerçek auth önerilir. |
| 7 | B | Yetkilendirme | Devam modunda `leadId` yalnızca aynı `sessionId` ile eşleşirse işlenir; başkasının talebine erişim yok. Admin uçları proxy ile korunuyor. | Uygun. |
| 8 | B | Girdi doğrulama | Tüm API gövdeleri zod ile doğrulanıyor (mesaj sayısı ≤ 40, mesaj ≤ 1000 karakter, durum ve filtre enum'ları, UUID). Modelin araç çıktıları da zod ile doğrulanıyor; etiket artıkları temizleniyor. | Uygun. |
| 9 | B | Oran sınırlama | IP başına 20 mesaj/dk, 120 mesaj/saat, 10 talep/gün; oturum 40 mesaj; 14 asistan turu. IP, Vercel'in yazdığı `x-forwarded-for` ilk değerinden alınır. Günlük talep limiti aşımında sohbet biter ama talep kaydedilmez; bilinçli ürün kararı (karar notu bölüm 12). | Kabul edildi. |
| 10 | B | Prompt güvenliği | Kapsam kuralları: konu dışı ret, talimat değiştirmeye uymama, sistem talimatını açıklamama, söz vermeme, hassas veri istememe; ısrarda `end_conversation`. Model çıktısı araç şemalarıyla sınırlı; "yeter" kararı kodda. Sohbet metni ekranda yalnızca metin olarak (React kaçışlı) gösterilir. | Uygun; prompt enjeksiyonu tamamen engellenemez, etkisi kapsam ve şema ile sınırlandı. |
| 11 | B | Veri gizliliği | Talepler isim, e-posta, telefon ve sohbet metni içerir; yalnızca yetkili admin görür; Neon'a TLS ile bağlanılır; anahtarlar ortam değişkeninde. Loglarda kişisel veri yazılmıyor (tek hata logu istisna nesnesi). | Uygun; KVKK için saklama süresi ve silme politikası gerçek kullanımda tanımlanmalı. |
| 12 | B | Hata yönetimi | Beklenmeyen hatalar istemciye ayrıntı sızdırmadan tek bir mesaja indirgenir (503 ya da akışta `error` olayı). | Uygun. |
| 13 | D | Content-Security-Policy | CSP yok. Next.js inline script'leri nonce altyapısı gerektirir; 6 saatlik kapsamda risk/fayda dengesi eklenmemesi yönünde. HTML enjeksiyonu yüzeyi yok (kullanıcı metni hiçbir yerde HTML olarak işlenmez). | Öneri: nonce tabanlı CSP. |
| 14 | D | Bot doğrulaması | Turnstile/captcha yok. Trafik verisi (rate_events) bot izi göstermiyor; koruma rate limit + kapsam sınırı + tur kuralları. | Öneri: trafik gelince tabloya bakıp değerlendir. |
| 15 | D | Test kapsamı | Birim testi yok; davranış testleri gerçek modele bağlı (`test:chat`, 3 senaryo) ve Playwright görsel QA. CI yok. | Öneri: şema kuralları (`FinalizeInput`) ve `splitChips` için birim testleri; GitHub Actions ile tip/lint/build. |
| 16 | D | Erişilebilirlik | ARIA etiketleri, Escape ile kapatma, klavye ile gönderme var; sohbet panelinde odak tuzağı yok. | Öneri: odak tuzağı ve canlı bölge (`aria-live`) ile akış duyurusu. |
| 17 | D | Operasyon | Admin listesinde 500 kayıt tavanı, sayfalama yok; tek bölge (fra1); yedekleme Neon'un standart PITR'ı. | Kabul edildi. |

## Bu turda yapılan değişiklikler

- `next.config.ts`: güvenlik başlıkları, `poweredByHeader: false`.
- `src/proxy.ts`: admin API mutasyonlarında aynı origin zorunluluğu.
- `src/app/api/admin/login/route.ts`, `src/lib/rate-limit.ts`, `src/lib/db.ts`, `src/lib/schema.sql`, `scripts/db-migrate.mjs`: giriş denemesi sınırı ve `login` olay türü (göç 003, idempotent).
- `src/app/api/chat/route.ts`, `src/lib/db.ts`: devam modunda transkript ekleme (yerine yazma yerine).
- `src/app/admin/login/page.tsx`: sunucudan gelen hata mesajını gösterir (429 dahil).

## Kalite özeti

- Kod: TypeScript strict, ESLint temiz, tek sorumluluklu modüller (`claude.ts` prompt ve araçlar, `db.ts` sorgular, `rate-limit.ts`, `admin-auth.ts`), tipler tek dosyada paylaşılır; sunucu ve istemci arasında SDK sızıntısı yok (`chat-config.ts` ayrımı).
- Ürün kararları ve gerekçeleri `README.md` ve karar notunda; her davranış değişikliğinin canlı testi yapıldı.
- Bilinen sınırlar README'nin "nice to have" bölümünde ve bu raporun öneri satırlarında.
