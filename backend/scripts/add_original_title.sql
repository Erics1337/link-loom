-- Migration: Add original_title column to bookmarks table
-- This preserves the browser's original bookmark title before AI renaming

ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS original_title TEXT;

-- For existing bookmarks that don't have original_title set,
-- copy the current title as the original
UPDATE bookmarks 
SET original_title = title 
WHERE original_title IS NULL;
