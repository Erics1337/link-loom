import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  Link as LinkIcon,
  Settings,
  CreditCard,
  LogOut,
  Monitor,
  History,
} from "lucide-react";
import Image from "next/image";
import { unstable_noStore as noStore } from "next/cache";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  noStore();

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user premium status
  const { data: userRecord } = await supabase
    .from("users")
    .select("is_premium,subscription_status")
    .eq("id", user.id)
    .single();

  const isPremium = userRecord?.is_premium ?? false;
  const planLabel = isPremium
    ? userRecord?.subscription_status === "lifetime"
      ? "Pro Lifetime"
      : "Pro Plan"
    : "Free Plan";

  return (
    <div className="ll-field-bg flex min-h-screen text-ll-text">
      {/* Sidebar */}
      <aside className="fixed z-10 flex h-full w-64 flex-col border-r border-ll-border bg-ll-deep/80 backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-ll-border p-6 text-xl font-bold tracking-tight">
          <div className="relative h-8 w-8">
            <Image
              src="/logo.png"
              alt="Link Loom Logo"
              fill
              sizes="32px"
              className="object-contain"
            />
          </div>
          Link Loom
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <a
            href="/dashboard"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </a>
          <a
            href="/dashboard/links"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <LinkIcon className="w-5 h-5" />
            My Links
          </a>
          <a
            href="/dashboard/backups"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <History className="w-5 h-5" />
            Structure Backups
          </a>
          <a
            href="/dashboard/devices"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <Monitor className="w-5 h-5" />
            Devices
          </a>
          <a
            href="/dashboard/settings"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <Settings className="w-5 h-5" />
            Settings
          </a>
          <a
            href="/dashboard/billing"
            className="flex items-center gap-3 rounded-ll-md px-4 py-3 text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text"
          >
            <CreditCard className="w-5 h-5" />
            Billing
          </a>
        </nav>

        <div className="border-t border-ll-border p-4">
          <div className="flex items-center gap-3 px-4 py-3 mb-2">
            <div className="h-8 w-8 rounded-full border border-ll-accent/40 bg-ll-accent-soft" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-ll-text">
                {user.email}
              </p>
              <p
                className={`truncate text-xs ${isPremium ? "text-ll-success" : "text-ll-muted"}`}
              >
                {planLabel}
              </p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="flex w-full items-center gap-3 rounded-ll-md px-4 py-2 text-sm text-ll-muted transition-colors hover:bg-ll-accent-soft hover:text-ll-text">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto ml-64">{children}</main>
    </div>
  );
}
