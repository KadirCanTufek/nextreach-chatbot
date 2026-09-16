"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader } from "@/components/motion/loader";
import { ASSISTANT_NAME, GREETING, GREETING_CHIPS, TEASER_DELAY_MS, TEASER_SESSION_KEY, TEASER_TEXT } from "@/lib/chat-config";
import type { ChatMessage, ChatResponse } from "@/lib/types";

const SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sağ altta kalıcı başlatıcı + proaktif baloncuk + sohbet paneli.
 * Form yok: isim, şirket ve iletişim bilgisi sohbette toplanır.
 */
export default function ChatWidget({ open, onOpenChange }: Props) {
  const reduce = useReducedMotion();

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

  // Mobilde baloncuk birkaç saniye sonra kendini gizler; ekran kalabalık kalmasın.
  useEffect(() => {
    if (!teaser) return;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    if (!isMobile) return;
    const t = setTimeout(() => setTeaser(false), 8000);
    return () => clearTimeout(t);
  }, [teaser]);

  // --- Sohbet durumu ---
  // Oturum kimliği ve başlangıç zamanı render'ı etkilemez; ref yeter.
  const sessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: GREETING }]);
  const [chips, setChips] = useState<string[]>(GREETING_CHIPS);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // honeypot

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const openPanel = useCallback(() => {
    setTeaser(false);
    onOpenChange(true);
  }, [onOpenChange]);

  // Panel ilk açıldığında oturum başlar (bot zamanlama kontrolü için).
  useEffect(() => {
    if (open && !sessionRef.current) {
      sessionRef.current = { id: crypto.randomUUID(), startedAt: Date.now() };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages, sending, chips, open, reduce]);

  useEffect(() => {
    if (open && !done) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, done]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending || done) return;
      setError(null);
      setChips([]);
      const next: ChatMessage[] = [...messages, { role: "user", content: text }];
      setMessages(next);
      setInput("");
      setSending(true);
      try {
        const session = (sessionRef.current ??= { id: crypto.randomUUID(), startedAt: Date.now() });
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, startedAt: session.startedAt, website, messages: next }),
        });
        const data = (await res.json()) as ChatResponse & { error?: string };
        if (!res.ok && !data.reply) throw new Error(data.error ?? "Bir sorun oluştu.");
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
        setChips(data.done ? [] : (data.chips ?? []));
        if (data.done) setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bağlantı hatası. Tekrar deneyin.");
        setMessages(messages); // gönderilemeyen mesajı geri al
        setInput(text);
      } finally {
        setSending(false);
      }
    },
    [messages, sending, done, website],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function resetChat() {
    setMessages([{ role: "assistant", content: GREETING }]);
    setChips(GREETING_CHIPS);
    setDone(false);
    setError(null);
    sessionRef.current = { id: crypto.randomUUID(), startedAt: Date.now() };
  }

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

              {sending && (
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
                {!sending && !done && chips.length > 0 && (
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

              {done && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="self-center mt-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1"
                >
                  Talebiniz ekibimize iletildi
                </motion.div>
              )}
            </div>

            {error && <p className="px-4 py-2 text-sm text-red-600 bg-red-50 border-t border-red-100">{error}</p>}

            {/* Honeypot: insanlar görmez, botlar doldurur */}
            <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
              <label>
                Web siteniz
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>

            {/* Giriş */}
            <div className="border-t border-slate-100 p-3 bg-white">
              {done ? (
                <div className="flex gap-2">
                  <button onClick={resetChat} className="flex-1 rounded-xl border border-slate-200 py-3 font-medium text-slate-700 hover:bg-slate-50">
                    Yeni sohbet
                  </button>
                  <button onClick={() => onOpenChange(false)} className="flex-1 rounded-xl bg-slate-900 text-white py-3 font-medium hover:bg-slate-800">
                    Kapat
                  </button>
                </div>
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
                  <motion.button
                    onClick={() => void send(input)}
                    disabled={sending || !input.trim()}
                    whileTap={reduce ? undefined : { scale: 0.92 }}
                    transition={SPRING}
                    className="h-11 w-11 rounded-xl bg-indigo-600 text-white grid place-items-center disabled:opacity-40 hover:bg-indigo-500"
                    aria-label="Gönder"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </motion.button>
                </div>
              )}
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
