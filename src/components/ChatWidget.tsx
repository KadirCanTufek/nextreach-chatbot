"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader } from "@/components/motion/loader";
import { ASSISTANT_NAME, GREETING, GREETING_CHIPS, TEASER_DELAY_MS, TEASER_SESSION_KEY, TEASER_TEXT } from "@/lib/chat-config";
import type { ChatMessage, ChatResponse, EndReason } from "@/lib/types";

const SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;

/** Sohbet tarayıcı sekmesi kapanana kadar saklanır; sayfa yenilense de kaldığı yerden devam eder. */
const STORAGE_KEY = "nr_chat_v1";

interface ChatState {
  sessionId: string;
  startedAt: number;
  messages: ChatMessage[];
  chips: string[];
  done: boolean;
  leadId: string | null;
  contactAdded: boolean;
  ended: EndReason | null;
  open: boolean;
}

function freshState(): ChatState {
  return {
    sessionId: crypto.randomUUID(),
    startedAt: Date.now(),
    messages: [{ role: "assistant", content: GREETING }],
    chips: GREETING_CHIPS,
    done: false,
    leadId: null,
    contactAdded: false,
    ended: null,
    open: false,
  };
}

function loadState(): ChatState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ChatState>;
      if (saved.sessionId && Array.isArray(saved.messages) && saved.messages.length > 0) {
        return { ...freshState(), ...saved } as ChatState;
      }
    }
  } catch {
    /* özel mod, dolu depolama vb. */
  }
  return freshState();
}

type StreamEvent = { t: "delta"; text: string } | { t: "reset" } | ({ t: "end" } & ChatResponse) | { t: "error"; message: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sağ altta kalıcı başlatıcı + proaktif baloncuk + sohbet paneli.
 * Form yok: isim, şirket ve iletişim bilgisi sohbette toplanır. Cevaplar akışla gelir.
 * Bu bileşen yalnızca istemcide render edilir (sessionStorage'dan ilk durum okunur).
 */
export default function ChatWidget({ open, onOpenChange }: Props) {
  const reduce = useReducedMotion();

  const [state, setState] = useState<ChatState>(loadState);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamed, setStreamed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sayfa yenilendiğinde panel açıksa açık kalsın.
  const restoredOpen = useRef(state.open);
  useEffect(() => {
    if (restoredOpen.current) onOpenChange(true);
  }, [onOpenChange]);

  // Her değişiklikte sakla.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, open }));
    } catch {
      /* depolama yoksa sessizce geç */
    }
  }, [state, open]);

  // --- Baloncuk (teaser): sayfa yüklendikten sonra bir kez ---
  const [teaser, setTeaser] = useState(false);
  useEffect(() => {
    if (open) return;
    let shown = false;
    try {
      shown = sessionStorage.getItem(TEASER_SESSION_KEY) === "1";
    } catch {
      shown = false;
    }
    if (shown) return;
    const t = setTimeout(() => {
      setTeaser(true);
      try {
        sessionStorage.setItem(TEASER_SESSION_KEY, "1");
      } catch {
        /* özel mod vb. */
      }
    }, TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Mobilde baloncuk birkaç saniye sonra kendini gizler.
  useEffect(() => {
    if (!teaser) return;
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    const t = setTimeout(() => setTeaser(false), 8000);
    return () => clearTimeout(t);
  }, [teaser]);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const openPanel = useCallback(() => {
    setTeaser(false);
    onOpenChange(true);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [state.messages, state.chips, sending, open, reduce]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending || state.ended) return;
      setError(null);

      const before = state;
      const base: ChatMessage[] = [...state.messages, { role: "user", content: text }];
      const bubbleIndex = base.length;
      setState((s) => ({ ...s, messages: base, chips: [] }));
      setInput("");
      setSending(true);
      setStreamed(false);

      const setBubble = (content: string | null) =>
        setState((s) => {
          const head = s.messages.slice(0, bubbleIndex);
          return { ...s, messages: content === null ? head : [...head, { role: "assistant", content }] };
        });
      const applyFinal = (data: ChatResponse) =>
        setState((s) => ({
          ...s,
          messages: [...base, { role: "assistant", content: data.reply }],
          chips: data.chips ?? [],
          done: data.ended ? s.done : s.done || data.done,
          leadId: data.leadId ?? s.leadId,
          contactAdded: s.contactAdded || Boolean(data.contactAdded),
          ended: data.ended ?? s.ended,
        }));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: state.sessionId,
            startedAt: state.startedAt,
            messages: base,
            ...(state.leadId ? { leadId: state.leadId } : {}),
          }),
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("ndjson")) {
          // Ön kontroller (rate limit, geçersiz istek) düz JSON döner.
          const data = (await res.json()) as ChatResponse & { error?: string };
          if (!res.ok && !data.reply) throw new Error(data.error ?? "Bir sorun oluştu.");
          applyFinal(data);
          return;
        }
        if (!res.body) throw new Error("Bağlantı hatası. Tekrar deneyin.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        let finished = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as StreamEvent;
            if (ev.t === "delta") {
              acc += ev.text;
              setStreamed(true);
              setBubble(acc);
            } else if (ev.t === "reset") {
              acc = "";
              setStreamed(false);
              setBubble(null);
            } else if (ev.t === "end") {
              finished = true;
              applyFinal(ev);
            } else if (ev.t === "error") {
              throw new Error(ev.message);
            }
          }
        }
        if (!finished) throw new Error("Cevap tamamlanamadı. Tekrar deneyin.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bağlantı hatası. Tekrar deneyin.");
        setState((s) => ({ ...s, messages: before.messages, chips: before.chips })); // gönderilemeyen mesajı geri al
        setInput(text);
      } finally {
        setSending(false);
        setStreamed(false);
      }
    },
    [state, sending],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function resetChat() {
    setError(null);
    setState({ ...freshState(), open: true });
  }

  const { messages, chips, done, contactAdded, ended } = state;
  const dur = reduce ? 0 : undefined;

  return (
    <>
      {/* Baloncuk */}
      <AnimatePresence>
        {teaser && !open && (
          <motion.div
            key="teaser"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : SPRING}
            className="fixed bottom-[5.5rem] right-4 sm:bottom-24 sm:right-6 z-40 max-w-[calc(100vw-2rem)] sm:max-w-xs"
          >
            <div className="relative flex items-start gap-3 rounded-2xl rounded-br-md bg-white border border-slate-200 shadow-xl px-4 py-3">
              <Avatar />
              <button onClick={openPanel} className="text-left text-sm text-slate-800 leading-snug pr-4 hover:text-slate-950">
                {TEASER_TEXT}
              </button>
              <button
                onClick={() => setTeaser(false)}
                className="absolute -top-2 -right-2 h-6 w-6 grid place-items-center rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800 shadow-sm"
                aria-label="Baloncuğu kapat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Başlatıcı */}
      <motion.button
        onClick={() => (open ? onOpenChange(false) : openPanel())}
        whileHover={reduce ? undefined : { scale: 1.06 }}
        whileTap={reduce ? undefined : { scale: 0.94 }}
        transition={SPRING}
        className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 h-14 w-14 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 grid place-items-center hover:bg-indigo-500 ${open ? "max-sm:hidden" : ""}`}
        aria-label={open ? "Sohbeti kapat" : `${ASSISTANT_NAME} ile sohbet et`}
        aria-expanded={open}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "x" : "chat"}
            initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
            transition={{ duration: dur ?? 0.18 }}
            className="grid place-items-center"
          >
            {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label={`${ASSISTANT_NAME} sohbet penceresi`}
            initial={{ opacity: 0, y: 24, scale: 0.96, transformOrigin: "bottom right" }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : SPRING}
            className="fixed z-50 inset-0 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[400px] sm:h-[620px] sm:max-h-[calc(100dvh-7rem)] bg-white sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          >
            {/* Başlık */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-3">
                <Avatar />
                <div>
                  <div className="text-sm font-semibold leading-tight">{ASSISTANT_NAME}</div>
                  <div className="text-xs text-slate-500">NextReach iletişim asistanı</div>
                </div>
              </div>
              <button onClick={() => onOpenChange(false)} className="h-8 w-8 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mesajlar */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-slate-50">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
                    m.role === "user" ? "self-end bg-indigo-600 text-white rounded-br-md" : "self-start bg-white border border-slate-200 text-slate-800 rounded-bl-md"
                  }`}
                >
                  {m.content}
                </motion.div>
              ))}

              {sending && !streamed && (
                <motion.div
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="self-start bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 text-slate-400"
                >
                  <Loader variant="dots" size={18} label="Yazıyor" />
                </motion.div>
              )}

              {/* Çipler */}
              <AnimatePresence>
                {!sending && chips.length > 0 && (
                  <motion.div
                    key={chips.join("|")}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-wrap gap-2 self-start pl-1"
                  >
                    {chips.map((c, i) => (
                      <motion.button
                        key={c}
                        onClick={() => void send(c)}
                        initial={reduce ? false : { opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: reduce ? 0 : 0.04 * i, ...SPRING }}
                        whileHover={reduce ? undefined : { y: -1 }}
                        whileTap={reduce ? undefined : { scale: 0.96 }}
                        className="rounded-full border border-indigo-200 bg-white px-3.5 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300"
                      >
                        {c}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {ended && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="self-center mt-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1"
                >
                  Sohbet sonlandırıldı
                </motion.div>
              )}
              {done && !ended && (
                <motion.div
                  key={contactAdded ? "contact" : "done"}
                  initial={reduce ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="self-center mt-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1"
                >
                  {contactAdded ? "İletişim bilginiz talebinize eklendi" : "Talebiniz ekibimize iletildi"}
                </motion.div>
              )}
            </div>

            {error && <p className="px-4 py-2 text-sm text-red-600 bg-red-50 border-t border-red-100">{error}</p>}

            {/* Giriş: talep iletildikten sonra da açık kalır (sorular, geç iletişim bilgisi) */}
            <div className="border-t border-slate-100 p-3 bg-white">
              {(done || ended) && (
                <div className="flex items-center justify-between px-1 pb-2 text-xs text-slate-500">
                  <span>{ended ? "Bu sohbet kapatıldı." : "Sorularınıza devam edebilirsiniz."}</span>
                  <button onClick={resetChat} className="text-indigo-600 hover:underline underline-offset-2">Yeni sohbet</button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={ended ? "Yeni sohbet başlatabilirsiniz" : done ? "Sorunuz varsa yazın…" : "Mesajınızı yazın…"}
                  disabled={ended !== null}
                  maxLength={1000}
                  className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32 disabled:bg-slate-50"
                />
                <motion.button
                  onClick={() => void send(input)}
                  disabled={sending || !input.trim() || ended !== null}
                  whileTap={reduce ? undefined : { scale: 0.92 }}
                  transition={SPRING}
                  className="h-11 w-11 rounded-xl bg-indigo-600 text-white grid place-items-center disabled:opacity-40 hover:bg-indigo-500"
                  aria-label="Gönder"
                >
                  <ArrowUp className="h-5 w-5" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Avatar() {
  return <div className="h-9 w-9 shrink-0 rounded-full bg-indigo-600 text-white grid place-items-center text-sm font-semibold">R</div>;
}
