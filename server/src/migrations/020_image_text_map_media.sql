-- Store a separate image without overlay text for the map, attached to the same post.
ALTER TABLE post_media ADD COLUMN purpose text NOT NULL DEFAULT 'post'
  CHECK (purpose IN ('post', 'map'));
CREATE UNIQUE INDEX post_media_one_map_image ON post_media(post_id) WHERE purpose = 'map';
