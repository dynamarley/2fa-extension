import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Dependency-free ZIP writer (stored entries, CRC-32).
const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "src/popup.js",
  "src/totp.js",
  "README.md",
  "docs/screenshot.png",
  "assets/icon.svg",
  ...[16, 32, 48, 128].map((size) => `assets/icon-${size}.png`),
];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunks = [];
const directory = [];
let offset = 0;
for (const file of files) {
  const bytes = await readFile(path.join(root, file));
  const name = Buffer.from(file);
  const crc = crc32(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(bytes.length, 20);
  entry.writeUInt32LE(bytes.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  chunks.push(header, name, bytes);
  directory.push(entry, name);
  offset += header.length + name.length + bytes.length;
}
const central = Buffer.concat(directory);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(path.join(root, "dist"), { recursive: true });
const output = path.join(root, "dist", "cep-2fa.zip");
await writeFile(output, Buffer.concat([...chunks, central, end]));
console.log(`Package ready: ${output}`);
