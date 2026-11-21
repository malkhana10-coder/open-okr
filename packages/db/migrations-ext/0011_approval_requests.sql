-- Approval in one step
-- (docs/extension/design/b0-vertical-slice.md §4 and §13).
--
-- A request is a batch: a sector's open gaps and drafted objectives, sent by
-- the strategy office and decided by leadership, approved or returned with a
-- comment. Each request has an access context of type `approval`, so who may
-- decide it is the role matrix's answer and not a rule written here.
--
-- `approval_items` is one row per thing in the batch. The slice decides the
-- batch as a whole, and every item of a decided request carries the same
-- decision. The columns for a decision per item are here already, because
-- deciding item by item is the next step and should not need the rows
-- reshaped.

create table approval_requests (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  submitted_by uuid not null references workspace_members (id),
  status text not null default 'open'
    check (status in ('open', 'approved', 'returned')),
  decided_by uuid references workspace_members (id),
  decided_at timestamptz,
  -- Why it was returned. Asked for on a return, optional on an approval.
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'open') = (decided_by is null)),
  check ((status = 'open') = (decided_at is null)),
  check (status <> 'returned' or comment is not null),
  -- Nobody decides what they sent (criterion 11). Held here too, for a
  -- writer that never passes through the action.
  check (decided_by is null or decided_by <> submitted_by)
);

alter table approval_requests enable row level security;
alter table approval_requests force row level security;

create policy tenant_isolation on approval_requests
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One open request per sector.
create unique index approval_requests_open_idx
  on approval_requests (space_id)
  where status = 'open' and deleted_at is null;

create index approval_requests_space_idx
  on approval_requests (workspace_id, space_id, created_at desc)
  where deleted_at is null;

create table approval_items (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  request_id uuid not null references approval_requests (id) on delete cascade,
  subject_type text not null check (subject_type in ('gap', 'goal')),
  subject_id uuid not null,
  decision text check (decision in ('approved', 'returned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table approval_items enable row level security;
alter table approval_items force row level security;

create policy tenant_isolation on approval_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index approval_items_request_idx
  on approval_items (workspace_id, request_id)
  where deleted_at is null;
