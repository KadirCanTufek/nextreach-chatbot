"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/admin");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? "Anahtar hatalı.");
  }

  return (
    <main className="flex-1 grid place-items-center bg-slate-50 px-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Ekip girişi</h1>
          <p className="text-sm text-slate-500 mt-1">İletişim taleplerini görmek için erişim anahtarını girin.</p>
        </div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Erişim anahtarı"
          className="rounded-xl border border-slate-200 px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !key} className="rounded-xl bg-slate-900 text-white py-2.5 font-medium disabled:opacity-40">
          Giriş
        </button>
      </form>
    </main>
  );
}
