---
"@openokr/db": minor
---

The migrator now runs a second migration stream, `packages/db/migrations-ext`, after the shipped one and records it in its own ledger, `_migrations_ext`. The stream is empty in this release, so an upgrade creates the empty ledger table and changes nothing else.
