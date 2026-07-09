import React from "react";

export const formatTimestamp = (timestamp: string) => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleString();
};

export const useWorkingMessage = () => {
  const [workingId, setWorkingId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const pendingPromiseRef = React.useRef<Promise<void>>(Promise.resolve());

  const runWithWorkingId = React.useCallback(
    async (
      itemId: string,
      action: () => Promise<void>,
      messages: { success?: string; failure: string },
    ) => {
      pendingPromiseRef.current = pendingPromiseRef.current.then(async () => {
        setWorkingId(itemId);
        setMessage(null);
        try {
          await action();
          if (messages.success) setMessage(messages.success);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : messages.failure);
        } finally {
          setWorkingId(null);
        }
      });
      return pendingPromiseRef.current;
    },
    [],
  );

  return { workingId, message, setMessage, runWithWorkingId };
};
