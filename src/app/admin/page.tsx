"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Building2, Check, Clock, Flame, Inbox, Mail, Phone, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { AnimatedToastStack, useAnimatedToastStack } from "@/components/motion/animated-toast-stack";
import { Drawer } from "@/components/motion/drawer";
import { Loader } from "@/components/motion/loader";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { Lead, LeadKind, LeadScore, LeadStatus, LeadUrgency } from "@/lib/types";

type Range = "today" | "week" | "all";

const KIND_LABEL: Record<LeadKind, string> = { qualified: "Nitelikli", no_contact: "İletişimsiz", spam: "Spam" };
const SCORE_LABEL: Record<LeadScore, string> = { hot: "Sıcak", warm: "Ilık", cold: "Soğuk" };
const STATUS_LABEL: Record<LeadStatus, string> = { new: "Yeni", contacted: "Arandı", closed: "Kapandı" };
const URGENCY_LABEL: Record<LeadUrgency, string> = { none: "Acil değil", normal: "Normal", urgent: "Acil" };

/** Aciliyet, skor rozetinin rengiyle gösterilir: yeşil acil değil, sarı normal, kırmızı acil. */
const URGENCY_STATUS: Record<LeadUrgency, "success" | "warning" | "danger"> = { none: "success", normal: "warning", urgent: "danger" };
const URGENCY_DOT: Record<LeadUrgency, string> = { none: "bg-emerald-500", normal: "bg-amber-500", urgent: "bg-red-500" };

function urgencyIcon(u: LeadUrgency) {
  if (u === "urgent") return <Flame className="h-3 w-3" />;
  if (u === "normal") return <Clock className="h-3 w-3" />;
  return <Check className="h-3 w-3" />;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const EMPTY_COUNTS: Record<LeadKind, number> = { qualified: 0, no_contact: 0, spam: 0 };

export default function AdminPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ defaultDuration: 3200, limit: 3 });

  const [kind, setKind] = useState<LeadKind>("qualified");
  const [range, setRange] = useState<Range>("today");
  const [score, setScore] = useState<LeadScore | "all">("all");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<{ key: string; leads: Lead[]; counts: Record<LeadKind, number> } | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);

  const filterKey = `${kind}|${range}|${score}|${status}|${refreshKey}`;
  const loading = !data || data.key !== filterKey;
  const leads = data?.leads ?? [];
  const counts = data?.counts ?? EMPTY_COUNTS;

  useEffect(() => {
    let cancelled = false;
    const key = `${kind}|${range}|${score}|${status}|${refreshKey}`;
    const params = new URLSearchParams({ kind, range });
    if (score !== "all") params.set("score", score);
    if (status !== "all") params.set("status", status);
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
        if (!cancelled) setData({ key, leads: [], counts: EMPTY_COUNTS });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, range, score, status, refreshKey, router]);

  async function changeStatus(lead: Lead, next: LeadStatus) {
    if (lead.status === next) return;
    const res = await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      showToast({ title: "Durum güncellenemedi", description: "Bağlantıyı kontrol edip tekrar deneyin.", status: "error" });
      return;
    }
    setData((d) => (d ? { ...d, leads: d.leads.map((l) => (l.id === lead.id ? { ...l, status: next } : l)) } : d));
    setSelected((s) => (s && s.id === lead.id ? { ...s, status: next } : s));
    showToast({ title: "Durum güncellendi", description: `${lead.name ?? lead.company ?? "Talep"} → ${STATUS_LABEL[next]}`, status: "success" });
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
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800"
              aria-label="Yenile"
            >
              <motion.span
                animate={loading && !reduce ? { rotate: 360 } : { rotate: 0 }}
                transition={loading ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0.3 }}
                className="grid place-items-center"
              >
                <RefreshCw className="h-4 w-4" />
              </motion.span>
              Yenile
            </button>
            <Link href="/" className="text-slate-500 hover:text-slate-800">Siteye dön</Link>
            <button onClick={logout} className="text-slate-500 hover:text-slate-800">Çıkış</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col gap-4">
        {/* Sekmeler */}
        <Tabs value={kind} onValueChange={(v) => setKind(v as LeadKind)} variant="segment">
          <TabsList className="border border-slate-200">
            {(Object.keys(KIND_LABEL) as LeadKind[]).map((k) => (
              <TabsTrigger key={k} value={k} className="gap-2">
                {KIND_LABEL[k]}
                <span className={`tabular-nums text-xs ${kind === k ? "text-white/70" : "text-slate-400"}`}>
                  <AnimatedNumber value={counts[k]} duration={0.6} />
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Filtreler + renk rehberi */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={range} onValueChange={(v) => setRange(v as Range)} variant="pill">
              <TabsList className="border border-slate-200">
                <TabsTrigger value="today">Bugün</TabsTrigger>
                <TabsTrigger value="week">Bu hafta</TabsTrigger>
                <TabsTrigger value="all">Tümü</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={score} onValueChange={(v) => setScore(v as LeadScore | "all")} variant="pill">
              <TabsList className="border border-slate-200">
                <TabsTrigger value="all">Tüm skorlar</TabsTrigger>
                <TabsTrigger value="hot">Sıcak</TabsTrigger>
                <TabsTrigger value="warm">Ilık</TabsTrigger>
                <TabsTrigger value="cold">Soğuk</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={status} onValueChange={(v) => setStatus(v as LeadStatus | "all")} variant="pill">
              <TabsList className="border border-slate-200">
                <TabsTrigger value="all">Tüm durumlar</TabsTrigger>
                <TabsTrigger value="new">Yeni</TabsTrigger>
                <TabsTrigger value="contacted">Arandı</TabsTrigger>
                <TabsTrigger value="closed">Kapandı</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="text-slate-500">Rozet rengi = aciliyet:</span>
            {(Object.keys(URGENCY_LABEL) as LeadUrgency[]).map((u) => (
              <span key={u} className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${URGENCY_DOT[u]}`} />
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
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <div className="flex items-center justify-center gap-3 text-slate-400">
                      <Loader variant="dots" size={18} label="Yükleniyor" />
                      <span>Yükleniyor</span>
                    </div>
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <motion.div
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col items-center gap-2 text-slate-400"
                    >
                      <Inbox className="h-6 w-6" />
                      <span>Bu filtrede talep yok.</span>
                    </motion.div>
                  </td>
                </tr>
              ) : (
                leads.map((l, i) => (
                  <motion.tr
                    key={`${filterKey}-${l.id}`}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.2 }}
                    onClick={() => setSelected(l)}
                    className="cursor-pointer hover:bg-indigo-50/40"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.name ?? "—"}</div>
                      <div className="text-xs text-slate-500">
                        {l.email ?? l.phone ?? "iletişim yok"}
                        {l.contact_inferred && " · sohbetten"}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">{l.company ?? "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell max-w-md">
                      <div className="truncate text-slate-700">{l.need_summary}</div>
                    </td>
                    <td className="px-4 py-3"><ScoreBadge lead={l} /></td>
                    <td className="px-4 py-3"><StatusPill status={l.status} /></td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        side="right"
        ariaLabel="Talep detayı"
        className="w-full sm:w-[560px] sm:max-w-[92vw]"
      >
        {selected && <LeadPanel lead={selected} onClose={() => setSelected(null)} onStatus={(s) => changeStatus(selected, s)} />}
      </Drawer>

      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" placement="fixed" />
    </main>
  );
}

function ScoreBadge({ lead, size = "sm" }: { lead: Lead; size?: "sm" | "md" }) {
  if (!lead.score) return <span className="text-slate-400 text-xs">—</span>;
  const u = lead.urgency ?? "none";
  return (
    <AnimatedBadge
      status={URGENCY_STATUS[u]}
      size={size}
      icon={urgencyIcon(u)}
      pulse={u === "urgent"}
      contentKey={`${lead.score}-${u}`}
      title={`Aciliyet: ${URGENCY_LABEL[u]}`}
    >
      {SCORE_LABEL[lead.score]}
    </AnimatedBadge>
  );
}

function StatusPill({ status }: { status: LeadStatus }) {
  const cls = status === "new" ? "bg-indigo-50 text-indigo-700" : status === "contacted" ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
      >
        {STATUS_LABEL[status]}
      </motion.span>
    </AnimatePresence>
  );
}

function LeadPanel({ lead, onClose, onStatus }: { lead: Lead; onClose: () => void; onStatus: (s: LeadStatus) => void }) {
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
    <div className="h-full bg-white flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">{fmtDate(lead.created_at)} · {KIND_LABEL[lead.kind]}</div>
          <h2 className="mt-1 text-lg font-semibold truncate">{lead.name ?? "İsimsiz ziyaretçi"}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            {lead.company && <ContactChip icon={<Building2 className="h-3.5 w-3.5" />} text={lead.company} />}
            {lead.email && <ContactChip icon={<Mail className="h-3.5 w-3.5" />} text={lead.email} href={`mailto:${lead.email}`} />}
            {lead.phone && <ContactChip icon={<Phone className="h-3.5 w-3.5" />} text={lead.phone} href={`tel:${lead.phone}`} />}
            {!lead.email && !lead.phone && <span className="text-slate-400">İletişim bilgisi yok</span>}
          </div>
        </div>
        <button onClick={onClose} className="h-8 w-8 shrink-0 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500" aria-label="Kapat">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
        <section className="flex flex-wrap items-center gap-3">
          <ScoreBadge lead={lead} size="md" />
          {lead.urgency && <span className="text-xs text-slate-500">Aciliyet: {URGENCY_LABEL[lead.urgency]}</span>}
          {lead.completeness && <span className="text-xs text-slate-500">· Doluluk %{Math.round(Number(lead.completeness) * 100)}</span>}
          {lead.ended_early && <span className="text-xs text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Erken bitti</span>}
          {lead.contact_inferred && <span className="text-xs text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">İletişim sohbetten çıkarıldı</span>}
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
          <Tabs value={lead.status} onValueChange={(v) => onStatus(v as LeadStatus)} variant="pill">
            <TabsList className="border border-slate-200">
              {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
                <TabsTrigger key={s} value={s}>{STATUS_LABEL[s]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
    </div>
  );
}

function ContactChip({ icon, text, href }: { icon: React.ReactNode; text: string; href?: string }) {
  const inner = (
    <motion.span whileHover={{ y: -1 }} className="inline-flex items-center gap-1.5 text-slate-700">
      <span className="text-slate-400">{icon}</span>
      <span className="truncate max-w-[220px]">{text}</span>
    </motion.span>
  );
  return href ? <a href={href} className="hover:underline underline-offset-2">{inner}</a> : inner;
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
