import { pdf } from 'pdf-to-img';
import fs from 'node:fs';
import path from 'node:path';

const src = 'C:/Users/Benedikt/Downloads/UX-sketches-digital.pdf';
const outDir = path.resolve('out');
fs.mkdirSync(outDir, { recursive: true });

const doc = await pdf(src, { scale: 2 });
let i = 0;
for await (const page of doc) {
  i += 1;
  fs.writeFileSync(path.join(outDir, `page-${i}.png`), page);
}
console.log('rendered pages:', i, 'total:', doc.length);
