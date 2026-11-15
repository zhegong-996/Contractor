// cn from Paperclip AI (MIT), 8cd2d6a73d2097253dd329f55b637e12b20361c6, ui/src/lib/utils.ts.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
