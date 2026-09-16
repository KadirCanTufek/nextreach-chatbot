import { countRateEvents, recordRateEvent } from "./db";

/** Limitler: bilinçli olarak düşük tutuldu, LLM maliyetini ve boş talebi sınırlar. */
export const LIMITS = {
  messagesPerMinute: 20,
  messagesPerHour: 120,
  leadsPerDay: 10,
  maxMessagesPerSession: 40,
  maxMessageLength: 1000,
  /** Admin giriş denemesi: 15 dakikada en fazla 10 (kaba kuvvete karşı). */
  loginAttemptsPer15Min: 10,
} as const;

export type RateVerdict = { ok: true } | { ok: false; reason: string };

export async function checkMessageRate(ip: string): Promise<RateVerdict> {
  const [perMinute, perHour] = await Promise.all([
    countRateEvents(ip, "message", 60),
    countRateEvents(ip, "message", 3600),
  ]);
  if (perMinute >= LIMITS.messagesPerMinute || perHour >= LIMITS.messagesPerHour) {
    return { ok: false, reason: "Çok fazla mesaj gönderildi. Lütfen biraz sonra tekrar deneyin." };
  }
  await recordRateEvent(ip, "message");
  return { ok: true };
}

export async function checkLeadRate(ip: string): Promise<RateVerdict> {
  const perDay = await countRateEvents(ip, "lead", 86400);
  if (perDay >= LIMITS.leadsPerDay) {
    return { ok: false, reason: "Bugün için talep limiti doldu." };
  }
  await recordRateEvent(ip, "lead");
  return { ok: true };
}

/** Başarısız admin giriş denemelerini sınırlar. Deneme, kontrol sırasında kaydedilir. */
export async function checkLoginRate(ip: string): Promise<RateVerdict> {
  const attempts = await countRateEvents(ip, "login", 15 * 60);
  if (attempts >= LIMITS.loginAttemptsPer15Min) {
    return { ok: false, reason: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." };
  }
  await recordRateEvent(ip, "login");
  return { ok: true };
}

/** Vercel'de x-forwarded-for platform tarafından yazılır; ilk değer istemci IP'sidir. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
