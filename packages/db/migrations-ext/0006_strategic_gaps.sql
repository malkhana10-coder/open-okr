-- Strategic gaps (docs/extension/design/b0-vertical-slice.md §4).
--
-- A gap is where the strategy asks for something a sector is not yet doing.
-- A person writes one, or an agent drafts one from the sector's source
-- documents. Either way it is a draft until somebody with the authority
-- approves it, and the status says where it stands:
--
--   draft      written by a person, not yet sent for approval
--   ai_draft   drafted by an agent, not yet sent for approval
--   in_review  sent, waiting for a decision
--   approved   accepted
--   returned   sent back with a comment, to be changed and sent again
--   dismissed  set aside. Kept, so the same gap is not drafted again
--
-- `draft` is not in the design's first list of statuses. The design asks for
-- a gap written by hand to work with no AI provider (criterion 13), and a
-- gap a person wrote must never carry the status that marks machine output.
--
-- Filed under the sector, not under one of its agencies: a gap is found by
-- reading the sector's strategy, before anybody knows which agency closes it.

create table strategic_gaps (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  domain_id uuid references strategy_domains (id) on delete set null,
  title text not null,
  description text,
  -- Why this is a gap: what the strategy asks for that is not there.
  rationale text,
  -- How sure the agent that drafted it was, 0 to 100. Null for a person's.
  confidence smallint check (confidence between 0 and 100),
  status text not null default 'draft'
    check (status in
      ('draft', 'ai_draft', 'in_review', 'approved', 'returned', 'dismissed')),
  created_by uuid references workspace_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table strategic_gaps enable row level security;
alter table strategic_gaps force row level security;

create policy tenant_isolation on strategic_gaps
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index strategic_gaps_space_idx
  on strategic_gaps (workspace_id, space_id, created_at)
  where deleted_at is null;
