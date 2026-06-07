import { BrandLogo } from "@/components/BrandLogo";

export function LogoMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandLogo size={36} priority={!inverse} />
      <span
        className={`text-lg font-semibold tracking-tight ${inverse ? "text-[var(--ll-deep-text)]" : "text-[var(--ll-text)]"}`}
      >
        Link Loom
      </span>
    </div>
  );
}
