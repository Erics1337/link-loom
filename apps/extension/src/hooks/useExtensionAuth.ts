import { useCallback, useEffect, useState } from 'react';
import {
    AUTH_COMPLETE_MESSAGE,
    AUTH_ERROR_MESSAGE,
    SESSION_STORAGE_KEY,
    StoredSession
} from '../lib/extensionAuthSession';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
    | string
    | undefined;
const WEB_APP_URL =
    (import.meta.env.VITE_WEB_APP_URL as string | undefined) ||
    'https://linkloom.org';
const GOOGLE_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export type ExtensionAuthUser = {
    id: string;
    email?: string | null;
    isAnonymous?: boolean;
};

export type ExtensionAuthStatus =
    | 'loading'
    | 'authenticated'
    | 'unauthenticated'
    | 'error';
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
    const user = payload.user as
        | { id?: string; email?: string | null; is_anonymous?: boolean }
        | undefined;
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
    if (typeof chrome === 'undefined' || !chrome.storage?.local)
        return null as StoredSession | null;
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

const authJsonRequest = async (
    path: string,
    options: {
        method: 'POST' | 'PUT';
        body: Record<string, unknown>;
        bearerToken?: string;
        failureMessage: string;
    }
) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error(getConfigurationError());
    }

    const response = await fetch(`${SUPABASE_URL}${path}`, {
        method: options.method,
        headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${options.bearerToken ?? SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(options.body)
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(
            payload.message ||
                payload.msg ||
                payload.error_description ||
                options.failureMessage
        );
    }

    return payload;
};

export const useExtensionAuth = () => {
    const [status, setStatus] = useState<ExtensionAuthStatus>('loading');
    const [user, setUser] = useState<ExtensionAuthUser | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const applyAuthenticatedSession = useCallback(
        async (nextSession: StoredSession) => {
            await saveStoredSession(nextSession);
            setUser(nextSession.user);
            setAccessToken(nextSession.accessToken);
            setRefreshToken(nextSession.refreshToken || null);
            setStatus('authenticated');
            setErrorMessage(null);
        },
        []
    );

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

                const authUser = await getAuthenticatedUser(
                    session.accessToken
                );
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
                    setErrorMessage(
                        error instanceof Error
                            ? error.message
                            : 'Failed to restore session.'
                    );
                }
            }
        };

        hydrate();
        return () => {
            cancelled = true;
        };
    }, []);

    const signIn = useCallback(
        async (email: string, password: string) => {
            const payload = await authJsonRequest(
                '/auth/v1/token?grant_type=password',
                {
                    method: 'POST',
                    body: { email, password },
                    failureMessage: 'Invalid email or password.'
                }
            );

            const nextSession = buildSessionFromPayload(payload);

            await applyAuthenticatedSession(nextSession);
            return nextSession.user;
        },
        [applyAuthenticatedSession]
    );

    const ensureAnonymousSession = useCallback(async () => {
        if (user && accessToken) {
            return { user, accessToken };
        }

        const payload = await authJsonRequest('/auth/v1/signup', {
            method: 'POST',
            body: {},
            failureMessage: 'Failed to start anonymous session.'
        });

        const nextSession = buildSessionFromPayload(payload);
        await applyAuthenticatedSession(nextSession);
        return { user: nextSession.user, accessToken: nextSession.accessToken };
    }, [accessToken, applyAuthenticatedSession, user]);

    const signUp = useCallback(
        async (email: string, password: string) => {
            if (user?.isAnonymous && accessToken) {
                const payload = await authJsonRequest('/auth/v1/user', {
                    method: 'PUT',
                    body: { email, password },
                    bearerToken: accessToken,
                    failureMessage: 'Failed to attach email to session.'
                });

                const nextUser: ExtensionAuthUser = {
                    id: payload.id || user.id,
                    email: (payload.email as string | undefined) ?? email,
                    isAnonymous: Boolean(payload.is_anonymous)
                };
                const nextSession: StoredSession = {
                    accessToken,
                    refreshToken: refreshToken ?? undefined,
                    user: nextUser
                };
                await applyAuthenticatedSession(nextSession);

                return {
                    userId: nextUser.id,
                    email: nextUser.email,
                    accessToken,
                    authenticated: true,
                    requiresEmailConfirmation: Boolean(
                        payload.email_change_sent_at
                    )
                } as ExtensionSignUpResult;
            }

            const payload = await authJsonRequest('/auth/v1/signup', {
                method: 'POST',
                body: { email, password },
                failureMessage: 'Failed to create account.'
            });

            const createdUser = payload.user as
                | { id?: string; email?: string }
                | undefined;
            const createdEmail = createdUser?.email ?? email;
            const createdAccessToken = payload.access_token as
                | string
                | undefined;

            if (createdAccessToken && createdUser?.id) {
                const nextSession = buildSessionFromPayload(payload);

                await applyAuthenticatedSession(nextSession);
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
        },
        [accessToken, applyAuthenticatedSession, refreshToken, user]
    );

    const signOut = useCallback(async () => {
        await clearStoredSession();
        setUser(null);
        setAccessToken(null);
        setRefreshToken(null);
        setStatus('unauthenticated');
    }, []);

    const signInWithGoogle = useCallback(async () => {
        if (!isConfigured) {
            throw new Error(getConfigurationError());
        }

        if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.tabs?.create) {
            throw new Error('Google sign in is only available in the extension.');
        }

        const extensionId = chrome.runtime.id;
        const authUrl = `${WEB_APP_URL}/auth/extension-login?ext_id=${encodeURIComponent(extensionId)}`;

        return new Promise<ExtensionAuthUser>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeoutId);
                chrome.runtime.onMessage.removeListener(onMessage);
            };

            const onMessage = (message: {
                type?: string;
                session?: StoredSession;
                error?: string;
                message?: string;
            }) => {
                if (message?.type === AUTH_COMPLETE_MESSAGE && message.session) {
                    cleanup();
                    applyAuthenticatedSession(message.session)
                        .then(() => resolve(message.session!.user))
                        .catch(reject);
                    return;
                }

                if (message?.type === AUTH_ERROR_MESSAGE) {
                    cleanup();
                    reject(
                        new Error(
                            message.message ||
                                (message.error === 'waitlist_only'
                                    ? 'Sign up is currently waitlist-only. Please join the waitlist for early access.'
                                    : 'Google sign in failed.')
                        )
                    );
                }
            };

            const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error('Google sign in timed out. Try again.'));
            }, GOOGLE_SIGN_IN_TIMEOUT_MS);

            chrome.runtime.onMessage.addListener(onMessage);
            chrome.tabs.create({ url: authUrl });
        });
    }, [applyAuthenticatedSession]);

    return {
        status,
        user,
        accessToken,
        refreshToken,
        errorMessage,
        isConfigured,
        ensureAnonymousSession,
        signIn,
        signInWithGoogle,
        signUp,
        signOut
    };
};
