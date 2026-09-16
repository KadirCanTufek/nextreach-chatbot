import { countRateEvents, recordRateEvent } from "./db";

/** Limitler: bilinçli olarak düşük tutuldu, LLM maliyetini ve boş talebi sınırlar. */
export const LIMITS = {
  messagesPerMinute: 20,
  messagesPerHour: 120,
  leadsPerDay: 10,
  maxMessagesPerSession: 40,
  maxMessageLength: 1000,
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

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
