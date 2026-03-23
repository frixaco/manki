import { Database } from "bun:sqlite";
import { mkdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import JSZip from "jszip";

const FIELD_SEPARATOR = "\x1f";
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
const DEFAULT_DECK_PATH = "./Kaishi.1.5k.v2.3.apkg";

type JsonMap = Record<string, unknown>;

type ProtoField = {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
};

export interface Template {
  ord: number;
  name: string;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  id: number;
  name: string;
  fields: string[];
  templates: Template[];
}

export interface Note {
  id: number;
  guid: string;
  fields: Record<string, string>;
  tags: string[];
  noteTypeId: number;
  noteTypeName: string;
  mod: number;
}

export interface Card {
  id: number;
  noteId: number;
  deck: string;
  template: number;
  ord: number;
  front: string;
  back: string;
  mod: number;
}

export interface MediaEntry {
  index: number;
  filename: string;
  size?: number;
  hash?: string;
}

export interface DeckMeta {
  name: string;
  deckNames: string[];
  version: number;
  notesCount: number;
  cardsCount: number;
  mediaCount: number;
  created: number;
  format: "legacy" | "anki21+";
}

export interface ParseResult {
  meta: DeckMeta;
  notes: Note[];
  cards: Card[];
  noteTypes: Record<string, NoteType>;
  media: MediaEntry[];
}

export interface ParseOptions {
  extractMedia?: boolean;
}

type OpenDatabaseResult = {
  db: Database;
  cleanup: () => Promise<void>;
};

type CollectionSource = {
  entryName: string;
  bytes: Uint8Array;
};

type CollectionRow = {
  ver: number;
  crt: number;
  models: string;
  decks: string;
};

type LegacyModel = {
  name?: string;
  flds?: Array<{ name?: string }>;
  tmpls?: Array<{ ord?: number; name?: string; qfmt?: string; afmt?: string }>;
};

type LegacyDeck = {
  name?: string;
};

type LegacyNoteRow = {
  id: number;
  guid: string;
  flds: string;
  tags: string;
  mid: number;
  mod: number;
};

type LegacyCardRow = {
  id: number;
  nid: number;
  did: number;
  ord: number;
  mod: number;
};

type DeckInfo = {
  id: number;
  name: string;
};

type NoteTypeInfo = {
  output: NoteType;
  templateByOrd: Map<number, Template>;
};

type ParsedNoteRecord = {
  noteTypeId: number;
  noteTypeName: string;
  fieldValues: string[];
  fieldMap: Record<string, string>;
};

function isZstd(data: Uint8Array): boolean {
  return ZSTD_MAGIC.every((byte, index) => data[index] === byte);
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decompressZstd(data: Uint8Array, label: string): Uint8Array {
  const process = Bun.spawnSync({
    cmd: ["zstd", "-d", "-c"],
    stdin: data,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (process.exitCode !== 0) {
    const error = decodeUtf8(new Uint8Array(process.stderr)).trim();
    throw new Error(`Failed to decompress ${label}: ${error || `exit code ${process.exitCode}`}`);
  }

  return new Uint8Array(process.stdout);
}

function readVarint(data: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = start;

  while (offset < data.length) {
    const byte = data[offset]!;
    offset += 1;
    value |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return [value, offset];
    }

    shift += 7;
  }

  throw new Error("Invalid protobuf varint");
}

function parseProtoFields(data: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;

  while (offset < data.length) {
    const [key, nextOffset] = readVarint(data, offset);
    offset = nextOffset;
    const fieldNumber = key >> 3;
    const wireType = key & 0x07;

    if (wireType === 0) {
      const [value, valueOffset] = readVarint(data, offset);
      fields.push({ fieldNumber, wireType, value });
      offset = valueOffset;
      continue;
    }

    if (wireType === 1) {
      if (offset + 8 > data.length) {
        throw new Error("Invalid protobuf fixed64 field");
      }

      fields.push({ fieldNumber, wireType, value: data.slice(offset, offset + 8) });
      offset += 8;
      continue;
    }

    if (wireType === 2) {
      const [length, valueOffset] = readVarint(data, offset);
      offset = valueOffset;

      if (offset + length > data.length) {
        throw new Error("Invalid protobuf length-delimited field");
      }

      fields.push({ fieldNumber, wireType, value: data.slice(offset, offset + length) });
      offset += length;
      continue;
    }

    if (wireType === 5) {
      if (offset + 4 > data.length) {
        throw new Error("Invalid protobuf fixed32 field");
      }

      fields.push({ fieldNumber, wireType, value: data.slice(offset, offset + 4) });
      offset += 4;
      continue;
    }

    throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }

  return fields;
}

function firstProtoString(fields: ProtoField[], fieldNumber: number): string {
  const match = fields.find(
    (field) => field.fieldNumber === fieldNumber && field.wireType === 2 && field.value instanceof Uint8Array,
  );

  return match && match.value instanceof Uint8Array ? decodeUtf8(match.value) : "";
}

function firstProtoNumber(fields: ProtoField[], fieldNumber: number): number | undefined {
  const match = fields.find((field) => field.fieldNumber === fieldNumber && field.wireType === 0);
  return typeof match?.value === "number" ? match.value : undefined;
}

function parseTemplateConfig(config: Uint8Array): Pick<Template, "qfmt" | "afmt"> {
  const fields = parseProtoFields(config);
  return {
    qfmt: firstProtoString(fields, 1),
    afmt: firstProtoString(fields, 2),
  };
}

function normalizeMediaFilename(filename: string): string {
  return filename.replace(/^[/\\]+/, "");
}

export function deriveDefaultOutputDir(deckPath: string): string {
  const baseName = basename(deckPath);
  const extension = extname(baseName);
  const nameWithoutExtension = extension ? baseName.slice(0, -extension.length) : baseName;
  return `./${nameWithoutExtension}`;
}

function resolveWithin(baseDir: string, relativePath: string): string {
  const base = resolve(baseDir);
  const target = resolve(base, normalizeMediaFilename(relativePath));

  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Refusing to write outside media dir: ${relativePath}`);
  }

  return target;
}

async function loadCollection(zip: JSZip): Promise<CollectionSource> {
  const entryName = ["collection.anki21b", "collection.anki21", "collection.anki2"].find((name) => zip.file(name));

  if (!entryName) {
    throw new Error("Invalid Anki deck: no collection found");
  }

  const entry = zip.file(entryName);
  if (!entry) {
    throw new Error(`Missing zip entry: ${entryName}`);
  }

  const bytes = await entry.async("uint8array");
  return {
    entryName,
    bytes: entryName.endsWith("b") || isZstd(bytes) ? decompressZstd(bytes, entryName) : bytes,
  };
}

async function loadMediaManifest(zip: JSZip): Promise<MediaEntry[]> {
  const entry = zip.file("media");
  if (!entry) {
    return [];
  }

  let bytes = await entry.async("uint8array");
  if (isZstd(bytes)) {
    bytes = decompressZstd(bytes, "media manifest");
  }

  const text = decodeUtf8(bytes).trim();
  if (text.startsWith("{")) {
    const manifest = JSON.parse(text) as Record<string, string>;
    return Object.entries(manifest)
      .filter(([, filename]) => typeof filename === "string")
      .map(([index, filename]) => ({ index: Number(index), filename }))
      .sort((a, b) => a.index - b.index);
  }

  const fields = parseProtoFields(bytes);
  const entries = fields.filter(
    (field) => field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array,
  );

  return entries.map((field, index) => {
    const nestedFields = parseProtoFields(field.value as Uint8Array);
    const filename = firstProtoString(nestedFields, 1);
    const size = firstProtoNumber(nestedFields, 2);
    const hashField = nestedFields.find(
      (nestedField) =>
        nestedField.fieldNumber === 3 && nestedField.wireType === 2 && nestedField.value instanceof Uint8Array,
    );

    return {
      index,
      filename,
      size,
      hash: hashField && hashField.value instanceof Uint8Array ? toHex(hashField.value) : undefined,
    } satisfies MediaEntry;
  });
}

async function openDatabase(bytes: Uint8Array): Promise<OpenDatabaseResult> {
  const tempPath = join("/tmp", `manki-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  await Bun.write(tempPath, bytes);

  const db = new Database(tempPath, { readonly: true });
  return {
    db,
    cleanup: async () => {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { present?: number } | null;

  return row?.present === 1;
}

function parseJsonMap(text: string): JsonMap {
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as JsonMap) : {};
}

function buildFieldMap(fieldNames: string[], fieldValues: string[]): Record<string, string> {
  const fieldMap: Record<string, string> = {};
  const maxLength = Math.max(fieldNames.length, fieldValues.length);

  for (let index = 0; index < maxLength; index += 1) {
    const fieldName = fieldNames[index] || `field_${index}`;
    fieldMap[fieldName] = fieldValues[index] || "";
  }

  return fieldMap;
}

function splitFields(flds: string): string[] {
  return String(flds || "").split(FIELD_SEPARATOR);
}

function createNoteTypeInfo(noteType: NoteType): NoteTypeInfo {
  return {
    output: noteType,
    templateByOrd: new Map(noteType.templates.map((template) => [template.ord, template])),
  };
}

function loadLegacyMetadata(col: CollectionRow): {
  decks: Map<number, DeckInfo>;
  noteTypes: Map<number, NoteTypeInfo>;
} {
  const deckRows = parseJsonMap(col.decks);
  const modelRows = parseJsonMap(col.models);

  const decks = new Map<number, DeckInfo>();
  for (const [deckId, rawDeck] of Object.entries(deckRows)) {
    const deck = rawDeck as LegacyDeck;
    decks.set(Number(deckId), {
      id: Number(deckId),
      name: deck.name || "Unknown",
    });
  }

  const noteTypes = new Map<number, NoteTypeInfo>();
  for (const [modelId, rawModel] of Object.entries(modelRows)) {
    const model = rawModel as LegacyModel;
    const fields = (model.flds || []).map((field) => field.name || "");
    const templates = (model.tmpls || [])
      .map((template, index) => ({
        ord: template.ord ?? index,
        name: template.name || `Card ${index + 1}`,
        qfmt: template.qfmt || "",
        afmt: template.afmt || "",
      }))
      .sort((left, right) => left.ord - right.ord);

    noteTypes.set(
      Number(modelId),
      createNoteTypeInfo({
        id: Number(modelId),
        name: model.name || "Unknown",
        fields,
        templates,
      }),
    );
  }

  return { decks, noteTypes };
}

function loadModernMetadata(db: Database): {
  decks: Map<number, DeckInfo>;
  noteTypes: Map<number, NoteTypeInfo>;
} {
  const deckRows = db.query("SELECT id, name FROM decks ORDER BY id").all() as Array<{ id: number; name: string }>;
  const notetypeRows = db.query("SELECT id, name FROM notetypes ORDER BY id").all() as Array<{ id: number; name: string }>;
  const fieldRows = db
    .query("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord")
    .all() as Array<{ ntid: number; ord: number; name: string }>;
  const templateRows = db
    .query("SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord")
    .all() as Array<{ ntid: number; ord: number; name: string; config: Uint8Array }>;

  const decks = new Map<number, DeckInfo>();
  for (const deck of deckRows) {
    decks.set(deck.id, { id: deck.id, name: deck.name });
  }

  const fieldNamesByNoteType = new Map<number, string[]>();
  for (const field of fieldRows) {
    const fieldNames = fieldNamesByNoteType.get(field.ntid) || [];
    fieldNames[field.ord] = field.name;
    fieldNamesByNoteType.set(field.ntid, fieldNames);
  }

  const templatesByNoteType = new Map<number, Template[]>();
  for (const templateRow of templateRows) {
    const decoded = parseTemplateConfig(new Uint8Array(templateRow.config));
    const templates = templatesByNoteType.get(templateRow.ntid) || [];
    templates.push({
      ord: templateRow.ord,
      name: templateRow.name,
      qfmt: decoded.qfmt,
      afmt: decoded.afmt,
    });
    templatesByNoteType.set(templateRow.ntid, templates);
  }

  const noteTypes = new Map<number, NoteTypeInfo>();
  for (const notetype of notetypeRows) {
    const templates = (templatesByNoteType.get(notetype.id) || []).sort((left, right) => left.ord - right.ord);
    noteTypes.set(
      notetype.id,
      createNoteTypeInfo({
        id: notetype.id,
        name: notetype.name,
        fields: fieldNamesByNoteType.get(notetype.id) || [],
        templates,
      }),
    );
  }

  return { decks, noteTypes };
}

function applySections(template: string, fields: Record<string, string>): string {
  let rendered = template;
  const sectionPattern = /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/([^}]+)\}\}/g;

  while (true) {
    let changed = false;
    rendered = rendered.replace(sectionPattern, (match, mode, openName, content, closeName) => {
      const open = String(openName).trim();
      const close = String(closeName).trim();
      if (open !== close) {
        return match;
      }

      changed = true;
      const hasValue = Boolean(fields[open]);
      if (mode === "#") {
        return hasValue ? content : "";
      }

      return hasValue ? "" : content;
    });

    if (!changed) {
      return rendered;
    }
  }
}

function renderCloze(value: string, cardOrd: number, reveal: boolean): string {
  const targetCloze = cardOrd + 1;
  return value.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_match, rawIndex, content, hint) => {
    const clozeIndex = Number(rawIndex);
    if (reveal || clozeIndex !== targetCloze) {
      return content;
    }

    const textHint = typeof hint === "string" && hint.trim() ? hint.trim() : "...";
    return `[${textHint}]`;
  });
}

function resolveFieldToken(
  rawToken: string,
  fields: Record<string, string>,
  cardOrd: number,
  frontSide: string,
  reveal: boolean,
): string {
  const token = rawToken.trim();
  if (!token) {
    return "";
  }

  if (token === "FrontSide") {
    return frontSide;
  }

  const parts = token.split(":").map((part) => part.trim()).filter(Boolean);
  const fieldName = parts[parts.length - 1];
  if (!fieldName) {
    return "";
  }

  const value = fields[fieldName] || "";
  if (!value) {
    return "";
  }

  if (parts.includes("cloze")) {
    return renderCloze(value, cardOrd, reveal);
  }

  return value;
}

function cleanupRenderedTemplate(template: string): string {
  return template
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTemplate(
  template: string,
  fields: Record<string, string>,
  cardOrd: number,
  options: { frontSide?: string; revealCloze?: boolean } = {},
): string {
  const withSections = applySections(template, fields);
  const rendered = withSections.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawToken) =>
    resolveFieldToken(String(rawToken), fields, cardOrd, options.frontSide || "", Boolean(options.revealCloze)),
  );

  return cleanupRenderedTemplate(rendered);
}

async function extractMedia(zip: JSZip, mediaEntries: MediaEntry[], outputDir: string): Promise<void> {
  if (mediaEntries.length === 0) {
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const mediaNameByIndex = new Map(mediaEntries.map((entry) => [entry.index, entry.filename]));
  const numericEntryNames = Object.keys(zip.files)
    .filter((name) => /^\d+$/.test(name) && !zip.files[name]?.dir)
    .sort((left, right) => Number(left) - Number(right));

  for (const entryName of numericEntryNames) {
    const entry = zip.file(entryName);
    if (!entry) {
      continue;
    }

    let bytes = await entry.async("uint8array");
    if (isZstd(bytes)) {
      bytes = decompressZstd(bytes, `media/${entryName}`);
    }

    const filename = mediaNameByIndex.get(Number(entryName)) || entryName;
    const destination = resolveWithin(outputDir, filename);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, bytes);
  }
}

async function writeOutputs(outputDir: string, result: ParseResult, extractMediaFiles: boolean, zip: JSZip): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Bun.write(join(outputDir, "meta.json"), JSON.stringify(result.meta, null, 2));
  await Bun.write(join(outputDir, "notes.json"), JSON.stringify(result.notes, null, 2));
  await Bun.write(join(outputDir, "cards.json"), JSON.stringify(result.cards, null, 2));
  await Bun.write(join(outputDir, "notetypes.json"), JSON.stringify(result.noteTypes, null, 2));
  await Bun.write(join(outputDir, "media.json"), JSON.stringify(result.media, null, 2));

  if (extractMediaFiles) {
    await extractMedia(zip, result.media, join(outputDir, "media"));
  }
}

export async function parseApkg(
  deckPath: string,
  outputDir?: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const fileData = await Bun.file(deckPath).arrayBuffer();
  const zip = await JSZip.loadAsync(fileData);
  const collection = await loadCollection(zip);
  const media = await loadMediaManifest(zip);
  const { db, cleanup } = await openDatabase(collection.bytes);

  try {
    const col = db.query("SELECT ver, crt, models, decks FROM col LIMIT 1").get() as CollectionRow | null;
    if (!col) {
      throw new Error("Invalid collection: missing col row");
    }

    const modernFormat = hasTable(db, "notetypes") && hasTable(db, "templates") && hasTable(db, "fields") && hasTable(db, "decks");
    const { decks, noteTypes } = modernFormat ? loadModernMetadata(db) : loadLegacyMetadata(col);

    const noteRows = db
      .query("SELECT id, guid, flds, tags, mid, mod FROM notes ORDER BY id")
      .all() as LegacyNoteRow[];
    const cardRows = db
      .query("SELECT id, nid, did, ord, mod FROM cards ORDER BY id")
      .all() as LegacyCardRow[];

    const parsedNotesById = new Map<number, ParsedNoteRecord>();
    const notes: Note[] = [];

    for (const noteRow of noteRows) {
      const noteType = noteTypes.get(noteRow.mid);
      const fieldValues = splitFields(noteRow.flds);
      const fieldMap = buildFieldMap(noteType?.output.fields || [], fieldValues);
      const noteTypeName = noteType?.output.name || "Unknown";

      parsedNotesById.set(noteRow.id, {
        noteTypeId: noteRow.mid,
        noteTypeName,
        fieldValues,
        fieldMap,
      });

      notes.push({
        id: noteRow.id,
        guid: noteRow.guid,
        fields: fieldMap,
        tags: String(noteRow.tags || "")
          .split(/\s+/)
          .filter(Boolean),
        noteTypeId: noteRow.mid,
        noteTypeName,
        mod: noteRow.mod,
      });
    }

    const usedDeckNames = new Set<string>();
    const cards: Card[] = [];

    for (const cardRow of cardRows) {
      const parsedNote = parsedNotesById.get(cardRow.nid);
      const noteType = parsedNote ? noteTypes.get(parsedNote.noteTypeId) : undefined;
      const template = noteType?.templateByOrd.get(cardRow.ord);
      const fields = parsedNote?.fieldMap || {};
      const fieldValues = parsedNote?.fieldValues || [];
      const front = template
        ? renderTemplate(template.qfmt, fields, cardRow.ord)
        : cleanupRenderedTemplate(fieldValues[0] || "");
      const back = template
        ? renderTemplate(template.afmt, fields, cardRow.ord, { frontSide: front, revealCloze: true })
        : cleanupRenderedTemplate(fieldValues[1] || fieldValues[0] || "");
      const deckName = decks.get(cardRow.did)?.name || "Unknown";

      usedDeckNames.add(deckName);
      cards.push({
        id: cardRow.id,
        noteId: cardRow.nid,
        deck: deckName,
        template: cardRow.ord,
        ord: cardRow.ord,
        front: front || cleanupRenderedTemplate(fieldValues[0] || ""),
        back: back || cleanupRenderedTemplate(fieldValues[1] || fieldValues[0] || ""),
        mod: cardRow.mod,
      });
    }

    const deckNames = Array.from(usedDeckNames).filter((name) => name !== "Unknown");
    const name = deckNames[0] || decks.get(1)?.name || "Unknown";
    const result: ParseResult = {
      meta: {
        name,
        deckNames,
        version: col.ver,
        notesCount: notes.length,
        cardsCount: cards.length,
        mediaCount: media.length,
        created: col.crt,
        format: modernFormat ? "anki21+" : "legacy",
      },
      notes,
      cards,
      noteTypes: Object.fromEntries(
        Array.from(noteTypes.values()).map((noteType) => [String(noteType.output.id), noteType.output]),
      ),
      media,
    };

    if (outputDir) {
      const extractMediaFiles = options.extractMedia ?? true;
      await writeOutputs(outputDir, result, extractMediaFiles, zip);
    }

    return result;
  } finally {
    db.close();
    await cleanup();
  }
}

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

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
