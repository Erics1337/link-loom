-- Add unique constraint to bookmarks table to support UPSERT operations
ALTER TABLE bookmarks 
ADD CONSTRAINT bookmarks_user_id_chrome_id_key UNIQUE (user_id, chrome_id);
