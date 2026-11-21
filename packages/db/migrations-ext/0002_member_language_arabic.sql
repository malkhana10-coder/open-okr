-- Arabic joins the languages a member may choose
-- (docs/extension/design/b0-vertical-slice.md §9 criterion 1,
-- docs/extension/UPSTREAM-DIFF.md §4).
--
-- The shipped migration 0078 holds `workspace_members.language` to a closed
-- set, checked at the database because an import or a data change never
-- passes through the action. Its own comment gives the order for a new
-- locale: the catalogue first, then a line here. The catalogue carries `ar`
-- since the extension's partial locale, so this is that line.
--
-- This changes a constraint of a shipped table from the extension stream,
-- which is the one thing the stream otherwise never does. It only widens: no
-- row that was valid stops being valid, so an instance running the previous
-- release beside this one during a rolling upgrade is unaffected.
--
-- Dropped and added in one statement, so no moment exists in which the column
-- is unchecked.

alter table workspace_members
  drop constraint workspace_members_language_known,
  add constraint workspace_members_language_known
    check (language is null or language in ('en', 'ms', 'ar'));
