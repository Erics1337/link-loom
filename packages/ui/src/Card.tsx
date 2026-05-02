import type { HTMLAttributes, ReactNode } from "react";
import { composeClasses } from "./utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  elevated?: boolean;
}

export function Card({
  children,
  className,
  elevated = false,
  ...props
}: CardProps) {
  return (
    <div
      className={composeClasses(
        "rounded-ll-lg border border-ll-border bg-ll-surface text-ll-text",
        elevated && "shadow-ll-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
