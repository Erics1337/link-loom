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
        isAnonymous?: boolean;
    };
};

export type ExtensionAuthUser = {
    id: string;
    email?: string | null;
    isAnonymous?: boolean;
};

export type ExtensionAuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
export type ExtensionSignUpResult = {
    userId?: string;
    email?: string | null;
    accessToken?: string;
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

const buildSessionFromPayload = (payload: any): StoredSession => {
    const user = payload.user as { id?: string; email?: string | null; is_anonymous?: boolean } | undefined;
    const accessToken = payload.access_token as string | undefined;
    if (!user?.id || !accessToken) {
        throw new Error('Auth response was incomplete.');
    }

    return {
        accessToken,
        refreshToken: payload.refresh_token as string | undefined,
        user: {
            id: user.id,
            email: user.email ?? null,
            isAnonymous: Boolean(user.is_anonymous)
        }
    };
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
        email: (data.email as string | undefined) ?? null,
        isAnonymous: Boolean(data.is_anonymous)
    } as ExtensionAuthUser;
};

export const useExtensionAuth = () => {
    const [status, setStatus] = useState<ExtensionAuthStatus>('loading');
    const [user, setUser] = useState<ExtensionAuthUser | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
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
                    setAccessToken(session.accessToken);
                    setRefreshToken(session.refreshToken || null);
                    setStatus('authenticated');
                    setErrorMessage(null);
                }
            } catch (error) {
                await clearStoredSession();
                if (!cancelled) {
                    setStatus('unauthenticated');
                    setUser(null);
                    setAccessToken(null);
                    setRefreshToken(null);
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
            throw new Error(payload.message || payload.error_description || payload.msg || 'Invalid email or password.');
        }

        const nextSession = buildSessionFromPayload(payload);

        await saveStoredSession(nextSession);
        setUser(nextSession.user);
        setAccessToken(nextSession.accessToken);
        setRefreshToken(nextSession.refreshToken || null);
        setStatus('authenticated');
        setErrorMessage(null);
        return nextSession.user;
    }, []);

    const ensureAnonymousSession = useCallback(async () => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error(getConfigurationError());
        }

        if (user && accessToken) {
            return { user, accessToken };
        }

        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({})
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.message || payload.msg || payload.error_description || 'Failed to start anonymous session.');
        }

        const nextSession = buildSessionFromPayload(payload);
        await saveStoredSession(nextSession);
        setUser(nextSession.user);
        setAccessToken(nextSession.accessToken);
        setStatus('authenticated');
        setErrorMessage(null);
        return { user: nextSession.user, accessToken: nextSession.accessToken };
    }, [accessToken, user]);

    const signUp = useCallback(async (email: string, password: string) => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error(getConfigurationError());
        }

        if (user?.isAnonymous && accessToken) {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${accessToken}`
                },
                body: JSON.stringify({ email, password })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.message || payload.msg || payload.error_description || 'Failed to attach email to session.');
            }

            const nextUser: ExtensionAuthUser = {
                id: payload.id || user.id,
                email: (payload.email as string | undefined) ?? email,
                isAnonymous: Boolean(payload.is_anonymous)
            };
            const nextSession: StoredSession = {
                accessToken,
                user: nextUser
            };
            await saveStoredSession(nextSession);
            setUser(nextUser);
            setStatus('authenticated');
            setErrorMessage(null);

            return {
                userId: nextUser.id,
                email: nextUser.email,
                accessToken,
                authenticated: true,
                requiresEmailConfirmation: Boolean(payload.email_change_sent_at)
            } as ExtensionSignUpResult;
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
            throw new Error(payload.message || payload.msg || payload.error_description || 'Failed to create account.');
        }

        const createdUser = payload.user as { id?: string; email?: string } | undefined;
        const createdEmail = createdUser?.email ?? email;
        const createdAccessToken = payload.access_token as string | undefined;

        if (createdAccessToken && createdUser?.id) {
            const nextSession = buildSessionFromPayload(payload);

            await saveStoredSession(nextSession);
            setUser(nextSession.user);
            setAccessToken(nextSession.accessToken);
            setRefreshToken(nextSession.refreshToken || null);
            setStatus('authenticated');
            setErrorMessage(null);
            return {
                userId: nextSession.user.id,
                email: nextSession.user.email,
                accessToken: nextSession.accessToken,
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
    }, [accessToken, user]);

    const signOut = useCallback(async () => {
        await clearStoredSession();
        setUser(null);
        setAccessToken(null);
        setRefreshToken(null);
        setStatus('unauthenticated');
    }, []);

    return {
        status,
        user,
        accessToken,
        refreshToken,
        errorMessage,
        isConfigured,
        ensureAnonymousSession,
        signIn,
        signUp,
        signOut
    };
};
