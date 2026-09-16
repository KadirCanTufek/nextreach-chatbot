import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { countLeadsByKind, listLeads } from "@/lib/db";

export const runtime = "nodejs";

const Query = z.object({
  kind: z.enum(["qualified", "no_contact", "spam"]).optional(),
  range: z.enum(["today", "week", "all"]).optional(),
  score: z.enum(["hot", "warm", "cold"]).optional(),
  status: z.enum(["new", "contacted", "closed"]).optional(),
});

export async function GET(req: NextRequest) {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = Query.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz filtre." }, { status: 400 });

  const [leads, counts] = await Promise.all([listLeads(parsed.data), countLeadsByKind()]);
  return NextResponse.json({ leads, counts });
}
