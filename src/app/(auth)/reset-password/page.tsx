"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Set a new password</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Supabase recovery state
  const [supabaseEmail, setSupabaseEmail] = useState<string | null>(null);
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const initRef = useRef(false);

  // Detect Supabase recovery callback (hash fragment: #access_token=...&type=recovery)
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    // Listen for the PASSWORD_RECOVERY event fired when Supabase detects
    // recovery tokens in the URL hash.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" && session?.user?.email) {
          setSupabaseEmail(session.user.email);
          setSupabaseToken(session.access_token);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const isSupabaseFlow = !!supabaseEmail;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseFlow) {
        // ── Supabase recovery flow ──────────────────────────────────
        const supabase = getSupabaseBrowser();
        if (!supabase) throw new Error("Supabase client not available");

        // 1. Update password in Supabase Auth
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });
        if (updateError) throw new Error(updateError.message);

        // 2. Also update in our User table (bcrypt hash)
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: supabaseEmail,
            password,
            supabaseFlow: true,
            supabaseToken,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(
            data.error || "Could not update password. Try requesting a new link."
          );
        }
      } else {
        // ── Legacy token flow ───────────────────────────────────────
        if (!token) {
          setError("Reset link is missing a token. Request a new one.");
          setLoading(false);
          return;
        }
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(
            data.error ||
              "Could not reset password. Try requesting a new link."
          );
        }
      }

      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Set a new password</CardTitle>
          <CardDescription>
            {done
              ? "Password updated. Taking you to sign-in…"
              : "Choose a new password for your LeadBox account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="text-center text-sm">
              <Link href="/login" className="text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
