import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class merge helper for the poster component kit.
 *
 * Every styled primitive composes variants through this single boundary, so
 * call sites can override any default class and tailwind-merge resolves
 * conflicts predictably. Kept as a named export because shadcn-style
 * primitives and future screens all reference the same convention.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
