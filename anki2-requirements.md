# Anki2 Requirements

Status: Draft

## Core Goal

Build an AI-friendly, Anki-compatible system for creating, managing, and
studying flashcard decks across devices.

## 1. AI-Friendly Deck Creation

Users should be able to generate decks from natural language prompts, such as:

- "Create a deck on this book."
- "Create a deck about this topic."
- "Create a deck from these notes."

Deck creation should be accessible through clear automation interfaces, such
as:

- `SKILL.md` workflows
- MCP tools
- scripts

## 2. Anki Deck Compatibility

The system should support at least one reliable compatibility path:

- direct compatibility with existing Anki decks
- migration tools for importing and exporting Anki decks
- documented scripts or workflows for converting between formats

Compatibility work should preserve Anki deck content, media, note structure,
templates, and metadata where possible.

## 3. Scheduler and Optimization

The app should preserve or closely match Anki scheduling behavior, including:

- a compatible spaced repetition scheduler
- similar optimizer algorithms
- support for existing review history where possible

Scheduler behavior should be treated as core product behavior, not as a UI-only
feature.

## 4. Cross-Platform Apps

The system should work across:

- mobile
- desktop
- tablet
- web, if feasible

Mobile support is mandatory.

## 5. User Experience

The interface should be clean, fast, and pleasant to use across all supported
platforms.

The goal is to avoid clunky or frustrating study workflows while keeping the
power and flexibility of Anki.
