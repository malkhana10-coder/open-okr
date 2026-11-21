-- What an agent adds to an objective it drafts, and the gaps it answers
-- (docs/extension/design/b0-vertical-slice.md §4, criteria 8 and 17).
--
-- The profile beside a goal gains what a drafted objective carries: the
-- target in words, why, how sure the agent was, and which run drafted it.
-- All null for an objective a person wrote.
--
-- `owner_confirmed_at` is the review step of criterion 17. A drafted
-- objective is given an owner by rule, the sector's lead or whoever ran the
-- agent, and nobody chose that. It cannot be sent for approval until a
-- person has confirmed the owner or changed it. Null means not yet.

alter table goal_strategy_profiles
  add column proposed_target text,
  add column rationale text,
  add column confidence smallint check (confidence between 0 and 100),
  add column agent_run_id uuid references planning_agent_runs (id) on delete set null,
  add column owner_confirmed_at timestamptz,
  add column owner_confirmed_by uuid references workspace_members (id) on delete set null,
  add check ((owner_confirmed_at is null) = (owner_confirmed_by is null));

-- Which gaps an objective answers. An objective answers at least one; a gap
-- with none is what the alignment screen warns about (criterion 15).
create table gap_goal_links (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  gap_id uuid not null references strategic_gaps (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table gap_goal_links enable row level security;
alter table gap_goal_links force row level security;

create policy tenant_isolation on gap_goal_links
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index gap_goal_links_pair_idx
  on gap_goal_links (gap_id, goal_id)
  where deleted_at is null;

create index gap_goal_links_goal_idx
  on gap_goal_links (workspace_id, goal_id)
  where deleted_at is null;
