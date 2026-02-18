
import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:3333';
const BACKEND_UNAVAILABLE_MESSAGE = `Cannot reach Link Loom backend at ${BACKEND_URL}.`;

export type DeviceAuthStatus = 'checking' | 'authorized' | 'limit_reached' | 'error';

const isFailedFetchError = (error: unknown) =>
    error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch');

export const useDeviceAuth = (userId: string) => {
    const [authStatus, setAuthStatus] = useState<DeviceAuthStatus>('checking');
    const [isPremium] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) {
            setAuthStatus('authorized');
            setErrorMsg(null);
            return;
        }

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
                if (isFailedFetchError(err)) {
                    console.warn('[DeviceAuth] Backend not reachable; skipping device registration for now.');
                    setAuthStatus('error');
                    setErrorMsg(BACKEND_UNAVAILABLE_MESSAGE);
                    return;
                }
                console.error('[DeviceAuth] Error:', err);
                setAuthStatus('error');
                setErrorMsg(err.message);
            }
        };

        registerDevice();
    }, [userId]);

    return { authStatus, isPremium, errorMsg, setAuthStatus };
};
