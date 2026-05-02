import type { HTMLAttributes, ReactNode } from "react";
import { composeClasses } from "./utils";

export type BadgeTone =
  | "accent"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  accent: "border-ll-accent/40 bg-ll-accent-soft text-ll-accent-text",
  primary: "border-ll-primary/35 bg-ll-primary/10 text-ll-primary",
  success: "border-ll-success/35 bg-ll-success/10 text-ll-success",
  warning: "border-ll-warning/35 bg-ll-warning/10 text-ll-warning",
  danger: "border-ll-danger/35 bg-ll-danger/10 text-ll-danger",
  muted: "border-ll-border bg-ll-surface text-ll-muted",
};

export function Badge({
  children,
  className,
  tone = "accent",
  ...props
}: BadgeProps) {
  return (
    <span
      className={composeClasses(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
