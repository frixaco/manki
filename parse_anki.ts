import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import JSZip from "jszip";
import { execSync } from "child_process";

const DECK_PATH = "./Kaishi.1.5k.v2.3.apkg";
const OUTPUT_DIR = "./parsed_deck";

interface Note {
  id: number;
  guid: string;
  fields: Record<string, string>;
  tags: string[];
  noteTypeId: number;
  noteTypeName: string;
  mod: number;
}

interface Card {
  id: number;
  noteId: number;
  deck: string;
  template: number;
  ord: number;
  front: string;
  back: string;
  mod: number;
}

interface DeckMeta {
  name: string;
  version: number;
  notesCount: number;
  cardsCount: number;
  created: number;
}

interface NoteType {
  id: number;
  name: string;
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
}

async function parseApkg(deckPath: string, outputDir: string) {
  const fileData = await Bun.file(deckPath).arrayBuffer();
  const zip = await JSZip.loadAsync(fileData);
  
  await mkdir(`${outputDir}/media`, { recursive: true });
  
  const zipFiles = zip.files;
  
  for (const name of Object.keys(zipFiles)) {
    const file = zipFiles[name];
    if (/^\d+$/.test(name) && !file.dir) {
      const compressedData = await file.async("uint8array");
      const tmpPath = `/tmp/media_${name}_${Date.now()}.bin`;
      require("fs").writeFileSync(tmpPath, Buffer.from(compressedData));
      execSync(`zstd -d "${tmpPath}" -o "${tmpPath}_decompressed"`);
      const decompressed = require("fs").readFileSync(`${tmpPath}_decompressed`);
      await Bun.write(`${outputDir}/media/${name}`, decompressed);
      require("fs").unlinkSync(tmpPath);
      require("fs").unlinkSync(`${tmpPath}_decompressed`);
    }
  }
  
  const collectionAnki21b = zipFiles["collection.anki21b"];
  let db: Database;
  
  if (collectionAnki21b) {
    const compressedData = await collectionAnki21b.async("uint8array");
    const tmpPath = `/tmp/collection_${Date.now()}.anki2`;
    require("fs").writeFileSync(tmpPath + ".zstd", Buffer.from(compressedData));
    execSync(`zstd -d "${tmpPath}.zstd" -o "${tmpPath}"`);
    db = new Database(tmpPath);
  } else if (zipFiles["collection.anki2"]) {
    const collectionData = await zipFiles["collection.anki2"].async("uint8array");
    db = new Database(collectionData);
  } else {
    throw new Error("Invalid Anki deck: no collection.anki2 or collection.anki21b found");
  }
  
  const col = db.query("SELECT * FROM col").get() as any;
  const deckName = col?.name || "Unknown";
  
  const notetypes = db.query("SELECT * FROM notetypes").all() as any[];
  const templates = db.query("SELECT * FROM templates").all() as any[];
  const fields = db.query("SELECT * FROM fields").all() as any[];
  const decks = db.query("SELECT * FROM decks").all() as any[];
  
  const noteTypesMap: Record<number, NoteType> = {};
  for (const nt of notetypes) {
    const ntFields = fields.filter(f => f.ntid === nt.id);
    const ntTemplates = templates.filter(t => t.ntid === nt.id);
    
    noteTypesMap[nt.id] = {
      id: nt.id,
      name: nt.name,
      fields: ntFields.map(f => f.name),
      templates: ntTemplates.map(t => ({
        name: t.name,
        qfmt: t.qfmt,
        afmt: t.afmt,
      })),
    };
  }
  
  const decksMap: Record<number, any> = {};
  for (const d of decks) {
    decksMap[d.id] = d;
  }
  
  const notes = db.query("SELECT * FROM notes").all() as any[];
  const notesMap: Record<number, any> = {};
  for (const n of notes) {
    notesMap[n.id] = n;
  }
  
  const cards = db.query("SELECT * FROM cards").all() as any[];
  
  const notesOutput: Note[] = [];
  for (const n of notes) {
    const model = noteTypesMap[n.mid];
    const fieldNames = model?.fields || [];
    const fieldValues = n.flds.split("\x1f");
    const noteFields: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length; i++) {
      noteFields[fieldNames[i] || `field_${i}`] = fieldValues[i] || "";
    }
    
    notesOutput.push({
      id: n.id,
      guid: n.guid,
      fields: noteFields,
      tags: n.tags ? n.tags.split(" ").filter(Boolean) : [],
      noteTypeId: n.mid,
      noteTypeName: model?.name || "Unknown",
      mod: n.mod,
    });
  }
  
  const cardsOutput: Card[] = [];
  for (const c of cards) {
    const note = notesMap[c.nid];
    const model = noteTypesMap[note?.mid];
    const tpls = model?.templates || [];
    const fieldNames = model?.fields || [];
    const fieldValues = (note?.flds || "").split("\x1f");
    const noteFields: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length; i++) {
      noteFields[fieldNames[i] || `field_${i}`] = fieldValues[i] || "";
    }
    
    let front = "", back = "";
    const tpl = tpls[c.ord];
    if (tpl) {
      front = tpl.qfmt || "";
      back = tpl.afmt || "";
      for (let i = 0; i < fieldValues.length; i++) {
        const regex = new RegExp(`\\{\\{${i + 1}\\}\\}`, "g");
        const namedRegex = new RegExp(`\\{\\{[^}]+:${fieldNames[i] || ""}\\}\\}`, "g");
        front = front.replace(namedRegex, fieldValues[i] || "").replace(regex, fieldValues[i] || "");
        back = back.replace(namedRegex, fieldValues[i] || "").replace(regex, fieldValues[i] || "");
      }
      front = front.replace(/\{\{[^}]+\}\}/g, "");
      back = back.replace(/\{\{[^}]+\}\}/g, "");
    }
    
    const deckName = decksMap[c.did]?.name || "Unknown";
    
    cardsOutput.push({
      id: c.id,
      noteId: c.nid,
      deck: deckName,
      template: c.ord,
      ord: c.ord,
      front: front || fieldValues[0] || "",
      back: back || fieldValues[1] || "",
      mod: c.mod,
    });
  }
  
  const meta: DeckMeta = {
    name: deckName,
    version: col?.ver || 0,
    notesCount: notesOutput.length,
    cardsCount: cardsOutput.length,
    created: col?.crt || 0,
  };
  
  await Bun.write(`${outputDir}/meta.json`, JSON.stringify(meta, null, 2));
  await Bun.write(`${outputDir}/notes.json`, JSON.stringify(notesOutput, null, 2));
  await Bun.write(`${outputDir}/cards.json`, JSON.stringify(cardsOutput, null, 2));
  await Bun.write(`${outputDir}/notetypes.json`, JSON.stringify(noteTypesMap, null, 2));
  
  db.close();
  
  console.log(`Parsed ${meta.notesCount} notes, ${meta.cardsCount} cards`);
  console.log(`Media extracted to ${outputDir}/media/`);
  console.log(`Output: ${outputDir}/{meta,notes,cards,notetypes}.json`);
}

parseApkg(DECK_PATH, OUTPUT_DIR).catch(console.error);
