import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  // Auth API, webhooks, cron, and MCP routes bypass the session check.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/mcp")
  ) {
    return NextResponse.next();
  }

  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password");

  const isAuth = !!req.auth;

  if (isAuthPage && isAuth) {
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  if (pathname === "/" && isAuth) {
    return NextResponse.redirect(new URL("/inbox", req.url));
  }

  if (!isAuth && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/webhooks|api/cron|api/mcp|.*\\.[\\w]+$).*)",
  ],
};
