"use client";

import { useState } from "react";
import Link from "next/link";
import ChatWidget from "@/components/ChatWidget";

const FEATURES = [
  { title: "Kârlılık, ürün bazında", text: "Hangi ürün gerçekten kazandırıyor, hangisi reklam bütçesini yiyor: tek ekranda." },
  { title: "Kanal karşılaştırması", text: "Pazaryeri, kendi siteniz, sosyal satış. Aynı metriklerle yan yana." },
  { title: "Kurulum bir gün", text: "Shopify, ikas, Ticimax, T-Soft ve özel altyapılar için hazır bağlayıcılar." },
];

export default function LandingPage() {
  const [open, setOpen] = useState(false);

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-slate-100">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-6 w-6 rounded-md bg-indigo-600" aria-hidden />
            NextReach
          </div>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-slate-600">
            <a href="#features" className="hover:text-slate-900">Ürün</a>
            <a href="#pricing" className="hover:text-slate-900">Fiyatlandırma</a>
            <button onClick={() => setOpen(true)} className="rounded-full bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800">
              Bize Ulaşın
            </button>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
        <p className="text-sm font-medium text-indigo-600">Orta ölçekli e-ticaret için</p>
        <h1 className="mt-3 text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
          {"Satış verinizi Excel'den kurtarın."}
        </h1>
        <p className="mt-6 text-lg text-slate-600 max-w-2xl">
          {"NextReach, mağazanızın tüm kanallarını tek bir analitik dashboard'da toplar. Neyin sattığını değil, neyin kazandırdığını görürsünüz."}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setOpen(true)}
            className="rounded-full bg-indigo-600 text-white px-6 py-3 text-base font-medium hover:bg-indigo-500 shadow-sm"
          >
            Bize Ulaşın
          </button>
          <a href="#features" className="rounded-full border border-slate-200 px-6 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 text-center">
            Nasıl çalışır
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-500">Form yok. Ne aradığınızı konuşarak anlatın, 1 iş günü içinde dönelim.</p>
      </section>

      <section id="features" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16 grid gap-8 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-white border border-slate-100 p-6">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Fiyatlandırma</h2>
        <p className="mt-2 text-slate-600 max-w-xl">
          Mağaza büyüklüğüne göre kademeli. Aylık sipariş hacminizi söyleyin, size uyan paketi netleştirelim.
        </p>
        <button onClick={() => setOpen(true)} className="mt-6 text-indigo-600 font-medium hover:underline">
          Fiyat sormak için bize ulaşın →
        </button>
      </section>

      <footer className="mt-auto border-t border-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500 flex flex-col sm:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} NextReach</span>
          <Link href="/admin" className="hover:text-slate-700">Ekip girişi</Link>
        </div>
      </footer>

      <ChatWidget open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
