"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Trash2, Monitor, Clock, AlertTriangle } from "lucide-react";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Device = {
  id: string;
  device_id: string;
  name: string;
  last_seen_at: string;
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  // const supabase = createClientComponentClient(); // Removed
  const router = useRouter();

  const fetchDevices = async () => {
    try {
      const { data, error } = await supabase
        .from("user_devices")
        .select("*")
        .order("last_seen_at", { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (error) {
      console.error("Error fetching devices:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [supabase]);

  const handleRevoke = async (deviceId: string) => {
    if (
      !confirm(
        "Are you sure you want to remove this device? It will be logged out.",
      )
    )
      return;

    try {
      const { error } = await supabase
        .from("user_devices")
        .delete()
        .eq("id", deviceId);

      if (error) throw error;

      // Optimistic update
      setDevices(devices.filter((d) => d.id !== deviceId));
    } catch (error) {
      console.error("Error revoking device:", error);
      alert("Failed to revoke device");
    }
  };

  return (
    <>
      <header className="ll-topbar">
        <h1 className="text-xl font-semibold text-ll-text">Devices</h1>
      </header>

      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="mb-1 text-lg font-medium text-ll-text">
            Manage Devices
          </h2>
          <p className="text-sm text-ll-muted">
            You can have up to 3 active devices. Revoke old devices to make room
            for new ones.
          </p>
        </div>

        {loading ? (
          <div className="text-ll-muted">Loading devices...</div>
        ) : (
          <div className="ll-panel">
            <ul className="divide-y divide-ll-border">
              {devices.length === 0 ? (
                <li className="p-8 text-center text-ll-muted">
                  No devices registered. Install the extension to see devices
                  here.
                </li>
              ) : (
                devices.map((device) => (
                  <li
                    key={device.id}
                    className="ll-row flex items-center justify-between p-6"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="rounded-ll-lg border border-ll-border bg-ll-accent-soft p-3">
                        {/* Use Monitor or Smartphone based on UA if parsed, defaulting to Monitor */}
                        <Monitor className="text-ll-accent" size={24} />
                      </div>
                      <div>
                        <p className="font-semibold text-ll-text">
                          {device.name || "Unknown Device"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="rounded border border-ll-border bg-ll-card px-2 py-0.5 font-mono text-xs text-ll-muted">
                            ID: {device.device_id.slice(0, 8)}...
                          </span>
                          <span className="flex items-center gap-1 text-xs text-ll-muted">
                            <Clock size={12} />
                            {new Date(device.last_seen_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevoke(device.id)}
                      className="group rounded-ll-md p-2.5 text-ll-muted transition hover:bg-ll-danger/10 hover:text-ll-danger"
                      title="Revoke Access"
                    >
                      <Trash2
                        size={20}
                        className="group-hover:stroke-ll-danger"
                      />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
