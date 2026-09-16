import { neon } from "@neondatabase/serverless";
import type { ChatMessage, Lead, LeadKind, LeadScore, LeadStatus, LeadUrgency, NeedProfile } from "./types";

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
  score: LeadScore | null;
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
      kind, score, urgency, score_reason, completeness, transcript
    ) VALUES (
      ${lead.sessionId}, ${lead.ip}, ${lead.name}, ${lead.email}, ${lead.phone},
      ${lead.company}, ${lead.storeSize}, ${lead.contactInferred},
      ${lead.needSummary}, ${JSON.stringify(lead.needProfile)}::jsonb, ${lead.endedEarly},
      ${lead.kind}, ${lead.score}, ${lead.urgency}, ${lead.scoreReason},
      ${lead.completeness}, ${JSON.stringify(lead.transcript)}::jsonb
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface LeadFilter {
  kind?: LeadKind;
  range?: "today" | "week" | "all";
  score?: LeadScore;
  status?: LeadStatus;
}

export async function listLeads(filter: LeadFilter): Promise<Lead[]> {
  const sql = getSql();
  const kind = filter.kind ?? "qualified";
  const range = filter.range ?? "all";
  const score = filter.score ?? null;
  const status = filter.status ?? null;

  const rows = await sql`
    SELECT id, created_at, session_id, ip, name, email, phone, company, store_size,
           contact_inferred, need_summary, need_profile, ended_early,
           kind, score, urgency, score_reason, completeness, status, transcript
    FROM leads
    WHERE kind = ${kind}
      AND (
        ${range} = 'all'
        OR (${range} = 'today' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
        OR (${range} = 'week'  AND created_at >= now() - interval '7 days')
      )
      AND (${score}::text IS NULL OR score = ${score})
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
