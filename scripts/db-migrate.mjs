// Mevcut veritabanını yeni şemaya taşır. Tekrar çalıştırılabilir (idempotent).
// Tek başına: `npm run db:migrate`; `npm run db:setup` da şemadan sonra bunu çağırır.
import { neon } from "@neondatabase/serverless";
import { pathToFileURL } from "node:url";

export async function migrate(sql) {
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'leads'`;
  const has = (c) => cols.some((r) => r.column_name === c);
  const log = [];

  // 001: Sıcak/Ilık/Soğuk → 10 üzerinden puan + rubrik
  if (!has("score_points")) {
    await sql`ALTER TABLE leads ADD COLUMN score_points smallint`;
    log.push("score_points eklendi");
  }
  if (!has("score_breakdown")) {
    await sql`ALTER TABLE leads ADD COLUMN score_breakdown jsonb`;
    log.push("score_breakdown eklendi");
  }
  if (has("score")) {
    const r = await sql`UPDATE leads SET score_points = CASE score WHEN 'hot' THEN 8 WHEN 'warm' THEN 5 WHEN 'cold' THEN 2 END WHERE score_points IS NULL AND score IS NOT NULL RETURNING id`;
    await sql`ALTER TABLE leads DROP COLUMN score`;
    log.push(`eski skor eşlendi (${r.length} kayıt: sıcak→8, ılık→5, soğuk→2), score sütunu kaldırıldı`);
  }
  await sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_score_points_check`;
  await sql`ALTER TABLE leads ADD CONSTRAINT leads_score_points_check CHECK (score_points IS NULL OR (score_points >= 0 AND score_points <= 10))`;

  // 002: Yeni/Arandı/Kapandı → Bekliyor/İşlemde/Olumlu/Olumsuz
  await sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`;
  const mapped = await sql`UPDATE leads SET status = CASE status WHEN 'new' THEN 'waiting' WHEN 'contacted' THEN 'in_progress' WHEN 'closed' THEN 'positive' ELSE status END WHERE status IN ('new', 'contacted', 'closed') RETURNING id`;
  if (mapped.length) log.push(`durumlar eşlendi (${mapped.length} kayıt)`);
  await sql`ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'waiting'`;
  await sql`ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('waiting', 'in_progress', 'positive', 'negative'))`;

  // 003: rate_events.kind → 'login' eklendi (admin giriş denemesi sınırı)
  await sql`ALTER TABLE rate_events DROP CONSTRAINT IF EXISTS rate_events_kind_check`;
  await sql`ALTER TABLE rate_events ADD CONSTRAINT rate_events_kind_check CHECK (kind IN ('message', 'lead', 'login'))`;
  log.push("rate_events.kind kısıtı doğrulandı (message, lead, login)");

  return log;
}

// Doğrudan çalıştırıldı mı? (Yol Türkçe karakter içerebilir; URL'e çevirip karşılaştır.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL tanımlı değil. .env.local dosyasını doldurun.");
    process.exit(1);
  }
  const log = await migrate(neon(url));
  console.log(log.length ? log.join("\n") : "Göç gerekmedi; şema güncel.");
}
