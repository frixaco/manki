import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import JSZip from "jszip";
import { execSync } from "child_process";

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
  const mediaFiles: { name: string; compressed: boolean }[] = [];
  
  for (const name of Object.keys(zipFiles)) {
    const file = zipFiles[name];
    if (/^\d+$/.test(name) && !file.dir) {
      const compressedData = await file.async("uint8array");
      const tmpPath = `/tmp/media_${name}_${Date.now()}.bin`;
      require("fs").writeFileSync(tmpPath, Buffer.from(compressedData));
      
      const fileType = require("child_process").execSync(`file -b "${tmpPath}"`).toString();
      
      if (fileType.includes("Zstandard") || fileType.includes("zstd")) {
        execSync(`zstd -d "${tmpPath}" -o "${tmpPath}_decompressed"`);
        const decompressed = require("fs").readFileSync(`${tmpPath}_decompressed`);
        await Bun.write(`${outputDir}/media/${name}`, decompressed);
        require("fs").unlinkSync(`${tmpPath}_decompressed`);
      } else {
        await Bun.write(`${outputDir}/media/${name}`, compressedData);
      }
      require("fs").unlinkSync(tmpPath);
    }
  }
  
  let db: Database;
  let isNewFormat = false;
  
  const collectionAnki21 = zipFiles["collection.anki21"];
  const collectionAnki21b = zipFiles["collection.anki21b"];
  const collectionAnki2 = zipFiles["collection.anki2"];
  
  if (collectionAnki21) {
    const data = await collectionAnki21.async("uint8array");
    db = new Database(data);
    isNewFormat = false;
  } else if (collectionAnki21b) {
    const compressedData = await collectionAnki21b.async("uint8array");
    const tmpPath = `/tmp/collection_${Date.now()}.anki2`;
    require("fs").writeFileSync(tmpPath + ".zstd", Buffer.from(compressedData));
    execSync(`zstd -d "${tmpPath}.zstd" -o "${tmpPath}"`);
    db = new Database(tmpPath);
    isNewFormat = true;
  } else if (collectionAnki2) {
    const data = await collectionAnki2.async("uint8array");
    db = new Database(data);
    isNewFormat = false;
  } else {
    throw new Error("Invalid Anki deck: no collection found");
  }
  
  const col = db.query("SELECT * FROM col").get() as any;
  const deckName = col?.name || "Unknown";
  
  let models: Record<number, any> = {};
  let decks: Record<number, any> = {};
  let noteTypesMap: Record<number, NoteType> = {};
  
  if (isNewFormat) {
    const notetypes = db.query("SELECT * FROM notetypes").all() as any[];
    const templates = db.query("SELECT * FROM templates").all() as any[];
    const fields = db.query("SELECT * FROM fields").all() as any[];
    const decksRows = db.query("SELECT * FROM decks").all() as any[];
    
    for (const d of decksRows) {
      decks[d.id] = d;
    }
    
    for (const nt of notetypes) {
      const ntFields = fields.filter((f: any) => f.ntid === nt.id);
      const ntTemplates = templates.filter((t: any) => t.ntid === nt.id);
      
      noteTypesMap[nt.id] = {
        id: nt.id,
        name: nt.name,
        fields: ntFields.map((f: any) => f.name),
        templates: ntTemplates.map((t: any) => ({
          name: t.name,
          qfmt: t.qfmt,
          afmt: t.afmt,
        })),
      };
    }
  } else {
    const modelsRaw: Record<string, any> = JSON.parse(col?.models || "{}");
    const decksRaw: Record<string, any> = JSON.parse(col?.decks || "{}");
    
    for (const [k, v] of Object.entries(modelsRaw)) {
      models[parseInt(k)] = v;
    }
    for (const [k, v] of Object.entries(decksRaw)) {
      decks[parseInt(k)] = v;
    }
    
    for (const [id, m] of Object.entries(models)) {
      const modelId = parseInt(id as string);
      const fields = (m.flds as any[]).map((f: any) => f.name);
      const templates = (m.tmpls as any[]).map((t: any) => ({
        name: t.name,
        qfmt: t.qfmt,
        afmt: t.afmt,
      }));
      noteTypesMap[modelId] = {
        id: modelId,
        name: m.name,
        fields,
        templates,
      };
    }
  }
  
  const notes = db.query("SELECT * FROM notes").all() as any[];
  const notesMap: Record<number, any> = {};
  for (const n of notes) {
    notesMap[n.id] = n;
  }
  
  const cards = db.query("SELECT * FROM cards").all() as any[];
  
  const notesOutput: Note[] = [];
  for (const n of notes) {
    let fieldNames: string[] = [];
    let fieldValues = n.flds.split("\x1f");
    
    if (isNewFormat) {
      const model = noteTypesMap[n.mid];
      fieldNames = model?.fields || [];
    } else {
      const model = models[n.mid];
      fieldNames = model ? (model.flds as any[]).map((f: any) => f.name) : [];
    }
    
    const noteFields: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length; i++) {
      noteFields[fieldNames[i] || `field_${i}`] = fieldValues[i] || "";
    }
    
    let noteTypeName = "Unknown";
    if (isNewFormat) {
      noteTypeName = noteTypesMap[n.mid]?.name || "Unknown";
    } else {
      noteTypeName = models[n.mid]?.name || "Unknown";
    }
    
    notesOutput.push({
      id: n.id,
      guid: n.guid,
      fields: noteFields,
      tags: n.tags ? n.tags.split(" ").filter(Boolean) : [],
      noteTypeId: n.mid,
      noteTypeName,
      mod: n.mod,
    });
  }
  
  const cardsOutput: Card[] = [];
  for (const c of cards) {
    const note = notesMap[c.nid];
    
    let fieldNames: string[] = [];
    let fieldValues = (note?.flds || "").split("\x1f");
    let templates: any[] = [];
    
    if (isNewFormat) {
      const model = noteTypesMap[note?.mid];
      fieldNames = model?.fields || [];
      templates = model?.templates || [];
    } else {
      const model = models[note?.mid];
      fieldNames = model ? (model.flds as any[]).map((f: any) => f.name) : [];
      templates = model?.tmpls || [];
    }
    
    const noteFields: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length; i++) {
      noteFields[fieldNames[i] || `field_${i}`] = fieldValues[i] || "";
    }
    
    let front = "", back = "";
    const tpl = templates[c.ord];
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
    
    const deckName = decks[c.did]?.name || "Unknown";
    
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

const deckPath = Bun.argv[2] || "./Kaishi.1.5k.v2.3.apkg";
const outputDir = Bun.argv[3] || "./parsed_deck";

parseApkg(deckPath, outputDir).catch(console.error);
