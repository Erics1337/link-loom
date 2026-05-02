import type { ButtonHTMLAttributes, ReactNode } from "react";
import { composeClasses } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-ll-primary text-white hover:bg-ll-primary-hover",
  secondary:
    "border-ll-border-strong bg-ll-surface text-ll-text hover:bg-ll-surface-solid",
  ghost:
    "border-transparent bg-transparent text-ll-text hover:bg-ll-accent-soft",
  danger: "border-transparent bg-ll-danger text-white hover:bg-ll-danger/85",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = composeClasses(
    "inline-flex items-center justify-center gap-2 rounded-ll-md border font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-55",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}
