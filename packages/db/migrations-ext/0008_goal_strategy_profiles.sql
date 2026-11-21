-- What an objective is in the plan
-- (docs/extension/design/b0-vertical-slice.md §12.2).
--
-- A government plan holds sector objectives and operational objectives, each
-- marked a priority or not, new this year or carried from the last, and with
-- a source: a sub-strategy, a proposal, or a directive from leadership. None
-- of that is in the shipped `goals` table, and it does not go there. One row
-- here sits beside a goal and says it.
--
-- A third kind of item, the operational indicator that is followed without
-- being an objective, needs no row here: it is the product's own `kpis`.
--
-- `baseline_undetermined` is for a baseline that is not known when the plan
-- is written, which plans call "TBD". The numbers themselves stay on the
-- goal's key results, where the product already keeps them.

create table goal_strategy_profiles (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  objective_type text not null
    check (objective_type in ('sectoral', 'operational')),
  priority text not null check (priority in ('priority', 'not_priority')),
  plan_status text not null check (plan_status in ('new', 'carried')),
  source_kind text not null
    check (source_kind in ('sub_strategy', 'proposed', 'leadership_directive')),
  -- The sub-strategy it comes from, when it comes from one.
  source_document_id uuid references source_documents (id) on delete set null,
  baseline_undetermined boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (source_document_id is null or source_kind = 'sub_strategy')
);

alter table goal_strategy_profiles enable row level security;
alter table goal_strategy_profiles force row level security;

create policy tenant_isolation on goal_strategy_profiles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index goal_strategy_profiles_goal_idx
  on goal_strategy_profiles (goal_id)
  where deleted_at is null;
