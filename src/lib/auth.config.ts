import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth config. No Prisma adapter, no Node-only providers —
 * this is the slice the proxy/middleware can import without dragging
 * Prisma into the edge runtime. The full config (in auth.ts) spreads
 * this object and adds the Credentials provider + adapter.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
