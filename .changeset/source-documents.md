---
"@openokr/core": minor
"@openokr/db": minor
---

A sector can keep source documents: an uploaded PDF filed under it with its kind and year. The file is read page by page in the background, and each page's text is stored. Reading asks for edit access to the sector, so a member who is not in it does not see its documents. No screen uses this yet, and an instance needs a document reader configured before a filed document leaves `pending`; that arrives with the next change.
