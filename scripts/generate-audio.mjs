import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { units } from "../app/data.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "app", "audio-manifest.json");
const manifestOnly = process.argv.includes("--manifest-only");
const checkOnly = process.argv.includes("--check-only");

const voices = {
  "en-GB": { name: "en-GB-SoniaNeural", label: "英音 · Sonia Neural" },
  "en-US": { name: "en-US-JennyNeural", label: "美音 · Jenny Neural" },
  "zh-CN": { name: "zh-CN-XiaoxiaoNeural", label: "中文 · Xiaoxiao Neural" },
};

function unique(items) {
  return [...new Set(items)];
}

function filenameFor(text) {
  const readable = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  const hash = createHash("sha1").update(text).digest("hex").slice(0, 12);
  return `${readable || "speech"}-${hash}.mp3`;
}

function createEntries(texts) {
  return Object.fromEntries(texts.map((text) => [text, filenameFor(text)]));
}

const englishTexts = unique(
  units.flatMap((unit) => [
    ...unit.vocab.map((item) => item.term),
    ...unit.phrases.map((item) => item.term),
    ...unit.sentences.map((item) => item.en),
  ]),
);
const chineseTexts = unique(
  units.flatMap((unit) => [
    ...unit.vocab.map((item) => item.meaning),
    ...unit.phrases.map((item) => item.meaning),
    ...unit.sentences.map((item) => item.zh),
  ]),
);

const englishEntries = createEntries(englishTexts);
const manifest = {
  version: 1,
  voices,
  entries: {
    "en-GB": englishEntries,
    "en-US": englishEntries,
    "zh-CN": createEntries(chineseTexts),
  },
};

await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

for (const locale of Object.keys(voices)) {
  await mkdir(path.join(projectRoot, "public", "audio", locale), { recursive: true });
}

console.log(
  `Audio manifest: ${englishTexts.length} English items × 2 accents, ${chineseTexts.length} Chinese items.`,
);

if (manifestOnly) process.exit(0);

async function exists(candidate) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const candidates = [
  process.env.EDGE_TTS_PYTHON,
  path.join(projectRoot, ".venv", "bin", "python"),
  path.join(projectRoot, "..", ".venv-edge-tts", "bin", "python"),
].filter(Boolean);

let python = "python3";
for (const candidate of candidates) {
  if (await exists(candidate)) {
    python = candidate;
    break;
  }
}

const child = spawn(
  python,
  [
    path.join(projectRoot, "scripts", "generate_audio.py"),
    "--manifest",
    manifestPath,
    ...(checkOnly ? ["--check-only"] : []),
  ],
  { cwd: projectRoot, stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`Unable to start the audio generator: ${error.message}`);
  process.exit(1);
});
