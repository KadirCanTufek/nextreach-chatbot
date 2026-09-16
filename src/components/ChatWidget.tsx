"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatResponse, Visitor } from "@/lib/types";

const ASSISTANT_NAME = "Reach";
const STORE_SIZES = ["", "Aylık 0-500 sipariş", "Aylık 500-2.000 sipariş", "Aylık 2.000-10.000 sipariş", "Aylık 10.000+ sipariş"];

type Step = "form" | "chat";

function greeting(v: Visitor): string {
  if (v.anonymous) {
    return `Merhaba, ben ${ASSISTANT_NAME}. NextReach ekibinin iletişim asistanıyım. Form doldurmanıza gerek yok; ne aradığınızı konuşarak anlayalım. Analitik tarafında şu an sizi en çok ne zorluyor?`;
  }
  const first = v.name.trim().split(/\s+/)[0];
  return `Merhaba ${first}, ben ${ASSISTANT_NAME}. Teşekkürler, ${v.company} için nasıl yardımcı olabileceğimizi anlamak istiyorum. Analitik tarafında şu an sizi en çok ne zorluyor?`;
}

export default function ChatWidget({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>("form");
  const [visitor, setVisitor] = useState<Visitor>({ name: "", email: "", company: "", storeSize: "", anonymous: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // honeypot

  const [sessionId, setSessionId] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (open && step === "chat" && !done) inputRef.current?.focus();
  }, [open, step, done]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function startChat(v: Visitor) {
    setVisitor(v);
    setSessionId(crypto.randomUUID());
    setStartedAt(Date.now());
    setMessages([{ role: "assistant", content: greeting(v) }]);
    setStep("chat");
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = visitor.name.trim();
    const email = visitor.email.trim();
    const company = visitor.company.trim();
    if (!name || !company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("İsim, geçerli bir e-posta ve şirket adı gerekli.");
      return;
    }
    setFormError(null);
    startChat({ name, email, company, storeSize: visitor.storeSize, anonymous: false });
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || done) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, startedAt, website, visitor, messages: next }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok && !data.reply) throw new Error(data.error ?? "Bir sorun oluştu.");
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.done) setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bağlantı hatası. Tekrar deneyin.");
      setMessages(messages); // gönderilemeyen mesajı geri al
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-end sm:justify-end sm:p-6" role="dialog" aria-modal="true" aria-label="NextReach iletişim asistanı">
      <button className="absolute inset-0 bg-slate-900/20 sm:bg-transparent" onClick={onClose} aria-label="Kapat" />
      <div className="relative nr-slide-up w-full sm:w-[400px] h-[92dvh] sm:h-[620px] sm:max-h-[calc(100dvh-3rem)] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Başlık */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-indigo-600 text-white grid place-items-center text-sm font-semibold">R</div>
            <div>
              <div className="text-sm font-semibold leading-tight">{ASSISTANT_NAME}</div>
              <div className="text-xs text-slate-500">NextReach iletişim asistanı</div>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500" aria-label="Kapat">
            ✕
          </button>
        </div>

        {step === "form" ? (
          <form onSubmit={submitForm} className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Kısa bir tanışma</h2>
              <p className="mt-1 text-sm text-slate-600">Üç bilgi, sonra konuşuyoruz. Fiyat dahil her şeyi sorabilirsiniz.</p>
            </div>

            <Field label="Adınız" required>
              <input className={inputCls} value={visitor.name} onChange={(e) => setVisitor({ ...visitor, name: e.target.value })} autoComplete="name" placeholder="Ayşe Yılmaz" />
            </Field>
            <Field label="İş e-postanız" required>
              <input className={inputCls} type="email" value={visitor.email} onChange={(e) => setVisitor({ ...visitor, email: e.target.value })} autoComplete="email" placeholder="ayse@magaza.com" />
            </Field>
            <Field label="Şirketiniz" required>
              <input className={inputCls} value={visitor.company} onChange={(e) => setVisitor({ ...visitor, company: e.target.value })} autoComplete="organization" placeholder="Mağaza A.Ş." />
            </Field>
            <Field label="Mağaza büyüklüğü" hint="isteğe bağlı">
              <select className={inputCls} value={visitor.storeSize} onChange={(e) => setVisitor({ ...visitor, storeSize: e.target.value })}>
                {STORE_SIZES.map((s) => (
                  <option key={s} value={s}>{s || "Seçmek istemiyorum"}</option>
                ))}
              </select>
            </Field>

            {/* Honeypot: insanlar görmez, botlar doldurur */}
            <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
              <label>
                Web siteniz
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <button type="submit" className="mt-1 rounded-xl bg-indigo-600 text-white py-3 font-medium hover:bg-indigo-500">
              Konuşmaya başla
            </button>
            <button
              type="button"
              onClick={() => startChat({ name: "", email: "", company: "", storeSize: "", anonymous: true })}
              className="text-sm text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline self-center"
            >
              Şimdilik bilgi vermeden soru sormak istiyorum
            </button>
          </form>
        ) : (
          <>
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-slate-50">
              {messages.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "self-end bg-indigo-600 text-white rounded-br-md" : "self-start bg-white border border-slate-200 text-slate-800 rounded-bl-md"
                }`}>
                  {m.content}
                </div>
              ))}
              {sending && (
                <div className="self-start bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 flex gap-1" aria-label="Yazıyor">
                  <span className="nr-dot h-2 w-2 rounded-full bg-slate-400" />
                  <span className="nr-dot h-2 w-2 rounded-full bg-slate-400" />
                  <span className="nr-dot h-2 w-2 rounded-full bg-slate-400" />
                </div>
              )}
              {done && (
                <div className="self-center mt-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1">
                  Talebiniz ekibimize iletildi
                </div>
              )}
            </div>
            {error && <p className="px-4 py-2 text-sm text-red-600 bg-red-50 border-t border-red-100">{error}</p>}
            <div className="border-t border-slate-100 p-3 bg-white">
              {done ? (
                <button onClick={onClose} className="w-full rounded-xl bg-slate-900 text-white py-3 font-medium hover:bg-slate-800">
                  Kapat
                </button>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Mesajınızı yazın…"
                    maxLength={1000}
                    className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32"
                  />
                  <button
                    onClick={send}
                    disabled={sending || !input.trim()}
                    className="h-11 w-11 rounded-xl bg-indigo-600 text-white grid place-items-center disabled:opacity-40 hover:bg-indigo-500"
                    aria-label="Gönder"
                  >
                    ↑
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-indigo-600">*</span>}
        {hint && <span className="ml-1 text-xs font-normal text-slate-400">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
