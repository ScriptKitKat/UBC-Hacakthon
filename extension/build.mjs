import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = `${root}dist`;
const ICON_SIZES = [16, 48, 128];
const TOKEN_NAME = "FEED_API_TOKEN";

async function defaultDeskToken() {
  const fromEnv = process.env[TOKEN_NAME]?.trim();
  if (fromEnv) return fromEnv;
  const envFile = await readFile(`${root}../.env.local`, "utf8").catch(() => "");
  const line = envFile.split(/\r?\n/u).find((entry) => entry.startsWith(`${TOKEN_NAME}=`));
  return (line?.slice(TOKEN_NAME.length + 1).trim().replace(/^(["'])(.*)\1$/u, "$2")) ?? "";
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

const LIME = [200, 243, 29, 255];
const LIME_DEEP = [155, 196, 10, 255];
const INK = [29, 41, 61, 255];
const STROKE = 4 / 64;

function distanceToSegment(u, v, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(u - (ax + t * (bx - ax)), v - (ay + t * (by - ay)));
}

function onLetter(u, v) {
  const stem = distanceToSegment(u, v, 24 / 64, 18 / 64, 24 / 64, 46 / 64);
  const top = distanceToSegment(u, v, 24 / 64, 18 / 64, 33 / 64, 18 / 64);
  const bottom = distanceToSegment(u, v, 24 / 64, 38 / 64, 33 / 64, 38 / 64);
  const bowl = u >= 33 / 64 ? Math.abs(Math.hypot(u - 33 / 64, v - 28 / 64) - 10 / 64) : Infinity;
  return Math.min(stem, top, bottom, bowl) <= STROKE;
}

function iconPixel(x, y, size) {
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const radius = 28 / 64;
  if (Math.hypot(u - 0.5, v - 31 / 64) <= radius) return onLetter(u, v) ? INK : LIME;
  if (Math.hypot(u - 0.5, v - 34 / 64) <= radius) return LIME_DEEP;
  return [0, 0, 0, 0];
}

function iconPng(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) row.set(iconPixel(x, y, size), 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/icons`, { recursive: true });

const shared = { define: { __DEFAULT_DESK_TOKEN__: JSON.stringify("") }, bundle: true, minify: true, target: "chrome120", loader: { ".woff2": "binary" }, logLevel: "info", tsconfig: `${root}tsconfig.json` };
await build({ ...shared, entryPoints: [`${root}src/content.ts`], outfile: `${dist}/content.js`, format: "iife" });
await build({ ...shared, entryPoints: [`${root}src/options.ts`], outfile: `${dist}/options.js`, format: "iife" });
await build({ ...shared, entryPoints: [`${root}src/popup.ts`], outfile: `${dist}/popup.js`, format: "iife" });
const deskToken = await defaultDeskToken();
await build({
  ...shared,
  entryPoints: [`${root}src/background.ts`],
  outfile: `${dist}/background.js`,
  format: "esm",
  define: { __DEFAULT_DESK_TOKEN__: JSON.stringify(deskToken) },
});
console.log(deskToken === "" ? "Desk token: none baked in (set it in the extension options)" : "Desk token: baked into dist/background.js");

await copyFile(`${root}manifest.json`, `${dist}/manifest.json`);
await copyFile(`${root}options.html`, `${dist}/options.html`);
await copyFile(`${root}popup.html`, `${dist}/popup.html`);
await Promise.all(ICON_SIZES.map((size) => writeFile(`${dist}/icons/icon-${String(size)}.png`, iconPng(size))));
