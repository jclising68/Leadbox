import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Show only the icon (used in collapsed sidebar / small spaces) */
  iconOnly?: boolean;
  /** Tailwind height utility — defaults differ between full + icon variants */
  className?: string;
  priority?: boolean;
};

export function Logo({ iconOnly = false, className, priority = false }: LogoProps) {
  if (iconOnly) {
    return (
      <Image
        src="/branding/leadassassin-logo.png"
        alt="LeadBox"
        width={2480}
        height={2480}
        priority={priority}
        className={cn("h-8 w-auto", className)}
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src="/branding/leadassassin-logo.png"
        alt="LeadBox"
        width={2480}
        height={2480}
        priority={priority}
        className="h-10 w-10 shrink-0"
      />
      <span
        className="font-[family-name:var(--font-inter)] text-xl font-black tracking-tight text-foreground"
      >
        LEADBOX
      </span>
    </div>
  );
}
