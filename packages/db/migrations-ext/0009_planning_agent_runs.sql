-- One run of a planning agent
-- (docs/extension/design/b0-vertical-slice.md §4 and §5).
--
-- A row per run, whether it drafted anything or failed, so a reviewer can see
-- what an agent was shown, what it said it read and left out, and which
-- drafts came from it. Separate from the shipped `agent_runs`, which records
-- a list of actions an agent member took. A planning run is one call to a
-- provider and what was stored from it.
--
-- `input` holds what the agent was shown in summary: titles and page counts,
-- never the pages' text, which is already in `source_document_pages`.
-- `output` is what came back once it passed the contract, or null.

create table planning_agent_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  agent text not null check (agent in ('gaps', 'objectives')),
  -- 'fixed' for drafts written in advance, otherwise the provider's name.
  provider text not null,
  model text not null,
  prompt_version text,
  status text not null check (status in ('succeeded', 'failed')),
  -- Why it failed, for the record. Not shown as it is.
  failure text,
  input jsonb not null,
  output jsonb,
  -- What the agent read and what was left out, the agent's and the system's.
  report jsonb not null,
  documents_used jsonb not null default '[]'::jsonb,
  duration_ms integer not null check (duration_ms >= 0),
  cost_usd numeric,
  started_by uuid references workspace_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'failed') = (failure is not null))
);

alter table planning_agent_runs enable row level security;
alter table planning_agent_runs force row level security;

create policy tenant_isolation on planning_agent_runs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index planning_agent_runs_space_idx
  on planning_agent_runs (workspace_id, space_id, created_at desc)
  where deleted_at is null;

-- Which run drafted a gap. Null for one a person wrote.
alter table strategic_gaps
  add column agent_run_id uuid references planning_agent_runs (id) on delete set null;
