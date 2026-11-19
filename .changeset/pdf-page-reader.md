---
"@openokr/web": minor
---

An uploaded strategy document in PDF is now read page by page in the
background. The reader rebuilds each page from the glyphs it draws, so Arabic
text keeps its letter order, columns are read one after the other, and vowel
marks stay on their words. A file that is damaged, locked or not a PDF is
recorded as unreadable instead of being retried.
