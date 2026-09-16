// Şemayı Neon'a uygular: `npm run db:setup`
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil. .env.local dosyasını doldurun.");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../src/lib/schema.sql", import.meta.url), "utf8");
const statements = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--")) // yorum satırlarını at
  .join("\n")
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Şema uygulandı (${statements.length} ifade).`);
