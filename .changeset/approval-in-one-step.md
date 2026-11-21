---
"@openokr/web": minor
"@openokr/ui": minor
---

A sector's gaps and drafted objectives can now be sent for approval as one request and decided: approved, or returned with a comment. Approving makes the drafted objectives live and marks the gaps approved. A request is refused while it holds an unverified quotation or a drafted objective whose owner nobody confirmed, and the person who sent a request cannot decide it.

Who may send and who may decide is a new `Approval` column in the role matrix. An Owner sends and decides, an Admin sends and does not decide, and a Member or Viewer does neither. A workspace made before this release has no approval level on its built-in roles until one is set.

An objective an agent drafted can no longer be published by its owner. It goes live when its approval request is approved.
