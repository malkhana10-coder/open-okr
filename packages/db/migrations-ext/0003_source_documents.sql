-- Source documents and their pages
-- (docs/extension/design/b0-vertical-slice.md §4).
--
-- A source document is an uploaded file a sector plans from: a strategy, a
-- previous plan, a report. The file itself is a blob like any other upload.
-- This row says what the file is for the planning work, and how far reading
-- it has got.
--
-- A page is kept as a row because a claim an agent drafts names a page, and
-- the page's text is what the claim's quotation is checked against.

create table source_documents (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  blob_id uuid not null references blobs (id) on delete cascade,
  title text not null,
  kind text not null
    check (kind in ('strategy', 'sub_strategy', 'previous_plan', 'report')),
  year integer not null check (year between 1900 and 2200),
  -- pending until the file has been read, then ready or failed. A failed
  -- document says why, in a word a screen can translate.
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'ready', 'failed')),
  failure_reason text
    check (failure_reason in ('no_text', 'unreadable', 'missing')),
  page_count integer check (page_count > 0),
  uploaded_by uuid references workspace_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A reason belongs to a failure, and a page count to a document that was read.
  check ((processing_status = 'failed') = (failure_reason is not null)),
  check ((processing_status = 'ready') = (page_count is not null))
);

alter table source_documents enable row level security;
alter table source_documents force row level security;

create policy tenant_isolation on source_documents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index source_documents_space_idx
  on source_documents (workspace_id, space_id, created_at)
  where deleted_at is null;

create table source_document_pages (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  document_id uuid not null references source_documents (id) on delete cascade,
  -- Counted from 1, as a reader counts and as a PDF viewer's #page= does.
  page integer not null check (page > 0),
  text text not null,
  -- The same text made comparable (packages/knowledge), stored because a
  -- quotation is checked against it and a search will read it.
  text_normalised text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table source_document_pages enable row level security;
alter table source_document_pages force row level security;

create policy tenant_isolation on source_document_pages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index source_document_pages_page_idx
  on source_document_pages (document_id, page);
