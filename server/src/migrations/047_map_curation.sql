create table post_story_labels (
  post_id uuid primary key references posts(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default now()
);
create table place_checkins (
  place_id uuid primary key references places(id) on delete cascade,
  active boolean not null default false,
  description text not null default '' check(length(description)<=300),
  version integer not null default 1,
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default now()
);
create table place_checkin_photos (
  place_id uuid not null references place_checkins(place_id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  position integer not null check(position between 0 and 8),
  primary key(place_id,post_id), unique(place_id,position)
);
create index post_story_enabled on post_story_labels(post_id) where enabled;
