---
"@openokr/web": minor
"@openokr/planning-agents": minor
---

`planning.runGapAgent` runs the gap agent on a sector's source documents. What it drafts is stored as drafts for a person to review: each gap as an agent's draft, each quotation checked against the page it names and kept as unverified when it is not there. The agent's output is held to a strict contract, and one that claims a status, an owner or a verified source is refused whole. Every run is recorded, failed ones too, with what the agent read and what was left out, and `planning.listRuns` returns them. The action refuses when no provider is configured and when the sector has no document that has been read. A fixed provider that returns drafts written in advance is included for demonstrations.
