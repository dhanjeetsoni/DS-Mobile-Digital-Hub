import { Check, Monitor, Moon, Sun } from "lucide-react";

import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/lib/cn";

import {
  DENSITIES,
  TEXT_SIZES,
  THEMES,
  type Density,
  type TextSize,
  type ThemeMeta,
} from "./themes";
import { useAppearance } from "./useAppearance";

function SwatchStrip({ theme }: { theme: ThemeMeta }) {
  const mode = useAppearance((s) => s.mode);
  const [canvas, surface, brand, accent] = theme.swatch[mode];
  return (
    <div
      className="flex h-14 overflow-hidden rounded-md border border-line"
      style={{ background: canvas }}
      aria-hidden
    >
      <span className="flex-1" style={{ background: canvas }} />
      <span className="flex-1" style={{ background: surface }} />
      <span className="flex-[1.4]" style={{ background: brand }} />
      <span className="flex-1" style={{ background: accent }} />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  format?: (option: T) => string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors duration-150",
              option === value
                ? "bg-brand text-brand-fg"
                : "text-ink-muted hover:bg-surface-3 hover:text-ink",
            )}
          >
            {format ? format(option) : option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemePicker({ className }: { className?: string }) {
  const themeId = useAppearance((s) => s.themeId);
  const mode = useAppearance((s) => s.mode);
  const followSystem = useAppearance((s) => s.followSystem);
  const density = useAppearance((s) => s.density);
  const textSize = useAppearance((s) => s.textSize);
  const setTheme = useAppearance((s) => s.setTheme);
  const setMode = useAppearance((s) => s.setMode);
  const setFollowSystem = useAppearance((s) => s.setFollowSystem);
  const setDensity = useAppearance((s) => s.setDensity);
  const setTextSize = useAppearance((s) => s.setTextSize);

  return (
    <section className={cn("space-y-(--gap)", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-ink-muted">
            Ten themes, each in light and dark. The change applies instantly and is
            remembered on this device.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-line bg-surface-2 p-0.5">
          <Button
            size="sm"
            variant={!followSystem && mode === "light" ? "primary" : "ghost"}
            onClick={() => setMode("light")}
            leading={<Sun className="size-3.5" />}
          >
            Light
          </Button>
          <Button
            size="sm"
            variant={!followSystem && mode === "dark" ? "primary" : "ghost"}
            onClick={() => setMode("dark")}
            leading={<Moon className="size-3.5" />}
          >
            Dark
          </Button>
          <Button
            size="sm"
            variant={followSystem ? "primary" : "ghost"}
            onClick={() => setFollowSystem(true)}
            leading={<Monitor className="size-3.5" />}
          >
            System
          </Button>
        </div>
      </header>

      <div className="grid gap-(--gap) sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {THEMES.map((theme) => {
          const active = theme.id === themeId;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setTheme(theme.id)}
              aria-pressed={active}
              className={cn(
                "group rounded-lg border bg-surface p-3 text-left",
                "transition-[border-color,box-shadow,transform] duration-200 ease-(--ease-out)",
                active
                  ? "border-brand shadow-(--shadow-glow)"
                  : "border-line hover:-translate-y-0.5 hover:border-line-strong",
              )}
            >
              <SwatchStrip theme={theme} />
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{theme.name}</span>
                {active ? (
                  <Check className="size-4 shrink-0 text-brand" aria-label="Active" />
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{theme.tagline}</p>
              {theme.id === "contrast" ? (
                <Badge tone="info" className="mt-2">
                  Accessibility
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-6 border-t border-line pt-(--gap)">
        <Segmented<Density>
          label="Density"
          options={DENSITIES}
          value={density}
          onChange={setDensity}
        />
        <Segmented<TextSize>
          label="Text size"
          options={TEXT_SIZES}
          value={textSize}
          onChange={setTextSize}
          format={(option) => option.toUpperCase()}
        />
      </div>
    </section>
  );
}

