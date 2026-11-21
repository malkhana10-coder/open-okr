# Extension migrations

The planning extension's own migration stream. It is recorded in its own
ledger, `_migrations_ext`, and runs after the shipped stream in `../migrations`.

Why a second stream: the runner refuses a new file that sorts before the last
applied one. In one shared ledger, an extension migration and the upstream
project's next migration would each be out of order for the other. See
`docs/extension/design/b0-vertical-slice.md` §6 and
`docs/extension/UPSTREAM-DIFF.md`.

The same rules hold here as there: forward-only, never edited once applied,
`workspace_id` and row-level security in the same file, `deleted_at` on every
business table. `pnpm db:lint` checks this directory too once it holds a file.
