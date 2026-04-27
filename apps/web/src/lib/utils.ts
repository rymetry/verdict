// shadcn/ui 標準のクラス結合ヘルパ。
// - clsx: 条件付き class を扱える
// - tailwind-merge: 後勝ちで競合する Tailwind クラスを統合する
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
