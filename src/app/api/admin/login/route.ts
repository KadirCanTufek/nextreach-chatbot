import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminToken, isValidAdminKey } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key || !isValidAdminKey(key)) {
    return NextResponse.json({ error: "Anahtar hatalı." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken()!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
