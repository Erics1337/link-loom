'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Trash2, Monitor, Clock, AlertTriangle } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
        .from('user_devices')
        .select('*')
        .order('last_seen_at', { ascending: false });
      
      if (error) throw error;
      setDevices(data || []);
    } catch (error) {
      console.error('Error fetching devices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [supabase]);

  const handleRevoke = async (deviceId: string) => {
    if (!confirm('Are you sure you want to remove this device? It will be logged out.')) return;
    
    try {
      const { error } = await supabase
        .from('user_devices')
        .delete()
        .eq('id', deviceId);

      if (error) throw error;
      
      // Optimistic update
      setDevices(devices.filter(d => d.id !== deviceId));
    } catch (error) {
      console.error('Error revoking device:', error);
      alert('Failed to revoke device');
    }
  };

  return (
    <>
      <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
          <h1 className="text-xl font-semibold text-white">Devices</h1>
      </header>

      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
            <h2 className="text-lg text-white font-medium mb-1">Manage Devices</h2>
            <p className="text-gray-400 text-sm">
                You can have up to 3 active devices. Revoke old devices to make room for new ones.
            </p>
        </div>

        {loading ? (
            <div className="text-gray-400">Loading devices...</div>
        ) : (
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <ul className="divide-y divide-gray-700">
                {devices.length === 0 ? (
                <li className="p-8 text-center text-gray-500">No devices registered. Install the extension to see devices here.</li>
                ) : (
                devices.map((device) => (
                    <li key={device.id} className="p-6 flex items-center justify-between hover:bg-gray-800/80 transition">
                    <div className="flex items-center space-x-4">
                        <div className="bg-gray-700/50 p-3 rounded-xl">
                           {/* Use Monitor or Smartphone based on UA if parsed, defaulting to Monitor */}
                           <Monitor className="text-blue-400" size={24} />
                        </div>
                        <div>
                        <p className="font-semibold text-white">{device.name || 'Unknown Device'}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs font-mono text-gray-500 bg-gray-900/50 px-2 py-0.5 rounded">ID: {device.device_id.slice(0, 8)}...</span>
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                                <Clock size={12} />
                                {new Date(device.last_seen_at).toLocaleDateString()}
                            </span>
                        </div>
                        </div>
                    </div>
                    <button
                        onClick={() => handleRevoke(device.id)}
                        className="text-gray-400 hover:text-red-400 p-2.5 rounded-lg hover:bg-red-400/10 transition group"
                        title="Revoke Access"
                    >
                        <Trash2 size={20} className="group-hover:stroke-red-400" />
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
