# Deck Source Format - DSF v1

Status: Draft  
Version: `dsf/v1`

## 1. Scope

DSF v1 defines a Git-friendly, human-editable, LLM-friendly source format for
front/back flashcard decks.

DSF v1 is intended to:

- replace opaque package formats such as `.apkg` for source authoring
- preserve enough structure to import from Anki note and card data
- avoid arbitrary HTML, CSS, and JS templating
- represent cards as ordered visual/content blocks
- support plain files, media folders, Git, and GitHub distribution

DSF v1 does not define:

- spaced repetition scheduling state
- review logs
- user progress sync
- arbitrary embedded HTML/CSS/JS
- arbitrary user-authored template languages

User progress MUST be stored outside the DSF source tree.

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and
"MAY" in this document are to be interpreted as described in RFC 2119.

## 3. Design principles

1. Source files MUST be plain text.
2. The top-level data model MUST be strict and typed.
3. Cards SHOULD be modeled as front/back sides made of ordered blocks.
4. Rich text MAY use a restricted Markdown profile.
5. Raw HTML MUST NOT be part of authored rich text.
6. Applications SHOULD render DSF from built-in block components, not user
   templates.
7. Decks SHOULD be valid Git repositories without extra packaging.
8. Media MUST be stored as ordinary files in the deck tree.
9. Import from Anki SHOULD preserve source metadata.

## 4. Package layout

A DSF deck is a directory tree.

```text
deck/
  deck.yml
  note-types/
    *.yml
  notes/
    *.yml
  media/
    ...
```

### 4.1 Required files

- `deck.yml` MUST exist.
- `note-types/` MUST exist and contain at least one note type definition.
- `notes/` MUST exist and contain zero or more note files.
- `media/` MAY exist. If absent, no local media files are available.

### 4.2 File format

- YAML files MUST use UTF-8.
- YAML syntax SHOULD be YAML 1.2 compatible.
- File extensions SHOULD be `.yml`.
- Filenames are not authoritative. The `id` inside each file is authoritative.

## 5. `deck.yml`

`deck.yml` defines deck-level metadata.

### 5.1 Schema

```yaml
format: dsf/v1
id: string
title: string
language: string
authors:
  - string
license: string | null
description: string | null
defaultNoteType: string | null
source:
  git:
    url: string
    ref: string | null
    commit: string | null
```

### 5.2 Field requirements

- `format` MUST equal `dsf/v1`.
- `id` MUST be unique within the deck and SHOULD be stable across updates.
- `title` MUST be present.
- `language` SHOULD be a BCP 47 tag, such as `en`, `ja`, or `en-US`.
- `authors` MAY be omitted.
- `license` MAY be omitted or `null`.
- `description` MAY be omitted or `null`.
- `defaultNoteType` MAY be omitted or `null`.
- `source.git` MAY be included for GitHub or Git-based distribution metadata.

### 5.3 Example

```yaml
format: dsf/v1
id: kaishi-1_5k
title: Kaishi 1.5k
language: ja
authors:
  - donkuri
license: null
description: Japanese vocabulary deck
defaultNoteType: front-back-rich
source:
  git:
    url: https://github.com/donkuri/Kaishi
    ref: main
    commit: null
```

## 6. Note type definitions

Each file under `note-types/*.yml` defines one note type.

A note type defines:

- a reusable structural category for notes
- optional allowed block kinds
- optional suggested block roles
- optional application hints

A DSF note type does **not** define arbitrary templates.

### 6.1 Schema

```yaml
id: string
name: string
description: string | null
allowedBlockKinds:
  - text | ruby_text | audio | image | video | group
suggestedRoles:
  - string
hints:
  preferredFrontLayout: stack | row | column | grid | null
  preferredBackLayout: stack | row | column | grid | null
  collapsibleRoles:
    - string
```

### 6.2 Rules

- `id` MUST be unique within the deck.
- `name` SHOULD be human-readable.
- `description` MAY be omitted or `null`.
- `allowedBlockKinds` MAY be omitted. If present, every value MUST be a valid
  DSF block kind.
- `suggestedRoles` MAY be omitted.
- Roles are soft semantics, not strict field names.
- `hints` MAY be omitted.
- Consumers MAY ignore any hint they do not understand.

### 6.3 Role model

DSF v1 intentionally avoids domain-specific required fields such as `word`,
`wordMeaning`, `sentence`, or `picture`.

Instead, applications SHOULD use:

1. ordered blocks,
2. strict block kinds,
3. optional `role` labels, and
4. note-type-level hints.

This allows multiple imported Anki note types to map into the same DSF note
type when they share a similar visual structure.

Typical role names are application-defined. Common examples include:

- `title`
- `description`
- `answer`
- `meaning`
- `example`
- `notes`
- `media`
- `hint`
- `source`

### 6.4 Example: generic front/back rich note type

```yaml
id: front-back-rich
name: Front/back rich
description: Generic front/back card built from ordered typed blocks
allowedBlockKinds:
  - text
  - ruby_text
  - audio
  - image
  - video
  - group
suggestedRoles:
  - title
  - description
  - answer
  - meaning
  - example
  - notes
  - media
  - source
hints:
  preferredFrontLayout: stack
  preferredBackLayout: stack
  collapsibleRoles:
    - notes
    - source
```

## 7. Note files

Each file under `notes/*.yml` defines one note.

A note contains one or more cards.

Each card contains:

- `front`
- `back`
- ordered blocks on each side

### 7.1 Schema

```yaml
id: string
noteType: string
tags:
  - string
cards:
  - id: string
    front:
      layout: stack | row | column | grid | null
      blocks:
        - block
    back:
      layout: stack | row | column | grid | null
      blocks:
        - block
source:
  anki:
    noteId: integer | null
    guid: string | null
    noteTypeId: integer | null
    noteTypeName: string | null
    mod: integer | null
    rawFields:
      fieldName: string
    cards:
      - cardId: integer | null
        deck: string | null
        templateOrd: integer | null
        templateName: string | null
```

### 7.2 Rules

- `id` MUST be unique within the deck.
- `noteType` MUST reference an existing note type `id`.
- `tags` MAY be omitted. If present, it MUST be a list of strings.
- `cards` MUST contain at least one card.
- Each note-local `cards[*].id` MUST be unique.
- Every card MUST contain both `front` and `back`.
- Every side MUST contain `blocks`, even if empty.
- `layout` MAY be omitted or `null`.
- `source.anki` MAY be present for imported notes.

### 7.3 Null and empty values

- `null` means absent or unknown.
- Producers SHOULD omit empty optional objects rather than emit structurally empty
  placeholder blocks.
- Importers from Anki SHOULD preserve lossless source data in `source.anki` when
  normalization is incomplete.

## 8. Block model

A block is the atomic visual/content unit in DSF.

Every block MUST have a `kind`.

Blocks MAY also carry:

- `id` for stable references
- `role` for soft semantic labeling
- `label` for human-readable debugging/UI labels
- `tooltip` for optional UI hints
- `searchText` for explicit search indexing override

### 8.1 Common block schema

```yaml
id: string | null
kind: text | ruby_text | audio | image | video | group
role: string | null
label: string | null
tooltip: string | null
searchText: string | null
data: object | null
blocks:
  - block
```

Rules:

- `blocks` MUST only be present for `group` blocks.
- `data` MUST conform to the block `kind`.
- `searchText`, if present, SHOULD supplement or override consumer-derived text
  indexing.

## 9. Block kinds

## 9.1 `text`

YAML shape:

```yaml
kind: text
data:
  markdown: string
```

Rules:

- `markdown` MUST conform to `dmp-1`.
- raw HTML MUST NOT appear in authored `markdown`.

Example:

```yaml
- kind: text
  role: title
  data:
    markdown: |
      **私**はアンです。
```

## 9.2 `ruby_text`

YAML shape:

```yaml
kind: ruby_text
data:
  segments:
    - text: string
    - base: string
      ruby: string
```

Rules:

- each segment MUST be either `{ text: string }` or `{ base: string, ruby: string }`
- empty segment strings SHOULD NOT be used

Example:

```yaml
- kind: ruby_text
  role: answer
  data:
    segments:
      - base: 私
        ruby: わたし
      - text: はアンです。
```

## 9.3 `audio`

YAML shape:

```yaml
kind: audio
data:
  path: string
  sha256: string | null
  mime: string | null
  durationMs: integer | null
```

Rules:

- `path` MUST be relative to the deck root.
- `path` SHOULD point inside `media/`.
- consumers MUST reject path traversal such as `../`.

Example:

```yaml
- kind: audio
  role: media
  data:
    path: media/audio/word.mp3
    mime: audio/mpeg
    sha256: null
    durationMs: null
```

## 9.4 `image`

YAML shape:

```yaml
kind: image
data:
  path: string
  alt: string | null
  title: string | null
  sha256: string | null
  mime: string | null
```

Example:

```yaml
- kind: image
  role: media
  data:
    path: media/images/example.webp
    alt: Example illustration
    title: null
    sha256: null
    mime: image/webp
```

## 9.5 `video`

YAML shape:

```yaml
kind: video
data:
  path: string
  poster: string | null
  sha256: string | null
  mime: string | null
  durationMs: integer | null
```

## 9.6 `group`

A `group` block allows composition of multiple blocks inside one logical box.

YAML shape:

```yaml
kind: group
data:
  layout: stack | row | column | grid | null
blocks:
  - block
```

Rules:

- `group.blocks` MUST be present.
- `group.blocks` MAY be empty.
- nested groups are allowed.

Example:

```yaml
- kind: group
  role: answer
  data:
    layout: stack
  blocks:
    - kind: ruby_text
      role: title
      data:
        segments:
          - base: 私
            ruby: わたし
    - kind: text
      role: meaning
      data:
        markdown: |
          I (polite, general)
```

## 10. Markdown profile `dmp-1`

`dmp-1` is the standardized rich text authoring profile for DSF v1.

### 10.1 Allowed block constructs

- paragraphs
- block quotes
- bullet lists
- ordered lists
- fenced code blocks

### 10.2 Allowed inline constructs

- text
- emphasis
- strong emphasis
- inline code
- links
- hard line breaks

### 10.3 Disallowed constructs

The following MUST be rejected by validators:

- raw HTML
- headings
- tables
- task lists
- inline images
- reference-style link definitions
- footnotes
- embedded iframes or scripts
- arbitrary attributes or CSS classes

### 10.4 Link rules

- links MUST use explicit inline syntax such as `[text](url)`
- `javascript:` URLs MUST be rejected
- consumers SHOULD allow `https:`, `http:`, `mailto:`, and relative media URLs
- importers MAY preserve unsupported links as plain text

### 10.5 Hard breaks and paragraphs

- a single hard break remains a hard break
- blank lines create paragraph boundaries
- multiple consecutive blank lines MUST normalize to one paragraph boundary

### 10.6 Normalization

Validators SHOULD normalize:

- CRLF to LF
- trailing whitespace removal
- repeated blank lines to a single blank line
- equivalent emphasis forms to canonical AST

## 11. Canonical normalized representation

Applications MUST validate source YAML into a canonical normalized
representation before rendering or scheduling.

The canonical representation MAY be stored internally as JSON.

### 11.1 Rich text AST

The canonical AST for `text.data.markdown` MUST use the following node types.

#### Document

```json
{
  "type": "doc",
  "content": []
}
```

#### Block nodes

- `paragraph`
- `blockquote`
- `bullet_list`
- `ordered_list`
- `list_item`
- `code_block`

#### Inline nodes

- `text`
- `link`
- `hard_break`
- `inline_code`

### 11.2 Canonical note object

A normalized note object MUST contain:

```json
{
  "id": "anki_1708637439854",
  "noteType": "front-back-rich",
  "tags": [],
  "cards": [],
  "source": {}
}
```

Consumers SHOULD derive search indexes from block content, roles, and sides.

## 12. Search and view derivation

DSF v1 is block-first, not field-first.

Consumers SHOULD derive search and alternate views from:

- block order
- block `kind`
- block `role`
- block text extracted from `text`, `ruby_text`, and optional `searchText`
- card side (`front` / `back`)

Examples:

- compact list view MAY use the first `front` block with role `title`
- answer preview MAY use the first `back` text-like block
- media gallery MAY collect all `image`, `audio`, and `video` blocks
- ruby-aware search MAY index both `base` and `ruby` strings

## 13. Media handling

### 13.1 Media storage

- media files SHOULD be stored under `media/`
- media references MUST be relative paths
- media references MUST NOT escape the deck root
- consumers MAY compute and cache checksums

### 13.2 Missing media

If a referenced media file does not exist:

- validators MUST report an error
- importers MAY still preserve the reference in a degraded state

### 13.3 Remote media

Remote media URLs SHOULD NOT be used in authored DSF source.

If supported by an application, they MUST be explicitly enabled and MUST NOT be
treated as local `path` values.

## 14. Import from Anki

This section defines recommended import behavior.

### 14.1 Note mapping

Each Anki note SHOULD map to one DSF note.

Each produced Anki card SHOULD map to one DSF `cards[]` entry on that note.

- Anki `noteTypeName` SHOULD map to a DSF note type `name` when useful
- different Anki templates do NOT require different DSF note types
- multiple Anki note types MAY map to the same DSF note type if their visual
  structure is compatible
- Anki `noteTypeId` SHOULD be preserved in `source.anki.noteTypeId`
- Anki `id` SHOULD be preserved in `source.anki.noteId`
- Anki `guid` SHOULD be preserved in `source.anki.guid`
- Anki `mod` SHOULD be preserved in `source.anki.mod`

### 14.2 Card mapping

Importers SHOULD preserve card-level source metadata where available:

- Anki `card.id`
- deck name
- template ordinal
- template name

When importing front/back cards from Anki, importers SHOULD produce DSF cards by:

1. extracting or rendering front/back content,
2. converting recognizable content into typed blocks,
3. preserving ambiguous raw source in `source.anki`.

### 14.3 HTML to blocks conversion

Anki field and template HTML SHOULD be converted as follows:

- `<br>` -> hard break or paragraph boundary inside `text` blocks
- consecutive `<br><br>` -> paragraph boundary
- `<p>` and `<div>` -> paragraph boundary or `group` boundary
- `<strong>` and `<b>` -> strong emphasis in `text`
- `<em>` and `<i>` -> emphasis in `text`
- `<code>` -> inline code
- `<pre>` -> code block
- `<a href="...">` -> Markdown link in `text`
- `target`, `class`, `style`, and other attributes MUST be discarded
- unsupported tags SHOULD be dropped while preserving text content

If conversion cannot be represented cleanly, importers SHOULD:

1. preserve best-effort normalized block content, and
2. keep original raw field HTML in `source.anki.rawFields`.

### 14.4 Media extraction

Importers SHOULD extract common Anki media forms such as:

- `[sound:file.mp3]`
- `<img src="file.png">`

and convert them into `audio` or `image` blocks.

### 14.5 Ruby text extraction

If imported source contains patterns such as:

- `海[うみ]`

importers SHOULD convert them into `ruby_text` blocks or ruby-text segments.

### 14.6 Empty values

Importers SHOULD avoid generating meaningless empty blocks.

If imported content is empty, producers SHOULD either:

- omit the block entirely, or
- preserve only the source metadata if lossless import is required.

## 15. Validation rules

A DSF v1 validator MUST check at least the following:

1. `deck.yml` exists and `format` is `dsf/v1`
2. all note type IDs are unique
3. all note IDs are unique
4. every note references an existing note type
5. every note has at least one card
6. every card has `front.blocks` and `back.blocks`
7. every block `kind` is valid
8. every block payload matches its block kind schema
9. all `text` blocks parse as `dmp-1`
10. raw HTML is rejected in authored Markdown blocks
11. all media paths are relative and safe
12. all referenced media files exist, unless running in permissive import mode

Validators SHOULD also check:

- unused media files
- duplicate note-local card IDs
- duplicate block IDs within the same card side
- note-type `allowedBlockKinds` violations
- deck ID and file naming consistency

## 16. Example package

```text
kaishi-1_5k/
  deck.yml
  note-types/
    front-back-rich.yml
  notes/
    anki_1708637439854.yml
  media/
```

### 16.1 `deck.yml`

```yaml
format: dsf/v1
id: kaishi-1_5k
title: Kaishi 1.5k
language: ja
authors:
  - donkuri
license: null
description: Japanese vocabulary deck
defaultNoteType: front-back-rich
source:
  git:
    url: https://github.com/donkuri/Kaishi
    ref: main
    commit: null
```

### 16.2 `note-types/front-back-rich.yml`

```yaml
id: front-back-rich
name: Front/back rich
description: Generic front/back card built from ordered typed blocks
allowedBlockKinds:
  - text
  - ruby_text
  - audio
  - image
  - video
  - group
suggestedRoles:
  - title
  - description
  - answer
  - meaning
  - example
  - notes
  - media
  - source
hints:
  preferredFrontLayout: stack
  preferredBackLayout: stack
  collapsibleRoles:
    - notes
    - source
```

### 16.3 `notes/anki_1708637439854.yml`

```yaml
id: anki_1708637439854
noteType: front-back-rich
tags: []
cards:
  - id: card-1
    front:
      layout: stack
      blocks:
        - kind: text
          role: title
          data:
            markdown: |
              私

        - kind: text
          role: description
          data:
            markdown: |
              **私**はアンです。

    back:
      layout: stack
      blocks:
        - kind: ruby_text
          role: title
          data:
            segments:
              - base: 私
                ruby: わたし

        - kind: text
          role: meaning
          data:
            markdown: |
              I (polite, general)

        - kind: ruby_text
          role: example
          data:
            segments:
              - base: 私
                ruby: わたし
              - text: はアンです。

        - kind: text
          role: description
          data:
            markdown: |
              I am Ann.

        - kind: audio
          role: media
          label: Word audio
          data:
            path: media/私_ワタシ━_0_NHK-2016.mp3
            sha256: null
            mime: audio/mpeg
            durationMs: null

        - kind: audio
          role: media
          label: Sentence audio
          data:
            path: media/JLPT_Tango_N5_0001.mp3
            sha256: null
            mime: audio/mpeg
            durationMs: null

        - kind: image
          role: media
          data:
            path: media/jikosyoukai_man-0f017c07b9f1048ff29830827e8503a6984504f6.webp
            alt: 自己紹介のイラスト（男性） | かわいいフリー素材集 いらすとや
            title: null
            sha256: null
            mime: image/webp

        - kind: group
          role: notes
          data:
            layout: stack
          blocks:
            - kind: text
              role: notes
              data:
                markdown: |
                  Can also be read わたくし (formal) and あたし (feminine).

                  There are rarer readings too.

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
      Notes: "Can also be read わたくし (formal) and あたし (feminine).<br>There are rarer readings too."
      Pitch Accent: "ワ<span style=\"display:inline-block;position:relative;\"><span style=\"display:inline;\">タシ</span><span style=\"border-color:currentColor;display:block;user-select:none;pointer-events:none;position:absolute;top:0.1em;left:0;right:0;height:0;border-top-width:0.1em;border-top-style:solid;\"></span></span>"
      Pitch Accent Notes: ""
      Frequency: "19"
      Picture: "<img alt=\"自己紹介のイラスト（男性） | かわいいフリー素材集 いらすとや\" src=\"jikosyoukai_man-0f017c07b9f1048ff29830827e8503a6984504f6.webp\">"
    cards:
      - cardId: 1708637439854
        deck: Kaishi 1.5k
        templateOrd: 0
        templateName: Card 1
```

## 17. Summary of the format

DSF v1 uses:

- YAML for strict top-level structure
- notes composed of front/back cards
- ordered typed blocks instead of arbitrary templates
- restricted Markdown for authored text blocks
- plain folders for Git/GitHub friendliness
- preserved source metadata for import fidelity
- optional roles and note-type hints for search and alternate views
