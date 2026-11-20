-- Sectors and the agencies under them
-- (docs/extension/design/b0-vertical-slice.md §12.1).
--
-- A government entity plans on two levels: a sector, and the agencies or
-- departments inside it. Objectives, indicators and initiatives belong to an
-- agency and are summed up for its sector.
--
-- Both are spaces. The shipped `spaces` table is flat and stays as it is:
-- these two tables say which space is a sector and which is an agency of
-- which sector. So everything the product already hangs on a space, its
-- members, its objectives, its indicators, works for an agency unchanged.
--
-- **Two tables, so two levels is the shape of the data.** An agency names a
-- sector row. There is no column in which an agency could name another
-- agency, and a sector names nothing. One table with a parent column would
-- need a rule to say "no deeper", and an import would have to load its rows
-- in parent-first order.
--
-- What two tables cannot say by themselves is that a space is not both. The
-- trigger at the end holds that, for every writer: an import and a data
-- change never pass through the action.

create table org_sectors (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  -- Who answers for the sector. The default owner of an objective drafted
  -- for it (criterion 17). Null until somebody is named.
  lead_member_id uuid references workspace_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table org_sectors enable row level security;
alter table org_sectors force row level security;

create policy tenant_isolation on org_sectors
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index org_sectors_space_idx
  on org_sectors (space_id)
  where deleted_at is null;

create table org_agencies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  sector_id uuid not null references org_sectors (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table org_agencies enable row level security;
alter table org_agencies force row level security;

create policy tenant_isolation on org_agencies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index org_agencies_space_idx
  on org_agencies (space_id)
  where deleted_at is null;

create index org_agencies_sector_idx
  on org_agencies (workspace_id, sector_id)
  where deleted_at is null;

-- A space is a sector or an agency, never both.
create function org_unit_one_kind() returns trigger
  language plpgsql
  as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_table_name = 'org_sectors' then
    if exists (
      select 1 from org_agencies
       where space_id = new.space_id and deleted_at is null
    ) then
      raise exception 'space % is an agency and cannot also be a sector', new.space_id
        using errcode = 'check_violation';
    end if;
  else
    if exists (
      select 1 from org_sectors
       where space_id = new.space_id and deleted_at is null
    ) then
      raise exception 'space % is a sector and cannot also be an agency', new.space_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger org_sectors_one_kind
  before insert or update of space_id, deleted_at on org_sectors
  for each row execute function org_unit_one_kind();

create trigger org_agencies_one_kind
  before insert or update of space_id, deleted_at on org_agencies
  for each row execute function org_unit_one_kind();
