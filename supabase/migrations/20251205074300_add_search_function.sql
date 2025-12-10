-- Create a function for semantic search on bookmarks
-- This function uses pgvector's cosine distance operator for similarity search

CREATE OR REPLACE FUNCTION search_bookmarks(
    query_vector vector(1536),
    user_id uuid,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    url text,
    title text,
    description text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.url,
        b.title,
        s.description,
        1 - (s.vector <=> query_vector) as similarity
    FROM bookmarks b
    JOIN shared_links s ON b.content_hash = s.id
    WHERE b.user_id = search_bookmarks.user_id
    ORDER BY s.vector <=> query_vector
    LIMIT match_count;
END;
$$;
