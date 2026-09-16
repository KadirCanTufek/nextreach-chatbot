import { neon } from "@neondatabase/serverless";
import type { ChatMessage, Lead, LeadKind, LeadStatus, LeadUrgency, NeedProfile, ScoreBand, ScoreBreakdown } from "./types";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil.");
  return neon(url);
}

export interface NewLead {
  sessionId: string;
  ip: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  storeSize: string | null;
  contactInferred: boolean;
  needSummary: string;
  needProfile: NeedProfile;
  endedEarly: boolean;
  kind: LeadKind;
  scorePoints: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  urgency: LeadUrgency | null;
  scoreReason: string | null;
  completeness: number;
  transcript: ChatMessage[];
}

export async function insertLead(lead: NewLead): Promise<string> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO leads (
      session_id, ip, name, email, phone, company, store_size, contact_inferred,
      need_summary, need_profile, ended_early,
      kind, score_points, score_breakdown, urgency, score_reason, completeness, transcript
    ) VALUES (
      ${lead.sessionId}, ${lead.ip}, ${lead.name}, ${lead.email}, ${lead.phone},
      ${lead.company}, ${lead.storeSize}, ${lead.contactInferred},
      ${lead.needSummary}, ${JSON.stringify(lead.needProfile)}::jsonb, ${lead.endedEarly},
      ${lead.kind}, ${lead.scorePoints}, ${lead.scoreBreakdown ? JSON.stringify(lead.scoreBreakdown) : null}::jsonb,
      ${lead.urgency}, ${lead.scoreReason},
      ${lead.completeness}, ${JSON.stringify(lead.transcript)}::jsonb
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface LeadFilter {
  kind?: LeadKind;
  range?: "today" | "week" | "all";
  band?: ScoreBand;
  status?: LeadStatus;
}

export async function listLeads(filter: LeadFilter): Promise<Lead[]> {
  const sql = getSql();
  const kind = filter.kind ?? "qualified";
  const range = filter.range ?? "all";
  const band = filter.band ?? null;
  const status = filter.status ?? null;

  const rows = await sql`
    SELECT id, created_at, session_id, ip, name, email, phone, company, store_size,
           contact_inferred, need_summary, need_profile, ended_early,
           kind, score_points, score_breakdown, urgency, score_reason, completeness, status, transcript
    FROM leads
    WHERE kind = ${kind}
      AND (
        ${range} = 'all'
        OR (${range} = 'today' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
        OR (${range} = 'week'  AND created_at >= now() - interval '7 days')
      )
      AND (
        ${band}::text IS NULL
        OR (${band} = 'high' AND score_points >= 8)
        OR (${band} = 'mid'  AND score_points BETWEEN 5 AND 7)
        OR (${band} = 'low'  AND score_points <= 4)
      )
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC
    LIMIT 500
  `;
  return rows as Lead[];
}

export async function countLeadsByKind(): Promise<Record<LeadKind, number>> {
  const sql = getSql();
  const rows = await sql`SELECT kind, count(*)::int AS n FROM leads GROUP BY kind`;
  const out: Record<LeadKind, number> = { qualified: 0, no_contact: 0, spam: 0 };
  for (const r of rows) out[r.kind as LeadKind] = r.n as number;
  return out;
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`UPDATE leads SET status = ${status} WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// --- Devam modu: talep iletildikten sonra ---

export async function getLeadForSession(id: string, sessionId: string): Promise<{ id: string; hasContact: boolean } | null> {
  const sql = getSql();
  const rows = await sql`SELECT id, (email IS NOT NULL OR phone IS NOT NULL) AS has_contact FROM leads WHERE id = ${id}::uuid AND session_id = ${sessionId}`;
  if (rows.length === 0) return null;
  return { id: rows[0].id as string, hasContact: Boolean(rows[0].has_contact) };
}

/**
 * Sonradan bırakılan iletişim bilgisini talebe ekler; İletişimsiz talep Nitelikli olur.
 * Puanın "iletişim" bileşeni 0 ise 1'e çıkar ve toplam güncellenir.
 */
export async function addLeadContact(id: string, sessionId: string, email: string | null, phone: string | null): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE leads SET
      email = COALESCE(${email}, email),
      phone = COALESCE(${phone}, phone),
      contact_inferred = false,
      kind = CASE WHEN kind = 'no_contact' THEN 'qualified' ELSE kind END,
      score_points = CASE
        WHEN score_points IS NOT NULL AND COALESCE((score_breakdown->>'contact')::int, 1) = 0 THEN LEAST(10, score_points + 1)
        ELSE score_points END,
      score_breakdown = CASE
        WHEN score_breakdown IS NOT NULL AND (score_breakdown->>'contact')::int = 0 THEN jsonb_set(score_breakdown, '{contact}', '1'::jsonb)
        ELSE score_breakdown END
    WHERE id = ${id}::uuid AND session_id = ${sessionId}
    RETURNING id`;
  return rows.length > 0;
}

export async function updateLeadTranscript(id: string, sessionId: string, transcript: ChatMessage[]): Promise<void> {
  const sql = getSql();
  await sql`UPDATE leads SET transcript = ${JSON.stringify(transcript)}::jsonb WHERE id = ${id}::uuid AND session_id = ${sessionId}`;
}

// --- Rate limit ---

export async function recordRateEvent(ip: string, kind: "message" | "lead"): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO rate_events (ip, kind) VALUES (${ip}, ${kind})`;
}

export async function countRateEvents(ip: string, kind: "message" | "lead", windowSeconds: number): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT count(*)::int AS n FROM rate_events
    WHERE ip = ${ip} AND kind = ${kind}
      AND created_at >= now() - (${windowSeconds} || ' seconds')::interval
  `;
  return rows[0].n as number;
}
