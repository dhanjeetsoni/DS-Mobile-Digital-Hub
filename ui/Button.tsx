import { forwardRef } from "react";

import { cn } from "@/lib/cn";

/**
 * NOTE: this project has no `@types/react` package (true of every other
 * component here) — so props are declared explicitly instead of extending
 * `ButtonHTMLAttributes<HTMLButtonElement>`, which silently degrades without
 * those types. Runtime output is identical to the original kit's version.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "success";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-fg hover:bg-brand-hi active:brightness-95 shadow-[0_1px_0_rgb(255_255_255/0.12)_inset]",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  outline: "bg-transparent text-ink border border-line-strong hover:bg-surface-2",
  danger: "bg-danger text-ink-invert hover:brightness-110 active:brightness-95",
  success: "bg-ok text-ink-invert hover:brightness-110 active:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem] gap-1.5 rounded-sm",
  md: "h-[var(--control-h)] px-4 text-sm gap-2 rounded-md",
  lg: "h-12 px-6 text-base gap-2.5 rounded-md",
  icon: "h-[var(--control-h)] w-[var(--control-h)] rounded-md",
};

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks input; keeps width so the row doesn't jump. */
  loading?: boolean;
  leading?: any;
  trailing?: any;
  className?: string;
  children?: any;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  [key: string]: any;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leading,
    trailing,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,color,box-shadow,transform] duration-150 ease-(--ease-out)",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="absolute size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      <span
        className={cn(
          "inline-flex items-center gap-[inherit]",
          loading && "invisible",
        )}
      >
        {leading}
        {children}
        {trailing}
      </span>
    </button>
  );
});
