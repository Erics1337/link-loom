import type { HTMLAttributes, ReactNode } from "react";
import { composeClasses } from "./utils";

export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: AlertTone;
}

const toneClasses: Record<AlertTone, string> = {
  info: "border-ll-accent/35 bg-ll-accent-soft text-ll-accent-text",
  success: "border-ll-success/35 bg-ll-success/10 text-ll-success",
  warning: "border-ll-warning/35 bg-ll-warning/10 text-ll-warning",
  danger: "border-ll-danger/35 bg-ll-danger/10 text-ll-danger",
};

export function Alert({
  children,
  className,
  tone = "info",
  ...props
}: AlertProps) {
  return (
    <div
      className={composeClasses(
        "rounded-ll-md border px-3 py-2 text-sm font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
