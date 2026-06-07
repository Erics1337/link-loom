import Image from "next/image";
import { cn } from "@/utils/cn";

type BrandLogoProps = {
  size?: number;
  priority?: boolean;
  className?: string;
  alt?: string;
};

export function BrandLogo({
  size = 36,
  priority = false,
  className,
  alt = "Link Loom",
}: BrandLogoProps) {
  return (
    <Image
      src="/logo.webp"
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      sizes={`${size}px`}
      className={cn("object-contain", className)}
    />
  );
}

type CrestLogoProps = {
  size?: number;
  className?: string;
  alt?: string;
};

export function CrestLogo({
  size = 20,
  className,
  alt = "Crest Code Logo",
}: CrestLogoProps) {
  return (
    <Image
      src="/crest-logo.webp"
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      sizes={`${size}px`}
      className={cn("object-contain", className)}
    />
  );
}
