-- Add FK constraint for content_hash to allow join with shared_links
ALTER TABLE bookmarks 
ADD CONSTRAINT fk_bookmarks_content_hash 
FOREIGN KEY (content_hash) 
REFERENCES shared_links(id);
