"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

export function LinksSearchBar({
  defaultQuery = "",
}: {
  defaultQuery?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      method="GET"
      action="/dashboard/links"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const query = String(formData.get("query") ?? "").trim();
        const params = new URLSearchParams();
        if (query) params.set("query", query);

        startTransition(() => {
          router.push(
            params.toString()
              ? `/dashboard/links?${params.toString()}`
              : "/dashboard/links",
          );
        });
      }}
    >
      <Search
        className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${isPending ? "text-ll-accent" : "text-ll-muted"}`}
        aria-hidden="true"
      />
      <input
        type="text"
        name="query"
        defaultValue={defaultQuery}
        placeholder="Search links..."
        disabled={isPending}
        aria-busy={isPending}
        className="ll-input w-64 rounded-full py-1.5 pl-10 pr-10 text-sm disabled:opacity-70"
      />
      {isPending ? (
        <Loader2
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ll-accent"
          aria-hidden="true"
        />
      ) : null}
    </form>
  );
}
