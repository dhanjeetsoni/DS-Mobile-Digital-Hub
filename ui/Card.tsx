import { cn } from "@/lib/cn";

/**
 * NOTE: this project has no `@types/react` package (true of every other
 * component here) — so props are declared explicitly instead of extending
 * `HTMLAttributes<HTMLDivElement>`, which silently degrades without those
 * types. Runtime output is identical to the original kit's version.
 */
export interface CardProps {
  /** Lifts the card and adds a brand ring — used for the active/selected state. */
  selected?: boolean;
  interactive?: boolean;
  className?: string;
  children?: any;
  [key: string]: any;
}

export function Card({ selected = false, interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-(--shadow-card)",
        "transition-[border-color,box-shadow,transform] duration-200 ease-(--ease-out)",
        interactive && "cursor-pointer hover:border-line-strong hover:-translate-y-0.5",
        selected && "border-brand shadow-(--shadow-glow)",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: any;
  subtitle?: any;
  actions?: any;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-line px-(--pad) py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: { className?: string; children?: any; [key: string]: any }) {
  return (
    <div className={cn("p-(--pad)", className)} {...rest}>
      {children}
    </div>
  );
}
