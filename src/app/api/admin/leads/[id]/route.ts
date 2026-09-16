import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { updateLeadStatus } from "@/lib/db";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["waiting", "in_progress", "positive", "negative"]) });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/leads/[id]">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz durum." }, { status: 400 });
  const ok = await updateLeadStatus(id, parsed.data.status);
  if (!ok) return NextResponse.json({ error: "Talep bulunamadı." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
