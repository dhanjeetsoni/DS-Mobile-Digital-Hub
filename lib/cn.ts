import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve conflicting Tailwind utility
 * classes (e.g. `cn("p-2", condition && "p-4")` keeps only `p-4`).
 * Used throughout the new `ui/` + `theme/` design-system components.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
