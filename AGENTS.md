# AGENTS.md

## Scope

Applies to this repository.

## Purpose

Repo contains an Anki `.apkg` parser.

Current split:
- `index.ts` = CLI entry point
- `parse_anki.ts` = library code

Keep that boundary intact.

## Working rules

- Be concise; telegraph style okay.
- State assumptions before edits.
- One logical change per task.
- Fix root cause, not surface symptoms.
- Match existing style and Bun-first patterns.
- Prefer small helpers over large rewrites unless rewrite is clearly simpler.

## Code rules

- Use Bun, not Node-first tooling.
- Prefer `bun test`, `bunx tsc --noEmit`, `bun ./index.ts ...`.
- No new dependencies unless clearly necessary.
- Keep `parse_anki.ts` import-safe: no CLI side effects.
- CLI behavior belongs in `index.ts`.
- Preserve support for:
  - `collection.anki2`
  - `collection.anki21`
  - `collection.anki21b`
- Preserve media manifest support for:
  - JSON
  - zstd + protobuf-like format
- Preserve filename-safe media extraction.

## Before editing parser logic

Identify:
- input format being changed
- legacy vs modern schema impact
- media manifest impact
- template rendering impact
- output JSON compatibility impact

## Verification

Default checks after meaningful changes:

```bash
bun test
bunx tsc --noEmit
```

For CLI-affecting changes, also smoke test:

```bash
bun ./index.ts ./Kaishi.1.5k.v2.3.apkg ./tmp_out
```

## Do not

- Reintroduce CLI execution into `parse_anki.ts`
- Add shell-heavy hot loops for per-file processing
- Write media files without path normalization/safety checks
- Guess Anki schema details without verifying against real decks/tests

## Useful outputs

Parser writes:
- `meta.json`
- `notes.json`
- `cards.json`
- `notetypes.json`
- `media.json`
- `media/`

Keep docs in `README.md` in sync with actual behavior.
