const cancelledUsers = new Set<string>();

export const markUserCancelled = (userId: string) => {
    cancelledUsers.add(userId);
};

export const clearUserCancelled = (userId: string) => {
    cancelledUsers.delete(userId);
};

export const isUserCancelled = (userId: string) => cancelledUsers.has(userId);

