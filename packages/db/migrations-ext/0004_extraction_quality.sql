-- How well each page, and each document, came out of its file
-- (docs/extension/design/b0-vertical-slice.md §9 criterion 19).
--
-- Some PDF files carry a broken table from glyphs to characters, and the text
-- read from them has letters without their dots. A quotation drawn from such
-- a page will not verify. These columns hold what was counted when the file
-- was read, so a screen can warn about the document, mark its weak pages and
-- put a warning on a source that comes from one.
--
-- Counts, not a verdict. Whether a page is weak is the counts against a
-- threshold in packages/knowledge, decided when it is read. The threshold was
-- set from three documents and will be set again from more, and moving it
-- then needs no change to stored rows.
--
-- Null on a row written before this migration, and on a document that is
-- still waiting or that failed. Nothing reads a null as "sound".

alter table source_documents
  add column arabic_words integer check (arabic_words >= 0),
  add column suspect_words integer check (suspect_words >= 0),
  add check ((arabic_words is null) = (suspect_words is null)),
  add check (suspect_words <= arabic_words);

alter table source_document_pages
  add column arabic_words integer check (arabic_words >= 0),
  add column suspect_words integer check (suspect_words >= 0),
  add check ((arabic_words is null) = (suspect_words is null)),
  add check (suspect_words <= arabic_words);
