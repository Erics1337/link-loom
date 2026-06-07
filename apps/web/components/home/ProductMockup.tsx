"use client";

import { CircleCheck, Search } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";

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

export function ProductMockup() {
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
                <BrandLogo size={42} alt="" />
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
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
                  import structure
                </p>
                <p className="flex items-center gap-2">
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
                  cluster by topic
                </p>
                <p className="flex items-center gap-2">
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--ll-accent)]" />
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
