import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const isAuthPage =
    req.nextUrl.pathname.startsWith("/login") ||
    req.nextUrl.pathname.startsWith("/register");
  const isApiAuth = req.nextUrl.pathname.startsWith("/api/auth");
  const isWebhook = req.nextUrl.pathname.startsWith("/api/webhooks");
  const isCron = req.nextUrl.pathname.startsWith("/api/cron");

  // Allow webhook, cron, and auth API routes without session auth
  if (isApiAuth || isWebhook || isCron) return NextResponse.next();

  // Redirect authenticated users away from auth pages
  if (isAuthPage && isAuth) {
    // Will be redirected to workspace URL by dashboard layout
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  // Redirect root to inbox (dashboard layout handles workspace redirect)
  if (req.nextUrl.pathname === "/" && isAuth) {
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  // Protect dashboard routes
  if (!isAuth && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron).*)"],
};
