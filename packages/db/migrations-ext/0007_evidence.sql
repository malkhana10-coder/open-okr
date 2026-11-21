-- Evidence: a quotation, the document it is from and the page it is on
-- (docs/extension/design/b0-vertical-slice.md §4, criteria 5 and 6).
--
-- Every gap and every drafted objective rests on what a source document
-- says. A row here is one such claim, and `verification` is whether the
-- quotation was found on the page it names when the row was written. The
-- check is a pure function over the stored text of the page
-- (packages/knowledge). The verdict is stored and never taken from a caller,
-- so nothing can hold a `verified` the check did not give.
--
-- `subject_type` and `subject_id` name what the evidence supports. No foreign
-- key, because the subject is a gap or a goal and one column cannot point at
-- two tables. The action resolves the subject and its sector before writing.

create table evidence (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  subject_type text not null check (subject_type in ('gap', 'goal')),
  subject_id uuid not null,
  document_id uuid not null references source_documents (id) on delete cascade,
  page integer not null check (page > 0),
  quote text not null,
  verification text not null check (verification in ('verified', 'unverified')),
  -- Why not, in a word a screen can translate.
  unverified_reason text check (unverified_reason in ('too_short', 'not_on_page')),
  created_by uuid references workspace_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((verification = 'unverified') = (unverified_reason is not null))
);

alter table evidence enable row level security;
alter table evidence force row level security;

create policy tenant_isolation on evidence
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index evidence_subject_idx
  on evidence (workspace_id, subject_type, subject_id, created_at)
  where deleted_at is null;
