import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Builds the bytes of a Visual Basic 6 .frx, the binary companion a .frm
 * points into by offset, so the reader can be held against records whose
 * layout the test chose. Both list layouts and both text layouts are here,
 * because the reader must accept either and the suite must prove it does.
 * Run directly, it writes frmLogin.frx beside the .frm fixture and prints the
 * offset each record landed at, which the .frm's pointers spell in hex.
 */

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
/** ANSI bytes: a code point up to 255 is its own byte, which is Windows 1252 for the letters a test spells. */
export const ansi = (s) => [...String(s)].map((c) => c.charCodeAt(0) & 0xff);
export const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");

/** A list as a 2 byte count of items, then per item a 2 byte length and its bytes. */
export const listRecord = (items) => [...u16(items.length), ...items.flatMap((s) => { const b = ansi(s); return [...u16(b.length), ...b]; })];
/** The same list behind a 4 byte count of the payload's bytes, which the items fill exactly. */
export const sizedListRecord = (items) => { const inner = listRecord(items); return [...u32(inner.length), ...inner]; };
/** A long text as a 4 byte length and its bytes. */
export const textRecord = (text) => { const b = ansi(text); return [...u32(b.length), ...b]; };
/** A text as a 2 byte length and its bytes. */
export const shortTextRecord = (text) => { const b = ansi(text); return [...u16(b.length), ...b]; };
/** ItemData: a 2 byte count, then a 4 byte number per item. */
export const itemDataRecord = (numbers) => [...u16(numbers.length), ...numbers.flatMap((n) => u32(n))];
/** A picture: a 4 byte size of what follows, the `lt` marker, a 4 byte size of the image, the image. */
export const pictureRecord = (image) => [...u32(image.length + 8), 0x6c, 0x74, 0, 0, ...u32(image.length), ...image];
/** An empty picture: a size of zero and nothing after it. */
export const emptyPictureRecord = () => u32(0);

/** A one pixel 24 bit bitmap, 58 bytes, the smallest picture a .frx carries. */
export function bitmap(bgr = [0x40, 0x80, 0xc0]) {
  return [
    0x42, 0x4d, ...u32(58), ...u16(0), ...u16(0), ...u32(54),
    ...u32(40), ...u32(1), ...u32(1), ...u16(1), ...u16(24), ...u32(0), ...u32(4), ...u32(2835), ...u32(2835), ...u32(0), ...u32(0),
    ...bgr, 0,
  ];
}

/** Records laid end to end, as VB writes them; the offset of each is what the .frm's pointer must spell. */
export function frx(records) {
  const offsets = [];
  const bytes = [];
  for (const r of records) { offsets.push(bytes.length); bytes.push(...r); }
  return { bytes: Buffer.from(bytes), offsets };
}

/** The companion of the frmLogin.frm fixture: ItemData and List for cboRegion, a long Text for txtNotes, a Picture for imgLogo. */
export const LOGIN_ITEMS = ["North", "South", "East", "West"];
export function loginFrx() {
  const built = frx([itemDataRecord([1, 2, 3, 4]), listRecord(LOGIN_ITEMS), textRecord("Enter notes here."), pictureRecord(bitmap())]);
  const [ItemData, List, Text, Picture] = built.offsets;
  return { bytes: built.bytes, offsets: { ItemData, List, Text, Picture } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bytes, offsets } = loginFrx();
  const here = dirname(fileURLToPath(import.meta.url));
  await writeFile(join(here, "frmLogin.frx"), bytes);
  for (const [property, at] of Object.entries(offsets)) console.log(`${property} = "frmLogin.frx":${hex(at)}`);
  console.log(`${bytes.length} bytes`);
}
