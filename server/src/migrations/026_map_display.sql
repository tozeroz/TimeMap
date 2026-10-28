-- Display hierarchy is maintained explicitly; existing places remain concrete POIs.
alter table places
  add column display_level text not null default 'place' check (display_level in ('school','area','place')),
  add column min_display_zoom double precision check (min_display_zoom between 4 and 18),
  add column display_priority integer not null default 0 check (display_priority between -1000 and 1000),
  add column parent_place_id uuid references places(id) on delete restrict;
create index places_parent_place_idx on places(parent_place_id);

-- Serialize hierarchy edits and reject cycles, including edits made outside the API.
create function validate_place_hierarchy() returns trigger language plpgsql as $$
declare ancestor_id uuid;
begin
  perform pg_advisory_xact_lock(260028);
  if new.parent_place_id is not null then
    with recursive ancestors as (
      select id, parent_place_id from places where id = new.parent_place_id
      union
      select p.id, p.parent_place_id from places p join ancestors a on p.id = a.parent_place_id
    ) select id into ancestor_id from ancestors where id = new.id limit 1;
    if ancestor_id is not null or new.parent_place_id = new.id then
      raise exception 'place hierarchy cannot contain a cycle' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger places_validate_hierarchy before insert or update of parent_place_id on places
for each row execute function validate_place_hierarchy();
