import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe NextAuth instance for the proxy/middleware layer. This pulls
// the cookie-decoding logic out of next-auth itself (which knows the
// correct cookie name + salt for v5, including the `__Secure-` prefix in
// production) instead of relying on `getToken()`, which has edge-runtime
// quirks around chunked / secure cookies that caused post-login requests
// to be treated as unauthenticated and bounced back to /login.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Auth API, webhooks, and cron routes bypass the session check.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  // Public auth pages — anyone can reach these without being bounced to
  // /login by the guard below. Forgot/reset must be here so users who
  // can't log in can still recover.
  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password");

  const isAuth = !!req.auth;

  // Already-logged-in users shouldn't see auth pages.
  if (isAuthPage && isAuth) {
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  // Root → inbox for logged-in users.
  if (pathname === "/" && isAuth) {
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  // Protect dashboard routes — anonymous users go to /login.
  if (!isAuth && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron).*)",
  ],
};
