import { deriveDefaultOutputDir, parseApkg } from "./parse_anki.ts";

const DEFAULT_DECK_PATH = "./Kaishi.1.5k.v2.3.apkg";

async function main(): Promise<void> {
  const deckPath = Bun.argv[2] || DEFAULT_DECK_PATH;
  const outputDir = Bun.argv[3] || deriveDefaultOutputDir(deckPath);
  const result = await parseApkg(deckPath, outputDir, { extractMedia: true });

  console.log(`Parsed ${result.meta.notesCount} notes, ${result.meta.cardsCount} cards`);
  console.log(`Decks: ${result.meta.deckNames.join(", ") || result.meta.name}`);
  console.log(`Media: ${result.meta.mediaCount}`);
  console.log(`Output: ${outputDir}/{meta,notes,cards,notetypes,media}.json`);
  console.log(`Media extracted to ${outputDir}/media/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
