---
"@openokr/web": minor
"@openokr/planning-agents": minor
---

`planning.runObjectiveAgent` runs the sector-objectives agent on a sector's gaps. Each objective it drafts is a real objective held back for review: not live, marked as machine-written, tied to the gaps it answers, and with its quotations checked against their pages. Its owner is the sector's lead, or whoever ran the agent when no lead is named, and stays unconfirmed until a person confirms or changes it. An objective the sector already has, or one that answers no gap of the sector, is not drafted, and the run's report says so.
