export type Limit = <T>(task: () => Promise<T>) => Promise<T>;

export const createLimit = (concurrency: number): Limit => {
    const maxConcurrency = Math.max(1, Math.floor(concurrency));
    const queue: Array<() => void> = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        queue.shift()?.();
    };

    return async <T>(task: () => Promise<T>) => {
        if (activeCount >= maxConcurrency) {
            await new Promise<void>(resolve => queue.push(resolve));
        }

        activeCount++;
        try {
            return await task();
        } finally {
            next();
        }
    };
};
