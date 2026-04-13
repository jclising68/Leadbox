"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Password reset</CardTitle>
          <CardDescription>LeadBox is an internal tool — password resets go through your admin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            To reset your password, contact your LeadBox administrator with the
            email address you use to sign in. They can reset it via:
          </p>
          <pre className="bg-muted/60 rounded-md p-3 text-xs overflow-x-auto">
{`bun scripts/reset-password.ts <email> <new-password>`}
          </pre>
          <p className="text-muted-foreground">
            Once reset, you&apos;ll be able to sign in with the new password.
          </p>
          <div className="pt-2 text-center">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
