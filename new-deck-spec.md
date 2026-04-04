# Deck Source Format - DSF v1

Status: Draft  
Version: `dsf/v1`

## 1. Purpose

DSF v1 is a small, Git-friendly source format for flashcard decks.

It is intended to:

- make decks editable as plain files
- keep note content in one place
- support a few common flashcard shapes without Anki template parity
- preserve enough imported Anki data for lossless migration
- store media as ordinary files

It is not intended to store:

- spaced repetition scheduling state
- review logs
- user progress
- arbitrary user-authored HTML/CSS/JS templates

User progress MUST live outside the DSF source tree.

## 2. Design Principles

1. Notes are the source of truth.
2. Cards are views over note fields.
3. Common decks should be simple to read and edit by hand.
4. Customized decks should be possible without exposing a template language.
5. Lossless imports should preserve raw source data separately from the clean
   authoring model.

## 3. Package Layout

A DSF deck is a directory tree:

```text
deck/
  deck.yml
  notes/
    *.yml
  media/
    ...
```

Rules:

- `deck.yml` MUST exist.
- `notes/` MUST exist and contain zero or more note files.
- `media/` MAY exist.
- YAML files MUST use UTF-8.
- Filenames are not authoritative. IDs inside files are authoritative.

## 4. Deck File

`deck.yml` defines deck-level metadata.

```yaml
format: dsf/v1
id: kaishi-1_5k
title: Kaishi 1.5k
language: ja
authors:
  - donkuri
license: null
description: Japanese vocabulary deck
source:
  git:
    url: https://github.com/donkuri/Kaishi
    ref: main
    commit: null
  anki:
    packageName: Kaishi-1.5k-v2.4.apkg
    collection: collection.anki21b
    mediaManifest: zstd-protobuf
```

Required fields:

- `format` MUST equal `dsf/v1`.
- `id` MUST be stable across deck updates.
- `title` MUST be present.

Optional fields:

- `language` SHOULD be a BCP 47 tag, such as `en`, `ja`, or `en-US`.
- `authors`, `license`, and `description` MAY be omitted.
- `source` MAY describe where the deck came from.

## 5. Notes

Each file under `notes/*.yml` defines one note.

A note has:

- stable identity
- a note `type`
- reusable `fields`
- one or more `cards`
- optional source metadata

```yaml
id: anki_1708637439854
type: kaishi_vocab
tags: []

fields:
  word: 私
  reading: わたし
  meaning: I (polite, general)
  wordFurigana:
    ruby:
      - base: 私
        ruby: わたし
  wordAudio:
    file: media/私_ワタシ━_0_NHK-2016.mp3
  sentence:
    markdown: "**私**はアンです。"
  sentenceMeaning: I am Ann.
  sentenceFurigana:
    raw: "<b>私[わたし]</b>はアンです。"
  sentenceAudio:
    file: media/JLPT_Tango_N5_0001.mp3
  notes:
    markdown: |
      Can also be read わたくし (formal) and あたし (feminine).

      There are rarer readings too.
  pitchAccent:
    raw: "ワ<span style=\"display:inline-block;position:relative;\">...</span>"
  pitchAccentNotes: null
  frequency: "19"
  picture:
    file: media/jikosyoukai_man-0f017c07b9f1048ff29830827e8503a6984504f6.webp
    alt: 自己紹介のイラスト（男性） | かわいいフリー素材集 いらすとや

cards:
  - id: card_1708637439854
    type: custom
    front:
      - word
      - sentence
    back:
      - wordFurigana
      - meaning
      - sentenceFurigana
      - sentenceMeaning
      - wordAudio
      - sentenceAudio
      - picture
      - notes
```

Rules:

- `id` MUST be unique within the deck.
- `type` MUST be present.
- `tags` MAY be omitted. If present, it MUST be a list of strings.
- `fields` MUST be an object.
- `cards` MUST contain at least one card.
- Cards MUST NOT duplicate note content unless the content is genuinely
  card-specific.

## 6. Fields

Fields are named values owned by the note.

The common field forms are:

```yaml
plainText: simple text

richText:
  markdown: "**bold** and _italic_"

audio:
  file: media/audio.mp3
  mime: audio/mpeg
  sha256: null

image:
  file: media/image.webp
  alt: Example image
  title: null
  mime: image/webp
  sha256: null

video:
  file: media/video.mp4
  poster: media/poster.webp
  mime: video/mp4
  sha256: null

rubyText:
  ruby:
    - base: 私
      ruby: わたし
    - text: はアンです。

rawImportedValue:
  raw: "<span class=\"legacy\">preserved source</span>"
```

Rules:

- A scalar string is plain text.
- `markdown` uses the DSF Markdown profile.
- `file` paths MUST be relative to the deck root.
- `file` paths SHOULD point inside `media/`.
- Consumers MUST reject path traversal such as `../`.
- `raw` is allowed for imported values that cannot be represented cleanly.
- Authors SHOULD prefer strings, `markdown`, `ruby`, and media fields over
  `raw`.

## 7. Cards

Cards are front/back views over note fields.

```yaml
cards:
  - id: card_1
    type: basic
    front: [prompt]
    back: [answer]
```

Built-in card types:

- `basic` - one prompt side, one answer side
- `basic-reversed` - two generated directions from the same fields
- `cloze` - hides cloze spans in a text field
- `listening` - audio or video prompt with text answer
- `custom` - explicit front/back field lists

Rules:

- `cards[*].id` MUST be unique within the note.
- `cards[*].type` MUST be present.
- `front` and `back` MUST be lists.
- A list item MAY be a field name string.
- A list item MAY be an inline view item.
- Field references MUST point to fields on the same note.

Inline view items are available for small card-specific additions:

```yaml
cards:
  - id: card_1
    type: custom
    front:
      - sentence
      - text: What does this mean?
    back:
      - sentenceMeaning
      - field: notes
        label: Notes
```

Supported inline view item forms:

```yaml
- field: fieldName
  label: Optional display label

- text: Plain card-specific text

- markdown: "**Card-specific** text"
```

Inline items SHOULD be used sparingly. Reusable content belongs in `fields`.

## 8. Cloze

Cloze notes use a text or markdown field with cloze markers.

```yaml
fields:
  text:
    markdown: "The capital of France is {{c1::Paris}}."
  extra: Common trivia question.

cards:
  - id: c1
    type: cloze
    front: [text]
    back: [text, extra]
```

Rules:

- Cloze markers use Anki-compatible `{{c1::hidden}}` syntax.
- Optional hints MAY use `{{c1::hidden::hint}}`.
- Importers SHOULD preserve original cloze text in `source.anki.rawFields`.

## 9. Markdown Profile

DSF Markdown is intentionally small.

Allowed:

- paragraphs
- block quotes
- bullet lists
- ordered lists
- fenced code blocks
- emphasis
- strong emphasis
- inline code
- links
- hard line breaks

Disallowed in authored Markdown:

- raw HTML
- headings
- tables
- task lists
- inline images
- footnotes
- iframes
- scripts
- arbitrary attributes or CSS classes

Normalization rules:

- CRLF normalizes to LF.
- trailing whitespace is removed.
- multiple blank lines normalize to one paragraph boundary.
- emphasis and strong emphasis normalize to a canonical Markdown AST.
- links using `javascript:` MUST be rejected.

## 10. Media

Media files are ordinary files in the deck tree.

Rules:

- Media files SHOULD live under `media/`.
- Media references MUST use relative paths.
- Media references MUST NOT escape the deck root.
- Validators MUST report missing referenced media.
- Remote media URLs SHOULD NOT be used in authored DSF.

## 11. Lossless Anki Import

The clean DSF model is for authoring. Lossless import is handled by preserving
raw Anki data under `source.anki`.

Importers MUST preserve enough source data to reconstruct or audit the original
Anki note/card content, even when DSF normalizes common fields.

Per-note Anki source data:

```yaml
source:
  anki:
    noteId: 1708637439854
    guid: "ue*r{>Er!]"
    noteTypeId: 1708628080880
    noteTypeName: Kaishi 1.5k
    mod: 1714298668
    rawFields:
      Word: "私"
      Word Reading: "わたし"
      Word Meaning: "I (polite, general)"
      Word Furigana: "私[わたし]"
      Word Audio: "[sound:私_ワタシ━_0_NHK-2016.mp3]"
      Sentence: "<b>私</b>はアンです。"
      Sentence Meaning: "I am Ann."
      Sentence Furigana: "<b>私[わたし]</b>はアンです。"
      Sentence Audio: "[sound:JLPT_Tango_N5_0001.mp3]"
      Notes: "Can also be read わたくし...<br>There are rarer readings too."
      Pitch Accent: "ワ<span style=\"display:inline-block;position:relative;\">...</span>"
      Pitch Accent Notes: ""
      Frequency: "19"
      Picture: "<img alt=\"...\" src=\"jikosyoukai_man-0f017c07b9f1048ff29830827e8503a6984504f6.webp\">"
    templates:
      - ord: 0
        name: Card 1
        qfmt: |
          <div lang="ja">
          {{Word}}
          <div style='font-size: 20px;'>{{Sentence}}</div>
          </div>
        afmt: |
          <div lang="ja">
          {{furigana:Word Furigana}}
          <div style='font-size: 25px; padding-bottom:20px'>{{Word Meaning}}</div>
          ...
          </div>
    cards:
      - cardId: 1708637439854
        deck: Kaishi 1.5k
        templateOrd: 0
        templateName: Card 1
        renderedFront: null
        renderedBack: null
```

Rules:

- Each Anki note SHOULD map to one DSF note.
- Each Anki card SHOULD map to one DSF card.
- Anki note IDs, GUIDs, note type IDs, field names, raw field values,
  templates, card IDs, deck names, and template ordinals SHOULD be preserved.
- Rendered front/back HTML MAY be preserved when available.
- Importers MAY normalize common values into DSF fields while keeping the raw
  Anki value.

Deck-level Anki source data MAY preserve package metadata:

```yaml
source:
  anki:
    packageName: Kaishi-1.5k-v2.4.apkg
    collection: collection.anki21b
    mediaManifest: zstd-protobuf
    media:
      - index: 0
        filename: 6f0951279a64a81133b2c6acfb3d3020-2eaa51cf10c2cb113f607b8507d951884d35e5f2.mp3
        size: 11498
```

## 12. Import Normalization

Importers SHOULD normalize common Anki values as follows:

- `[sound:file.mp3]` -> media field with `file`
- `<img src="file.webp" alt="...">` -> image field
- `<b>` and `<strong>` -> Markdown strong emphasis
- `<i>` and `<em>` -> Markdown emphasis
- `<br><br>` -> paragraph boundary
- `<br>` -> hard break or paragraph boundary
- `word[reading]` -> `ruby` field when unambiguous
- unsupported HTML -> `raw` field plus original value in `source.anki.rawFields`

Importers SHOULD avoid generating empty fields unless the empty value is useful
for round-tripping. Empty original values are still preserved in
`source.anki.rawFields`.

## 13. Validation

A DSF validator MUST check:

1. `deck.yml` exists and `format` is `dsf/v1`.
2. note IDs are unique.
3. every note has `type`, `fields`, and at least one card.
4. card IDs are unique within a note.
5. every card has `type`, `front`, and `back`.
6. field references point to existing note fields.
7. media paths are relative and safe.
8. referenced local media files exist.
9. authored Markdown follows the DSF Markdown profile.

Validators SHOULD also check:

- duplicate media files
- unused media files
- unknown built-in card type names
- imported raw values that could be normalized safely

## 14. Kaishi 1.5k Fit Check

The current repository contains `Kaishi-1.5k-v2.4.apkg`. Its Anki collection
fits this simplified DSF model:

- 1501 notes
- 1501 cards
- one card per note
- one primary note type: `Kaishi 1.5k`
- 14 note fields
- zstd/protobuf-like media manifest
- 4354 media entries

The Kaishi fields map directly to DSF note fields:

- `Word` -> `word`
- `Word Reading` -> `reading`
- `Word Meaning` -> `meaning`
- `Word Furigana` -> `wordFurigana`
- `Word Audio` -> `wordAudio`
- `Sentence` -> `sentence`
- `Sentence Meaning` -> `sentenceMeaning`
- `Sentence Furigana` -> `sentenceFurigana`
- `Sentence Audio` -> `sentenceAudio`
- `Notes` -> `notes`
- `Pitch Accent` -> `pitchAccent`
- `Pitch Accent Notes` -> `pitchAccentNotes`
- `Frequency` -> `frequency`
- `Picture` -> `picture`

Kaishi also contains imported HTML in fields such as sentence, furigana, pitch
accent, notes, and picture. DSF should normalize the common pieces while
preserving the original Anki field values under `source.anki.rawFields`.

## 15. Summary

DSF v1 has only a few core ideas:

- a deck is a folder
- a note owns reusable fields
- a card is a front/back view over those fields
- media is stored as files
- raw imported Anki data is preserved separately for lossless migration

This keeps common authoring simple without blocking customized imported decks.
