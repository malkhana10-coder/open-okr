-- Strategic domains (docs/extension/design/b0-vertical-slice.md §4).
--
-- A domain is a named area of the organisation's strategy, such as "Licensing
-- and compliance". Strategic gaps and sector objectives are filed under one,
-- which is what lets the alignment screen group them.
--
-- The first table of the extension stream. It follows the shipped schema's
-- rules: the tenant floor in the same file, and soft delete.

create table strategy_domains (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table strategy_domains enable row level security;
alter table strategy_domains force row level security;

create policy tenant_isolation on strategy_domains
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One live domain per name in a workspace, whatever the case or the spaces
-- around it. A deleted domain frees its name.
create unique index strategy_domains_name_idx
  on strategy_domains (workspace_id, lower(btrim(name)))
  where deleted_at is null;
