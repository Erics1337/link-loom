import type { ButtonHTMLAttributes, ReactNode } from "react";
import { composeClasses } from "./utils";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function IconButton({
  children,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={composeClasses(
        "inline-flex h-10 w-10 items-center justify-center rounded-ll-md border border-ll-border-strong bg-ll-surface text-ll-text transition hover:bg-ll-accent-soft disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
