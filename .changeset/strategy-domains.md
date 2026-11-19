---
"@openokr/core": minor
---

A workspace can now keep a list of strategic domains, the areas of its strategy that gaps and sector objectives will be filed under. An Owner or an Admin adds one with `strategy.createDomain`, and every member reads the list with `strategy.listDomains`. Both are on the REST surface, the command line and the agent tool catalogue. No screen uses them yet.
