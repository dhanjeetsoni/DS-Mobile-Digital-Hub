import { cn } from "@/lib/cn";

/**
 * NOTE: this project has no `@types/react` package (true of every other
 * component here) — so props are declared explicitly instead of extending
 * `HTMLAttributes<HTMLSpanElement>`, which silently degrades without those
 * types. Runtime output is identical to the original kit's version.
 */
export type BadgeTone = "neutral" | "brand" | "accent" | "ok" | "warn" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-muted border-line",
  brand: "bg-brand-soft text-brand border-brand/35",
  accent: "bg-accent-soft text-accent border-accent/35",
  ok: "bg-ok-soft text-ok border-ok/35",
  warn: "bg-warn-soft text-warn border-warn/35",
  danger: "bg-danger-soft text-danger border-danger/35",
  info: "bg-info-soft text-info border-info/35",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Small leading dot — reads faster than colour alone for status pills. */
  dot?: boolean;
  icon?: any;
  className?: string;
  children?: any;
  [key: string]: any;
}

export function Badge({ tone = "neutral", dot = false, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[0.6875rem] font-semibold uppercase tracking-wide",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {icon}
      {children}
    </span>
  );
}
