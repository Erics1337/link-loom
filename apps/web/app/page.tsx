"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  FileSearch,
  FolderTree,
  Layers3,
  Loader2,
  Mail,
  Search,
  Sparkles,
} from "lucide-react";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { WaitlistForm } from "@/components/WaitlistForm";
import { WaitlistPopup } from "@/components/WaitlistPopup";

const linkExamples = [
  {
    title: "React server actions notes",
    url: "nextjs.org/docs/app",
    cluster: "Frontend systems",
  },
  {
    title: "Supabase auth edge cases",
    url: "supabase.com/docs",
    cluster: "Auth and data",
  },
  {
    title: "Agent workflow patterns",
    url: "vercel.com/blog",
    cluster: "AI tooling",
  },
];

const capabilities = [
  {
    icon: Search,
    label: "Search by meaning",
    copy: "Ask for a concept, framework, or half-remembered problem. Link Loom looks past page titles.",
  },
  {
    icon: FolderTree,
    label: "Let folders emerge",
    copy: "AI clustering proposes structure from the links you already saved, then lets you keep control.",
  },
  {
    icon: FileSearch,
    label: "Clean stale corners",
    copy: "Spot duplicates, dead links, and vague names before your bookmark bar becomes archaeology.",
  },
];

const workflow = [
  "Import browser bookmarks from the extension.",
  "Review clusters, tags, and renamed links.",
  "Search from the dashboard when you need the trail again.",
];

const included = [
  "Unlimited bookmarks",
  "Advanced semantic organization",
  "Smart bookmark renaming",
  "Duplicate and dead-link cleanup",
  "Priority support",
  "Early feature access",
];

function LogoMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-9 w-9">
        <Image
          src="/logo.png"
          alt="Link Loom"
          fill
          sizes="36px"
          className="object-contain"
        />
      </div>
      <span
        className={`text-lg font-semibold tracking-tight ${inverse ? "text-[var(--ll-deep-text)]" : "text-[var(--ll-text)]"}`}
      >
        Link Loom
      </span>
    </div>
  );
}

function ProductMockup() {
  return (
    <CardContainer containerClassName="py-0" className="w-full">
      <CardBody className="relative h-auto w-full max-w-[620px]">
        <CardItem
          translateZ={18}
          className="absolute -left-6 top-16 hidden h-28 w-28 border border-[color:var(--ll-primary)] md:block"
        >
          <span className="sr-only">Depth guide</span>
        </CardItem>
        <CardItem
          translateZ={28}
          className="absolute -right-4 bottom-12 hidden h-36 w-24 border border-[color:var(--ll-accent)] md:block"
        >
          <span className="sr-only">Depth guide</span>
        </CardItem>

        <CardItem
          translateZ={42}
          className="relative w-full border border-[color:var(--ll-border)] bg-[var(--ll-card)] shadow-[0_28px_80px_var(--ll-shadow)]"
        >
          <div className="flex items-center justify-between border-b border-[color:var(--ll-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--ll-primary)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--ll-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--ll-accent)]" />
            </div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ll-muted)]">
              semantic map
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1fr_15rem]">
            <div className="p-5 sm:p-6">
              <CardItem
                translateZ={76}
                className="flex w-full items-center gap-3 border border-[color:var(--ll-border)] bg-[var(--ll-surface-solid)] px-4 py-3 shadow-sm"
              >
                <Search className="h-4 w-4 text-[var(--ll-accent)]" />
                <span className="text-sm text-[var(--ll-soft)]">
                  find the auth article with the redirect bug
                </span>
              </CardItem>

              <div className="mt-5 space-y-3">
                {linkExamples.map((item, index) => (
                  <CardItem
                    key={item.title}
                    translateZ={64 + index * 8}
                    className="w-full border border-[color:var(--ll-border)] bg-[var(--ll-surface-solid)] p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ll-text)]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs text-[var(--ll-muted)]">
                          {item.url}
                        </p>
                      </div>
                      <span className="whitespace-nowrap border border-[color:var(--ll-accent)] bg-[var(--ll-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--ll-accent-text)]">
                        {item.cluster}
                      </span>
                    </div>
                  </CardItem>
                ))}
              </div>
            </div>

            <div className="border-t border-[color:var(--ll-border)] bg-[var(--ll-deep)] p-5 text-[var(--ll-deep-text)] lg:border-l lg:border-t-0">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ll-deep-muted)]">
                extension
              </div>
              <CardItem
                translateZ={88}
                className="mt-5 flex items-center gap-3"
              >
                <Image
                  src="/logo.png"
                  alt=""
                  width={42}
                  height={42}
                  className="object-contain"
                />
                <div>
                  <p className="text-sm font-semibold">Ready to organize</p>
                  <p className="text-xs text-[var(--ll-deep-muted)]">
                    Chrome bookmarks
                  </p>
                </div>
              </CardItem>
              <CardItem
                as="button"
                translateZ={72}
                className="mt-6 w-full bg-[var(--ll-primary)] px-4 py-3 text-sm font-semibold text-white"
              >
                Organize Bookmarks
              </CardItem>
              <div className="mt-4 space-y-2 text-xs text-[var(--ll-deep-muted)]">
                <p className="flex items-center gap-2">
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />{" "}
                  import structure
                </p>
                <p className="flex items-center gap-2">
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />{" "}
                  cluster by topic
                </p>
                <p className="flex items-center gap-2">
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />{" "}
                  review before apply
                </p>
              </div>
            </div>
          </div>
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

export default function Home() {
  return (
    <div className="ll-home min-h-screen bg-[var(--ll-bg)] text-[var(--ll-text)]">
      <header className="sticky top-0 z-50 border-b border-[color:var(--ll-border)] bg-[color-mix(in_oklab,var(--ll-bg)_90%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <LogoMark />
          <nav className="hidden items-center gap-7 text-sm font-medium text-[var(--ll-muted)] md:flex">
            <Link href="#workflow" className="hover:text-[var(--ll-text)]">
              Workflow
            </Link>
            <Link href="#pricing" className="hover:text-[var(--ll-text)]">
              Pricing
            </Link>
          </nav>
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--ll-muted)] transition hover:text-[var(--ll-text)]"
          >
            Existing user? Log in
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-[color:var(--ll-border)]">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24">
            <div>
              <div className="inline-flex items-center gap-2 border border-[color:var(--ll-border)] bg-[var(--ll-surface)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ll-muted)]">
                <BookmarkCheck className="h-4 w-4 text-[var(--ll-accent)]" />
                AI bookmark workspace
              </div>

              {/* Chrome Extension Badge */}
              <a
                href="https://chromewebstore.google.com/detail/link-loom/jdmadgnmcebcecfpcbonmnjdjkmohjhc"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#4285f4]/10 px-3 py-1.5 text-xs font-medium text-[#4285f4] transition hover:bg-[#4285f4]/20"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C8.21 0 5.04 2.16 3.37 5.35L.63 10.5a.6.6 0 0 0 .09.68l11.38 11.38a.6.6 0 0 0 .68.09l5.15-2.74C21.84 18.96 24 15.79 24 12c0-6.63-5.37-12-12-12zM4.8 6.24A9.96 9.96 0 0 1 12 2.4c4.64 0 8.57 3.18 9.69 7.47H12c-2.39 0-4.45 1.46-5.31 3.53L4.8 6.24zm13.08 12.18l-4.34 2.31-8.08-8.08a3.6 3.6 0 0 1 2.77-1.3h9.65c.03.24.04.48.04.73 0 2.41-1.06 4.58-2.72 6.07l-1.32 1.07z"/>
                </svg>
                Get the Chrome Extension
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.94] tracking-tight text-[var(--ll-text)] sm:text-7xl">
                Link Loom
              </h1>
              <p className="mt-6 max-w-xl text-xl leading-8 text-[var(--ll-soft)]">
                Turn years of saved tabs into a searchable map of what you meant
                to remember.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="#waitlist"
                  className="inline-flex items-center justify-center gap-2 bg-[var(--ll-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--ll-primary-hover)]"
                >
                  Join waitlist for early access <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  href="#workflow"
                  className="inline-flex items-center justify-center gap-2 border border-[color:var(--ll-border-strong)] px-6 py-3 text-sm font-semibold text-[var(--ll-text)] transition hover:bg-[var(--ll-surface-solid)]"
                >
                  See workflow
                </Link>
              </div>
            </div>

            <ProductMockup />
          </div>
        </section>

        <section
          id="workflow"
          className="border-b border-[color:var(--ll-border)] bg-[var(--ll-bg-soft)] py-18 sm:py-24"
        >
          <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ll-accent)]">
                  How it works
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                  Keep the human decision. Offload the sorting.
                </h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {workflow.map((item, index) => (
                  <div
                    key={item}
                    className="border-l border-[color:var(--ll-border-strong)] pl-5"
                  >
                    <p className="text-sm font-semibold text-[var(--ll-primary)]">
                      0{index + 1}
                    </p>
                    <p className="mt-4 text-base leading-7 text-[var(--ll-soft)]">
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              {capabilities.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.label}
                    className="border border-[color:var(--ll-border)] bg-[var(--ll-bg)] p-6"
                  >
                    <Icon className="h-6 w-6 text-[var(--ll-accent)]" />
                    <h3 className="mt-8 text-xl font-semibold tracking-tight">
                      {item.label}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-[var(--ll-muted)]">
                      {item.copy}
                    </p>
                  </article>
                );
              })}
            </div>

            {/* Chrome Extension CTA */}
            <div className="mt-10">
              <a
                href="https://chromewebstore.google.com/detail/link-loom/jdmadgnmcebcecfpcbonmnjdjkmohjhc"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center justify-between gap-4 rounded-lg border border-[color:var(--ll-border)] bg-[var(--ll-bg)] p-6 transition hover:border-[#4285f4]/30 hover:bg-[#4285f4]/5 sm:flex-row sm:px-8"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#4285f4]/10 text-[#4285f4]">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C8.21 0 5.04 2.16 3.37 5.35L.63 10.5a.6.6 0 0 0 .09.68l11.38 11.38a.6.6 0 0 0 .68.09l5.15-2.74C21.84 18.96 24 15.79 24 12c0-6.63-5.37-12-12-12zM4.8 6.24A9.96 9.96 0 0 1 12 2.4c4.64 0 8.57 3.18 9.69 7.47H12c-2.39 0-4.45 1.46-5.31 3.53L4.8 6.24zm13.08 12.18l-4.34 2.31-8.08-8.08a3.6 3.6 0 0 1 2.77-1.3h9.65c.03.24.04.48.04.73 0 2.41-1.06 4.58-2.72 6.07l-1.32 1.07z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--ll-text)]">
                      Chrome Extension Available
                    </h3>
                    <p className="text-sm text-[var(--ll-muted)]">
                      One-click bookmark capture from any tab. Already live on the Web Store.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#4285f4]">
                  Install Extension
                  <svg className="h-4 w-4 transition group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
              </a>
            </div>
          </div>
        </section>

        <section className="bg-[var(--ll-deep)] py-18 text-[var(--ll-deep-text)] sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ll-deep-muted)]">
                Built for saved context
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                Your bookmarks are not a filing cabinet.
              </h2>
            </div>
            <div className="space-y-6 text-lg leading-8 text-[var(--ll-deep-soft)]">
              <p>
                They are traces of projects, rabbit holes, research, fixes,
                purchases, and ideas. Link Loom treats them like connected
                material, not a pile of URLs.
              </p>
              <p>
                The dashboard is for retrieval. The extension is for capture and
                review. The AI handles first-pass structure so you can spend
                attention where it matters.
              </p>
            </div>
          </div>
        </section>

        <section
          id="pricing"
          className="border-b border-[color:var(--ll-border)] bg-[var(--ll-bg)] py-18 sm:py-24"
        >
          <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ll-accent)]">
                  Pricing
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                  Free to start. One payment for Pro.
                </h2>
                <p className="mt-5 max-w-lg text-base leading-7 text-[var(--ll-muted)]">
                  Start with up to 500 bookmarks. Upgrade when Link Loom becomes
                  part of your daily retrieval system.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-[1fr_0.8fr]">
                <div className="border border-[color:var(--ll-border)] bg-[var(--ll-surface)] p-6">
                  <div className="flex items-center gap-3">
                    <Layers3 className="h-6 w-6 text-[var(--ll-accent)]" />
                    <h3 className="text-2xl font-semibold tracking-tight">
                      Pro Membership
                    </h3>
                  </div>
                  <ul className="mt-8 grid gap-3 text-sm text-[var(--ll-soft)] sm:grid-cols-2">
                    {included.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 flex-none text-[var(--ll-accent)]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-[var(--ll-deep)] p-6 text-white">
                  <p className="text-sm font-medium text-[var(--ll-deep-muted)]">
                    Lifetime
                  </p>
                  <p className="mt-5 flex items-end gap-2">
                    <span className="text-6xl font-semibold tracking-tight">
                      $29
                    </span>
                    <span className="pb-2 text-sm text-[var(--ll-deep-muted)]">
                      one time
                    </span>
                  </p>
                  <Link
                    href="/login"
                    className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-[var(--ll-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--ll-primary-hover)]"
                  >
                    Get access <Sparkles className="h-4 w-4" />
                  </Link>
                  <p className="mt-5 text-xs leading-5 text-[var(--ll-deep-muted)]">
                    Invoices and receipts available for company reimbursement.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Waitlist ───────────────────────────────────────── */}
        <section
          id="waitlist"
          className="relative overflow-hidden border-b border-[color:var(--ll-border)] bg-[var(--ll-bg)] py-18 sm:py-24"
        >
          {/* Decorative background accents */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(circle at 20% 40%, rgba(143,199,167,0.10), transparent 50%), radial-gradient(circle at 80% 60%, rgba(74,94,163,0.08), transparent 50%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ll-accent)]">
                Be first in line
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                Join the waitlist
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ll-muted)]">
                Link Loom is launching soon. Drop your email and we&apos;ll let
                you know the moment it&apos;s live&nbsp;&mdash; plus early
                access perks for waitlist members.
              </p>
            </div>

            <WaitlistForm />

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-[var(--ll-muted)]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
                No spam, ever
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
                Unsubscribe anytime
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
                Early access perks
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[color:var(--ll-border)] bg-[var(--ll-deep)] px-5 py-10 text-[var(--ll-deep-text)] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <LogoMark inverse />
            <p className="mt-3 text-sm text-[var(--ll-deep-muted)]">
              Copyright 2026 Link Loom. All rights reserved.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:items-end">
            <div className="flex flex-wrap gap-4 text-sm text-[var(--ll-deep-soft)]">
              <a
                href="mailto:support@linkloom.org"
                className="hover:text-white"
              >
                support@linkloom.org
              </a>
              <Link href="/terms" className="hover:text-white">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-white">
                Privacy
              </Link>
              <Link href="/refund-policy" className="hover:text-white">
                Refunds
              </Link>
            </div>
            <div className="inline-flex items-center gap-2 bg-[var(--ll-bg)] px-4 py-2 text-sm text-[var(--ll-muted)]">
              <span>Made with</span>
              <span className="text-[var(--ll-primary)]" aria-hidden="true">
                heart
              </span>
              <span>by</span>
              <Image
                src="/crest-logo.png"
                alt="Crest Code Logo"
                width={20}
                height={20}
                className="h-5 w-5 object-contain"
              />
              <a
                href="https://crestcodecreative.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[var(--ll-soft)] underline hover:text-[var(--ll-text)]"
              >
                Crest Code
              </a>
            </div>
          </div>
        </div>
      </footer>

      <WaitlistPopup delay={15000} exitIntent={true} />
    </div>
  );
}
