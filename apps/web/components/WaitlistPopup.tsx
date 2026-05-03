"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { WaitlistForm } from "./WaitlistForm";

interface WaitlistPopupProps {
  delay?: number; // Delay in ms before showing (default: 15000 = 15s)
  exitIntent?: boolean; // Show on exit intent (default: true)
}

export function WaitlistPopup({ delay = 15000, exitIntent = true }: WaitlistPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasShown, setHasShown] = useState(false);

  // Check if user already dismissed or joined
  useEffect(() => {
    const dismissed = localStorage.getItem("waitlist-popup-dismissed");
    const joined = localStorage.getItem("waitlist-joined");
    if (dismissed || joined) {
      setHasShown(true);
    }
  }, []);

  // Time-based trigger
  useEffect(() => {
    if (hasShown) return;

    const timer = setTimeout(() => {
      if (!hasShown) {
        setIsOpen(true);
        setHasShown(true);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, hasShown]);

  // Exit intent trigger
  useEffect(() => {
    if (!exitIntent || hasShown) return;

    const handleMouseLeave = (e: MouseEvent) => {
      // Trigger when mouse leaves from the top of the page
      if (e.clientY <= 0 && !hasShown) {
        setIsOpen(true);
        setHasShown(true);
      }
    };

    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, [exitIntent, hasShown]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem("waitlist-popup-dismissed", "true");
  }, []);

  const handleJoinSuccess = useCallback(() => {
    localStorage.setItem("waitlist-joined", "true");
    // Keep popup open briefly to show success message, then close
    setTimeout(() => setIsOpen(false), 3000);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
        <div className="border border-[color:var(--ll-border)] bg-[var(--ll-bg)] p-6 shadow-2xl sm:p-8">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 text-[var(--ll-muted)] transition hover:text-[var(--ll-text)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Content */}
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ll-accent)]">
              Be first in line
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Link Loom is launching soon
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--ll-muted)]">
              Join the waitlist for early access and exclusive launch perks.
            </p>
          </div>

          <div className="mt-6">
            <WaitlistForm onSuccess={handleJoinSuccess} />
          </div>

          <p className="mt-4 text-center text-xs text-[var(--ll-muted)]">
            No spam, ever. Unsubscribe anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
