import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Show only the hexagon icon (used in collapsed sidebar / small spaces) */
  iconOnly?: boolean;
  /** Tailwind height utility — defaults differ between full + icon variants */
  className?: string;
  priority?: boolean;
};

/**
 * Theme-aware brand logo.
 *
 * Renders both light + dark variants and uses Tailwind's `dark:` variant to
 * toggle visibility. This avoids hydration flicker that a JS-based swap
 * (`useTheme()`) would cause on first paint.
 */
export function Logo({ iconOnly = false, className, priority = false }: LogoProps) {
  if (iconOnly) {
    return (
      <Image
        src="/branding/logo-icon.png"
        alt="LeadBox"
        width={308}
        height={342}
        priority={priority}
        className={cn("h-8 w-auto", className)}
      />
    );
  }

  return (
    <>
      {/* Light theme: dark text on light backgrounds */}
      <Image
        src="/branding/logo-light.png"
        alt="LeadBox"
        width={1001}
        height={248}
        priority={priority}
        className={cn("h-8 w-auto block dark:hidden", className)}
      />
      {/* Dark theme: light text on dark backgrounds */}
      <Image
        src="/branding/logo-dark.png"
        alt="LeadBox"
        width={1034}
        height={275}
        priority={priority}
        className={cn("h-8 w-auto hidden dark:block", className)}
      />
    </>
  );
}
