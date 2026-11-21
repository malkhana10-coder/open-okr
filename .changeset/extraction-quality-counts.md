---
"@openokr/web": minor
"@openokr/knowledge": minor
---

When a source document is read, each page and the document as a whole are now measured for how well their text came out of the file: how many Arabic words carry a fault such as a letter without its dots. `knowledge.listDocuments` says whether a document is over the threshold and which of its pages are, and `knowledge.readPage` says it for the page. A weak document stays readable. The threshold is three in a hundred and can be changed in one place.
