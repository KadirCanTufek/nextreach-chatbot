"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Lead, LeadKind, LeadScore, LeadStatus, LeadUrgency } from "@/lib/types";

type Range = "today" | "week" | "all";

const KIND_LABEL: Record<LeadKind, string> = { qualified: "Nitelikli", no_contact: "İletişimsiz", spam: "Spam" };
const SCORE_LABEL: Record<LeadScore, string> = { hot: "Sıcak", warm: "Ilık", cold: "Soğuk" };
const STATUS_LABEL: Record<LeadStatus, string> = { new: "Yeni", contacted: "Arandı", closed: "Kapandı" };
const URGENCY_LABEL: Record<LeadUrgency, string> = { none: "Acil değil", normal: "Normal", urgent: "Acil" };

/** Aciliyet, skor rozetinin rengiyle gösterilir: yeşil acil değil, sarı normal, kırmızı acil. */
const URGENCY_CLS: Record<LeadUrgency, string> = {
  none: "bg-emerald-100 text-emerald-800 border-emerald-200",
  normal: "bg-amber-100 text-amber-800 border-amber-200",
  urgent: "bg-red-100 text-red-800 border-red-200",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AdminPage() {
  const router = useRouter();
  const [kind, setKind] = useState<LeadKind>("qualified");
  const [range, setRange] = useState<Range>("today");
  const [score, setScore] = useState<LeadScore | "">("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [data, setData] = useState<{ key: string; leads: Lead[]; counts: Record<LeadKind, number> } | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);

  const filterKey = `${kind}|${range}|${score}|${status}`;
  const loading = !data || data.key !== filterKey;
  const leads = data?.leads ?? [];
  const counts = data?.counts ?? { qualified: 0, no_contact: 0, spam: 0 };

  useEffect(() => {
    let cancelled = false;
    const key = `${kind}|${range}|${score}|${status}`;
    const params = new URLSearchParams({ kind, range });
    if (score) params.set("score", score);
    if (status) params.set("status", status);
    fetch(`/api/admin/leads?${params}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const body = (await res.json()) as { leads: Lead[]; counts: Record<LeadKind, number> };
        if (!cancelled) setData({ key, leads: body.leads, counts: body.counts });
      })
      .catch(() => {
        if (!cancelled) setData({ key, leads: [], counts: { qualified: 0, no_contact: 0, spam: 0 } });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, range, score, status, router]);

  async function changeStatus(lead: Lead, next: LeadStatus) {
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setData((d) => (d ? { ...d, leads: d.leads.map((l) => (l.id === lead.id ? { ...l, status: next } : l)) } : d));
    setSelected((s) => (s && s.id === lead.id ? { ...s, status: next } : s));
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <main className="flex-1 bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-5 w-5 rounded bg-indigo-600" aria-hidden />
            NextReach · İletişim talepleri
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-slate-500 hover:text-slate-800">Siteye dön</Link>
            <button onClick={logout} className="text-slate-500 hover:text-slate-800">Çıkış</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col gap-4">
        {/* Sekmeler */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(KIND_LABEL) as LeadKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium border ${kind === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"}`}
            >
              {KIND_LABEL[k]} <span className={`ml-1 ${kind === k ? "text-slate-300" : "text-slate-400"}`}>{counts[k]}</span>
            </button>
          ))}
        </div>

        {/* Filtreler + renk rehberi */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Segment value={range} onChange={setRange} options={[["today", "Bugün"], ["week", "Bu hafta"], ["all", "Tümü"]]} />
            <select value={score} onChange={(e) => setScore(e.target.value as LeadScore | "")} className={selectCls}>
              <option value="">Tüm skorlar</option>
              <option value="hot">Sıcak</option>
              <option value="warm">Ilık</option>
              <option value="cold">Soğuk</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | "")} className={selectCls}>
              <option value="">Tüm durumlar</option>
              <option value="new">Yeni</option>
              <option value="contacted">Arandı</option>
              <option value="closed">Kapandı</option>
            </select>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="text-slate-500">Rozet rengi = aciliyet:</span>
            {(Object.keys(URGENCY_LABEL) as LeadUrgency[]).map((u) => (
              <span key={u} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded-full border ${URGENCY_CLS[u]}`} />
                {URGENCY_LABEL[u]}
              </span>
            ))}
          </div>
        </div>

        {/* Tablo */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Zaman</th>
                <th className="px-4 py-3 font-medium">Kim</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Şirket</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">İhtiyaç</th>
                <th className="px-4 py-3 font-medium">Skor</th>
                <th className="px-4 py-3 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Yükleniyor…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Bu filtrede talep yok.</td></tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id} onClick={() => setSelected(l)} className="cursor-pointer hover:bg-indigo-50/40">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.name ?? "—"}</div>
                      <div className="text-xs text-slate-500">{l.email ?? l.phone ?? "iletişim yok"}{l.contact_inferred && " · sohbetten"}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">{l.company ?? "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell max-w-md"><div className="truncate text-slate-700">{l.need_summary}</div></td>
                    <td className="px-4 py-3"><ScoreBadge lead={l} /></td>
                    <td className="px-4 py-3"><StatusPill status={l.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <LeadPanel lead={selected} onClose={() => setSelected(null)} onStatus={(s) => changeStatus(selected, s)} />}
    </main>
  );
}

const selectCls = "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm";

function Segment<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-full px-3 py-1 ${value === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ScoreBadge({ lead }: { lead: Lead }) {
  if (!lead.score) return <span className="text-slate-400 text-xs">—</span>;
  const u = lead.urgency ?? "none";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${URGENCY_CLS[u]}`} title={`Aciliyet: ${URGENCY_LABEL[u]}`}>
      {SCORE_LABEL[lead.score]}
    </span>
  );
}

function StatusPill({ status }: { status: LeadStatus }) {
  const cls = status === "new" ? "bg-indigo-50 text-indigo-700" : status === "contacted" ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function LeadPanel({ lead, onClose, onStatus }: { lead: Lead; onClose: () => void; onStatus: (s: LeadStatus) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = lead.need_profile as Partial<Lead["need_profile"]> & Record<string, unknown>;
  const rows: [string, unknown][] = [
    ["Hedef / problem", p.goal_or_problem],
    ["Mevcut durum", p.current_setup],
    ["Zamanlama", p.timeline],
    ["Ölçek", p.scale ?? lead.store_size],
    ["Karar rolü", p.decision_role],
  ];
  const questions = Array.isArray(p.specific_questions) ? (p.specific_questions as string[]) : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-label="Kapat" />
      <aside className="relative nr-slide-in h-full w-full sm:w-[520px] bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-100">
          <div>
            <div className="text-xs text-slate-500">{fmtDate(lead.created_at)} · {KIND_LABEL[lead.kind]}</div>
            <h2 className="mt-1 text-lg font-semibold">{lead.name ?? "İsimsiz ziyaretçi"}</h2>
            <div className="text-sm text-slate-600">{[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ") || "İletişim bilgisi yok"}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500" aria-label="Kapat">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          <section className="flex flex-wrap items-center gap-2">
            <ScoreBadge lead={lead} />
            {lead.urgency && <span className="text-xs text-slate-500">Aciliyet: {URGENCY_LABEL[lead.urgency]}</span>}
            {lead.completeness && <span className="text-xs text-slate-500">· Doluluk %{Math.round(Number(lead.completeness) * 100)}</span>}
            {lead.ended_early && <span className="text-xs text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Erken bitti</span>}
          </section>

          {lead.score_reason && (
            <section>
              <h3 className={h3}>Değerlendirme</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{lead.score_reason}</p>
            </section>
          )}

          <section>
            <h3 className={h3}>Satış için özet</h3>
            <p className="text-sm text-slate-800 leading-relaxed bg-indigo-50/60 rounded-xl p-3">{lead.need_summary}</p>
          </section>

          <section>
            <h3 className={h3}>İhtiyaç profili</h3>
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <Row key={k} k={k} v={typeof v === "string" && v ? v : "—"} />
              ))}
              <Row k="Sorular" v={questions.length ? questions.join(" · ") : "—"} />
            </dl>
          </section>

          <section>
            <h3 className={h3}>Durum</h3>
            <div className="inline-flex rounded-full border border-slate-200 p-0.5 text-sm">
              {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
                <button key={s} onClick={() => onStatus(s)} className={`rounded-full px-3 py-1 ${lead.status === s ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className={h3}>Sohbet</h3>
            <div className="flex flex-col gap-2">
              {lead.transcript.map((m, i) => (
                <div key={i} className={`max-w-[90%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "self-end bg-indigo-600 text-white" : "self-start bg-slate-100 text-slate-800"}`}>
                  {m.content}
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

const h3 = "text-xs uppercase tracking-wide text-slate-500 font-medium mb-2";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-800">{v}</dd>
    </>
  );
}
