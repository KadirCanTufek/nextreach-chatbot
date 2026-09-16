// Uygulama genelinde paylaşılan tipler

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type LeadKind = "qualified" | "no_contact" | "spam";
export type LeadScore = "hot" | "warm" | "cold";
export type LeadUrgency = "none" | "normal" | "urgent";
export type LeadStatus = "new" | "contacted" | "closed";

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
  score: LeadScore | null;
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
  /** Honeypot: gerçek kullanıcı bu alanı hiç görmez, boş kalmalıdır. */
  website?: string;
}

/** /api/chat cevabı */
export interface ChatResponse {
  reply: string;
  /** Yapısal sorularda hızlı cevap çipleri (en fazla 4). */
  chips?: string[];
  done: boolean;
  leadId?: string;
}
