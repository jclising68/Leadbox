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
        src="/branding/leadsbox-icon-only.png"
        alt="Leadsbox"
        width={128}
        height={147}
        priority={priority}
        className={cn("h-8 w-auto", className)}
      />
    );
  }

  return (
    <Image
      src="/branding/leadsbox-wordmark.png"
      alt="Leadsbox"
      width={849}
      height={142}
      priority={priority}
      className={cn("h-8 w-auto", className)}
    />
  );
}
