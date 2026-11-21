---
"@openokr/web": minor
---

A workspace can now be arranged on two planning levels: sectors, and the agencies under each. Both are spaces, so objectives, indicators and initiatives are owned by an agency the way they are owned by any space. An Owner or an Admin sets the structure with `strategy.setSector` and `strategy.setAgency`, and every member reads it with `strategy.listOrgUnits`. Being in a sector does not yet grant access to its agencies.
