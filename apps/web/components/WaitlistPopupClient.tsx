"use client";

import dynamic from "next/dynamic";
import type { WaitlistPopupProps } from "./WaitlistPopup";

export const WaitlistPopupClient = dynamic<WaitlistPopupProps>(
  () =>
    import("./WaitlistPopup").then((mod) => ({
      default: mod.WaitlistPopup,
    })),
  { ssr: false }
);
