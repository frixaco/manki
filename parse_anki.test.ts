import { expect, test } from "bun:test";
import { deriveDefaultOutputDir, parseApkg } from "./parse_anki.ts";

const modernDeck = parseApkg("./Kaishi.1.5k.v2.3.apkg", undefined, { extractMedia: false });
const legacyDeck = parseApkg("./Japanese_course_based_on_Tae_Kims_grammar_guide__anime.apkg", undefined, {
  extractMedia: false,
});

test("derives default output dir from deck filename", () => {
  expect(deriveDefaultOutputDir("./Kaishi.1.5k.v2.3.apkg")).toBe("./Kaishi.1.5k.v2.3");
  expect(deriveDefaultOutputDir("./decks/foo/bar/custom-deck.colpkg")).toBe("./custom-deck");
  expect(deriveDefaultOutputDir("plain-deck")).toBe("./plain-deck");
});

test("parses modern anki21b decks with decoded templates + media manifest", async () => {
  const result = await modernDeck;
  const card = result.cards.find((entry) => entry.front.includes("私"));
  const noteType = result.noteTypes["1708628080880"];

  expect(result.meta.format).toBe("anki21+");
  expect(result.meta.name).toBe("Kaishi 1.5k");
  expect(result.meta.deckNames).toEqual(["Kaishi 1.5k"]);
  expect(result.meta.mediaCount).toBeGreaterThan(4000);

  expect(noteType).toBeDefined();
  expect(noteType?.templates[0]?.qfmt).toContain("{{Word}}");
  expect(noteType?.templates[0]?.afmt).toContain("{{Word Meaning}}");

  expect(result.media[0]?.filename).toBe("JLPT_Tango_N4_0156.mp3");
  expect(result.media[0]?.size).toBe(50580);

  expect(card).toBeDefined();
  expect(card?.deck).toBe("Kaishi 1.5k");
  expect(card?.back).toContain("わたし");
  expect(card?.back).toContain("I (polite, general)");
});

test("parses legacy anki21 decks with legacy note types + subdecks", async () => {
  const result = await legacyDeck;
  const noteType = Object.values(result.noteTypes)[0];

  expect(result.meta.format).toBe("legacy");
  expect(result.meta.name).toBe("Jlab's beginner course::Part 1: Listening comprehension");
  expect(result.meta.cardsCount).toBeGreaterThan(result.meta.notesCount);
  expect(result.meta.deckNames.length).toBe(2);

  expect(noteType).toBeDefined();
  expect(noteType?.templates.length).toBeGreaterThan(1);
  expect(noteType?.templates[0]?.qfmt).toContain("{{Audio}}");
  expect(noteType?.templates[1]?.qfmt).toContain("{{furigana:Jlab-ClozeFront}}");

  expect(result.media[0]?.filename).toBe("1600435370000.jpg");
  expect(result.cards[0]?.front).toContain("Before you start");
  expect(result.cards[0]?.back).toContain("suspend this remark");
});
