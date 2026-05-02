import type { InputHTMLAttributes } from "react";
import { composeClasses } from "./utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={composeClasses(
        "w-full rounded-ll-md border border-ll-border-strong bg-ll-card px-3 py-2 text-sm text-ll-text placeholder:text-ll-muted outline-none transition focus:border-ll-accent disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}
