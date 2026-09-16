import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'src','branding.ts'),'utf8');
const match=source.match(/data:image\/webp;base64,([^']+)/);
if(!match)throw new Error('No se pudo extraer ZENVIA_LOGO de src/branding.ts');

const base64=match[1];
const publicDir=path.join(root,'public');
await mkdir(publicDir,{recursive:true});
await writeFile(path.join(publicDir,'zenvia-app-icon.webp'),Buffer.from(base64,'base64'));

const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#ffffff"/>
  <image href="data:image/webp;base64,${base64}" x="32" y="96" width="448" height="320" preserveAspectRatio="xMidYMid meet"/>
</svg>\n`;
await writeFile(path.join(publicDir,'zenvia-app-icon.svg'),svg,'utf8');
