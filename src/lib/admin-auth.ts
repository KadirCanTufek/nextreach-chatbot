import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "nr_admin";

/** Cookie'de anahtarın kendisi değil, SHA-256 özeti taşınır. */
export function adminToken(): string | null {
  const key = process.env.ADMIN_KEY;
  if (!key) return null;
  return createHash("sha256").update(key).digest("hex");
}

export function isValidAdminKey(candidate: string): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isValidAdminToken(candidate: string | undefined): boolean {
  const expected = adminToken();
  if (!expected || !candidate || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
