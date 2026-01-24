
import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:3333';

export type DeviceAuthStatus = 'checking' | 'authorized' | 'limit_reached' | 'error';

export const useDeviceAuth = (userId: string) => {
    const [authStatus, setAuthStatus] = useState<DeviceAuthStatus>('checking');
    const [isPremium, setIsPremium] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) return;

        const registerDevice = async () => {
            try {
                // 1. Get or Generate Device ID
                const result = await chrome.storage.local.get(['deviceId']);
                let deviceId = result.deviceId;

                if (!deviceId) {
                    deviceId = crypto.randomUUID();
                    await chrome.storage.local.set({ deviceId });
                }

                // 2. Register with Backend
                const res = await fetch(`${BACKEND_URL}/register-device`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        deviceId,
                        name: navigator.userAgent // Simple name for now, simpler than parsing
                    })
                });

                if (res.status === 403) {
                    const data = await res.json();
                    setAuthStatus('limit_reached');
                    setErrorMsg(data.error);
                    return;
                }

                if (!res.ok) {
                    throw new Error('Registration failed');
                }

                // 3. Check Premium Status (via status endpoint for efficiency or use the reg response)
                // We'll check via status endpoint as it is already being polled/fetched in main app, 
                // but let's do a quick check here or expose a way to set it.
                // Actually, useBookmarkWeaver calls /status. 
                // Let's just set authorized here.
                setAuthStatus('authorized');

            } catch (err: any) {
                console.error('[DeviceAuth] Error:', err);
                setAuthStatus('error');
                setErrorMsg(err.message);
            }
        };

        registerDevice();
    }, [userId]);

    return { authStatus, isPremium, errorMsg, setAuthStatus };
};
