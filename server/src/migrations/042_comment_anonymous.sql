alter table comments add column if not exists is_anonymous boolean not null default false;

create table if not exists post_anonymous_identities (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  number integer not null check (number > 0),
  primary key (post_id, user_id),
  unique (post_id, number)
);
