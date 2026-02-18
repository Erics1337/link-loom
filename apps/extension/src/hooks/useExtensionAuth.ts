import { useCallback, useEffect, useState } from 'react';

const SESSION_STORAGE_KEY = 'extensionAuthSession';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

type StoredSession = {
    accessToken: string;
    refreshToken?: string;
    user: {
        id: string;
        email?: string | null;
    };
};

export type ExtensionAuthUser = {
    id: string;
    email?: string | null;
};

export type ExtensionAuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
export type ExtensionSignUpResult = {
    userId?: string;
    email?: string | null;
    authenticated: boolean;
    requiresEmailConfirmation: boolean;
};

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const getConfigurationError = () =>
    'Login is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the extension.';

const clearStoredSession = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.remove([SESSION_STORAGE_KEY]);
};

const saveStoredSession = async (session: StoredSession) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
};

const readStoredSession = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null as StoredSession | null;
    const result = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
    const raw = result[SESSION_STORAGE_KEY];
    if (!raw || typeof raw !== 'object') return null;
    return raw as StoredSession;
};

const getAuthenticatedUser = async (accessToken: string) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error(getConfigurationError());
    }

    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error('Session expired. Please log in again.');
    }

    const data = await response.json();
    return {
        id: data.id as string,
        email: (data.email as string | undefined) ?? null
    } as ExtensionAuthUser;
};

export const useExtensionAuth = () => {
    const [status, setStatus] = useState<ExtensionAuthStatus>('loading');
    const [user, setUser] = useState<ExtensionAuthUser | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const hydrate = async () => {
            if (!isConfigured) {
                if (!cancelled) {
                    setStatus('unauthenticated');
                    setErrorMessage(getConfigurationError());
                }
                return;
            }

            try {
                const session = await readStoredSession();
                if (!session?.accessToken) {
                    if (!cancelled) {
                        setStatus('unauthenticated');
                        setUser(null);
                    }
                    return;
                }

                const authUser = await getAuthenticatedUser(session.accessToken);
                if (!cancelled) {
                    setUser(authUser);
                    setStatus('authenticated');
                    setErrorMessage(null);
                }
            } catch (error) {
                await clearStoredSession();
                if (!cancelled) {
                    setStatus('unauthenticated');
                    setUser(null);
                    setErrorMessage(error instanceof Error ? error.message : 'Failed to restore session.');
                }
            }
        };

        hydrate();
        return () => {
            cancelled = true;
        };
    }, []);

    const signIn = useCallback(async (email: string, password: string) => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error(getConfigurationError());
        }

        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ email, password })
        });

        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error_description || payload.msg || 'Invalid email or password.');
        }

        const nextSession: StoredSession = {
            accessToken: payload.access_token as string,
            refreshToken: payload.refresh_token as string | undefined,
            user: {
                id: payload.user?.id as string,
                email: (payload.user?.email as string | undefined) ?? null
            }
        };

        if (!nextSession.user.id || !nextSession.accessToken) {
            throw new Error('Login response was incomplete.');
        }

        await saveStoredSession(nextSession);
        setUser(nextSession.user);
        setStatus('authenticated');
        setErrorMessage(null);
        return nextSession.user;
    }, []);

    const signUp = useCallback(async (email: string, password: string) => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error(getConfigurationError());
        }

        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ email, password })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.msg || payload.error_description || 'Failed to create account.');
        }

        const createdUser = payload.user as { id?: string; email?: string } | undefined;
        const createdEmail = createdUser?.email ?? email;
        const accessToken = payload.access_token as string | undefined;

        if (accessToken && createdUser?.id) {
            const nextSession: StoredSession = {
                accessToken,
                refreshToken: payload.refresh_token as string | undefined,
                user: {
                    id: createdUser.id,
                    email: createdEmail
                }
            };

            await saveStoredSession(nextSession);
            setUser(nextSession.user);
            setStatus('authenticated');
            setErrorMessage(null);
            return {
                userId: nextSession.user.id,
                email: nextSession.user.email,
                authenticated: true,
                requiresEmailConfirmation: false
            } as ExtensionSignUpResult;
        }

        setStatus('unauthenticated');
        return {
            userId: createdUser?.id,
            email: createdEmail,
            authenticated: false,
            requiresEmailConfirmation: true
        } as ExtensionSignUpResult;
    }, []);

    const signOut = useCallback(async () => {
        await clearStoredSession();
        setUser(null);
        setStatus('unauthenticated');
    }, []);

    return {
        status,
        user,
        errorMessage,
        isConfigured,
        signIn,
        signUp,
        signOut
    };
};
