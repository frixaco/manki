# manki

Anki `.apkg` parser for Bun.

Purpose:
- parse Anki export packages into JSON
- extract media with original filenames
- support legacy and newer Anki collection formats
- explore a simpler Git-friendly deck source format in `new-deck-spec.md`
- track broader Anki2 product requirements in `anki2-requirements.md`

## Features

- parses:
  - `collection.anki2`
  - `collection.anki21`
  - `collection.anki21b`
- handles media manifests stored as:
  - plain JSON
  - zstd-compressed protobuf-like data
- restores note types + templates
- renders card front/back HTML for common Anki template features
- can be used as:
  - CLI via `index.ts`
  - library via `parse_anki.ts`

## Install

```bash
bun install
```

## CLI usage

```bash
bun ./index.ts <deck.apkg> [output_dir]
```

Examples:

```bash
bun ./index.ts ./Kaishi-1.5k-v2.4.apkg
bun ./index.ts ./Kaishi-1.5k-v2.4.apkg ./out/kaishi
```

Default behavior:
- if `output_dir` omitted, output goes to `./<deck filename without extension>/`
- example:
  - `./Kaishi-1.5k-v2.4.apkg` -> `./Kaishi-1.5k-v2.4/`

CLI writes:
- `meta.json`
- `notes.json`
- `cards.json`
- `notetypes.json`
- `media.json`
- `media/` extracted assets

## Deck Source Format draft

`new-deck-spec.md` describes the draft DSF v1 design.

Current direction:
- notes own reusable fields
- cards are front/back views over those fields
- common card types stay small: `basic`, `basic-reversed`, `cloze`, `listening`, `custom`
- imported Anki data is preserved under `source.anki` for lossless migration
- raw Anki fields/templates/card metadata are kept separate from the clean authoring model

The parser does not emit DSF yet.

## Library usage

```ts
import { parseApkg } from "./parse_anki.ts";

const result = await parseApkg("./Kaishi.1.5k.v2.3.apkg", undefined, {
  extractMedia: false,
});

console.log(result.meta.name);
console.log(result.notes.length);
console.log(result.cards.length);
```

Write parsed output from library call:

```ts
import { parseApkg } from "./parse_anki.ts";

await parseApkg("./deck.apkg", "./deck-output", {
  extractMedia: true,
});
```

## Output shape

### `meta.json`
Contains deck-level summary:
- `name`
- `deckNames`
- `version`
- `notesCount`
- `cardsCount`
- `mediaCount`
- `created`
- `format`

### `notes.json`
Array of parsed notes:
- note id/guid
- note type id/name
- tags
- field map

### `cards.json`
Array of parsed cards:
- card id
- note id
- deck name
- template ordinal
- rendered `front`
- rendered `back`

### `notetypes.json`
Map of note type id -> note type:
- field names
- templates
- `qfmt`
- `afmt`

### `media.json`
Media manifest entries:
- archive index
- original filename
- optional size/hash

## Supported decks verified in repo

- `Kaishi-1.5k-v2.4.apkg`

## Dev

Run tests:

```bash
bun test
```

Typecheck:

```bash
bunx tsc --noEmit
```

## Project structure

- `index.ts` — CLI entry point
- `parse_anki.ts` — parser library
- `parse_anki.test.ts` — regression tests

## Notes

- prefers Bun-native runtime + `bun:sqlite`
- uses external `zstd` binary for zstd decompression
- media extraction preserves original mapped filenames
- parser guards against path traversal when writing media files
