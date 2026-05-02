"use client";

import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Alert, Button, Card, IconButton, Input } from "@link-loom/ui";

export function AddLinkModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsLoading(true);

    try {
      // Basic URL validation
      new URL(url);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("You must be logged in to add a link.");
      }

      // Write straight to db; backend ingestion queues will take over
      const { error: dbError } = await supabase.from("bookmarks").insert({
        user_id: user.id,
        chrome_id: `manual-${crypto.randomUUID()}`,
        url,
        title: "Adding link...", // Placeholder until enriched
        status: "pending",
      });

      if (dbError) throw dbError;

      setSuccess(true);
      setTimeout(() => {
        setIsOpen(false);
        setUrl("");
        setSuccess(false);
      }, 1500); // Delay closing so they can see the success message
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to add link. Ensure it is a valid URL.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="ll-action-primary px-4 py-1.5 text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Link
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ll-deep/70 p-4 backdrop-blur-sm">
          <Card className="relative w-full max-w-md overflow-hidden" elevated>
            <div className="flex items-center justify-between border-b border-ll-border p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ll-accent">
                  Manual node
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ll-text">
                  Add New Link
                </h2>
              </div>
              <IconButton onClick={() => setIsOpen(false)} aria-label="Close">
                <X className="w-5 h-5" />
              </IconButton>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="url"
                  className="block text-sm font-medium text-ll-muted mb-2"
                >
                  URL to Bookmark
                </label>
                <Input
                  id="url"
                  type="url"
                  required
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="px-4 py-2.5"
                />
              </div>

              {error && <Alert tone="danger">{error}</Alert>}

              {success && (
                <Alert tone="success">
                  Link added successfully! Processing...
                </Alert>
              )}

              <div className="flex justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-ll-muted transition-colors hover:text-ll-text"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  disabled={isLoading || !url}
                  className="px-6 py-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Bookmark"
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
