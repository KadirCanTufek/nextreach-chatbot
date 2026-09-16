// Uygulama genelinde paylaşılan tipler

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type LeadKind = "qualified" | "no_contact" | "spam";
export type LeadUrgency = "none" | "normal" | "urgent";
/** Bekliyor → İşlemde → Olumlu / Olumsuz */
export type LeadStatus = "waiting" | "in_progress" | "positive" | "negative";
/** Puan bandı filtresi: 8-10 / 5-7 / 0-4 */
export type ScoreBand = "high" | "mid" | "low";

/** 10 üzerinden puanın bileşenleri. Toplamı kod hesaplar; model yalnızca bileşen seçer. */
export interface ScoreBreakdown {
  need_clarity: number; // 0-3
  product_fit: number; // 0-3
  timeline: number; // 0-2
  authority: number; // 0-1
  contact: number; // 0-1 (koddan: e-posta ya da telefon var mı)
}
export const SCORE_MAX: Record<keyof ScoreBreakdown, number> = { need_clarity: 3, product_fit: 3, timeline: 2, authority: 1, contact: 1 };
export const SCORE_LABELS: Record<keyof ScoreBreakdown, string> = {
  need_clarity: "İhtiyaç netliği",
  product_fit: "Ürün uyumu",
  timeline: "Zamanlama",
  authority: "Karar yetkisi",
  contact: "İletişim bilgisi",
};
export function totalScore(b: ScoreBreakdown): number {
  return Math.min(10, b.need_clarity + b.product_fit + b.timeline + b.authority + b.contact);
}

/** Sohbetin sonunda modelin doldurduğu ihtiyaç profili (admin'de gösterilen kısım). */
export interface NeedProfile {
  goal_or_problem: string;
  current_setup: string;
  timeline: string;
  scale: string | null;
  decision_role: string | null;
  specific_questions: string[];
}

export interface Lead {
  id: string;
  created_at: string;
  session_id: string;
  ip: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  store_size: string | null;
  contact_inferred: boolean;
  need_summary: string | null;
  need_profile: NeedProfile | Record<string, never>;
  ended_early: boolean;
  kind: LeadKind;
  score_points: number | null;
  score_breakdown: ScoreBreakdown | null;
  urgency: LeadUrgency | null;
  score_reason: string | null;
  completeness: string | null;
  status: LeadStatus;
  transcript: ChatMessage[];
}

/** /api/chat isteği. Form yok: kimlik ve iletişim bilgileri sohbette toplanır. */
export interface ChatRequest {
  sessionId: string;
  startedAt: number;
  messages: ChatMessage[];
  /** Talep iletildikten sonra sohbet devam ederse: mevcut talebin kimliği (devam modu). */
  leadId?: string;
}

/** /api/chat cevabı */
export interface ChatResponse {
  reply: string;
  /** Yapısal sorularda hızlı cevap çipleri (en fazla 4). */
  chips?: string[];
  done: boolean;
  leadId?: string;
  /** Devam modunda ziyaretçi sonradan iletişim bilgisi bıraktı ve talebe eklendi. */
  contactAdded?: boolean;
  /** Sohbet kapsam dışı ısrar ya da hakaret nedeniyle kapatıldı; talep oluşmadı. */
  ended?: EndReason;
}

export type EndReason = "off_topic" | "abusive";
