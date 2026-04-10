import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth API, webhooks, and cron routes without session check
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/register");

  // Use JWT token check (lightweight, no DB query) instead of auth() wrapper
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });
  const isAuth = !!token;

  // Redirect authenticated users away from auth pages
  if (isAuthPage && isAuth) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  // Redirect root to inbox
  if (pathname === "/" && isAuth) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  // Protect dashboard routes - redirect unauthenticated to login
  if (!isAuth && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron).*)",
  ],
};
