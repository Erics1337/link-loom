export const SESSION_STORAGE_KEY = 'extensionAuthSession';

export type StoredSession = {
    accessToken: string;
    refreshToken?: string;
    user: {
        id: string;
        email?: string | null;
        isAnonymous?: boolean;
    };
};

export type ExtensionAuthMessage =
    | {
          type: 'LINK_LOOM_EXTENSION_AUTH';
          access_token: string;
          refresh_token?: string;
          user: {
              id: string;
              email?: string | null;
          };
      }
    | {
          type: 'LINK_LOOM_EXTENSION_AUTH_ERROR';
          error: string;
          message?: string;
      };

export const buildStoredSessionFromAuthMessage = (
    message: Extract<ExtensionAuthMessage, { type: 'LINK_LOOM_EXTENSION_AUTH' }>
): StoredSession => ({
    accessToken: message.access_token,
    refreshToken: message.refresh_token,
    user: {
        id: message.user.id,
        email: message.user.email ?? null,
        isAnonymous: false
    }
});

export const AUTH_COMPLETE_MESSAGE = 'AUTH_COMPLETE' as const;
export const AUTH_ERROR_MESSAGE = 'AUTH_ERROR' as const;
