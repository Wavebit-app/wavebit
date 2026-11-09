// Renders every desktop icon from the mark in assets/brand/logo-mark.svg: icon.png
// (512), icon.ico (16–256), icon.icns (macOS) and icons/ (Linux, 16–512). The
// desktop icon is the white wave on a brand-blue tile (DESIGN.md › Logo). Run
// with `npm run icons`; outputs are committed.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../assets/brand/', import.meta.url));
const mark = /\bd="([^"]+)"/.exec(
  readFileSync(`${dir}logo-mark.svg`, 'utf8'),
)[1];

/** Small sizes get a heavier stroke, so the wave stays readable. */
const strokeFor = (size) => (size <= 24 ? 3.4 : size <= 48 ? 3 : 2.6);

/** `inset` shrinks the tile inside the canvas: macOS icons sit on Apple's grid. */
const svg = (size, inset = 0) => {
  const tile = 24 - inset * 2;
  const scale = 0.65 * (tile / 24);
  const offset = (24 - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${5.4 * (tile / 24)}" fill="#2f5bea"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="${strokeFor(size)}" stroke-linecap="round" stroke-linejoin="round"><path d="${mark}"/></g>
</svg>`;
};
const render = (size, inset) =>
  new Resvg(svg(size, inset), { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();

writeFileSync(`${dir}icon.png`, render(512));

mkdirSync(`${dir}icons`, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512])
  writeFileSync(`${dir}icons/${size}x${size}.png`, render(size));

// ICO: 6-byte header, one 16-byte entry per image, then the PNG bytes.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => render(size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(size % 256, at); // 0 means 256
  header.writeUInt8(size % 256, at + 1);
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
writeFileSync(`${dir}icon.ico`, Buffer.concat([header, ...pngs]));

// ICNS: 'icns' + total length, then 4-byte type + length (including these 8) + PNG.
// The tile is inset 100/1024 on each side, as Apple's icon grid asks.
const INSET = (100 / 1024) * 24;
const types = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];
const entries = types.map(([type, size]) => {
  const png = render(size, INSET);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
});
const body = Buffer.concat(entries);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(body.length + 8, 4);
writeFileSync(`${dir}icon.icns`, Buffer.concat([icnsHead, body]));

console.log('wrote icon.png, icon.ico, icon.icns and icons/');
