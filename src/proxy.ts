import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/admin-auth";

/** /admin ve /api/admin yollarını tek erişim anahtarıyla korur. Giriş uçları serbesttir. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/admin/login" || pathname === "/api/admin/login";
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (isValidAdminToken(token)) {
    // CSRF: çerezli admin API mutasyonları yalnızca aynı origin'den gelebilir.
    if (pathname.startsWith("/api/") && request.method !== "GET") {
      const origin = request.headers.get("origin");
      const originHost = origin ? safeHost(origin) : null;
      if (!originHost || originHost !== request.nextUrl.host) {
        return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  return NextResponse.redirect(url);
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
