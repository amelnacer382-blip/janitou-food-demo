import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(__dirname, '..');
const rootDir = resolve(mobileDir, '..');
const webSrc = resolve(rootDir, 'apps/web/src');
const outDir = resolve(mobileDir, 'www');

mkdirSync(resolve(outDir, 'app'), { recursive: true });
mkdirSync(resolve(outDir, 'client'), { recursive: true });

// Copy shared assets and client PWA shell into Capacitor webDir (`www/`)
copyFileSync(resolve(webSrc, 'logo.png'), resolve(outDir, 'logo.png'));
copyFileSync(resolve(webSrc, 'app/i18n.js'), resolve(outDir, 'app/i18n.js'));
copyFileSync(resolve(webSrc, 'app/icon-192.png'), resolve(outDir, 'app/icon-192.png'));
copyFileSync(resolve(webSrc, 'app/icon-512.png'), resolve(outDir, 'app/icon-512.png'));
copyFileSync(resolve(webSrc, 'client/manifest.webmanifest'), resolve(outDir, 'client/manifest.webmanifest'));

let html = readFileSync(resolve(webSrc, 'client/index.html'), 'utf8');
const apiOrigin = (process.env.JANITOU_API_ORIGIN || '').replace(/\/+$/, '');
if (apiOrigin) {
  html = html.replace("const API = '/api/v1/client';", `const API = '${apiOrigin}/api/v1/client';`);
}
writeFileSync(resolve(outDir, 'index.html'), html, 'utf8');
console.log(`Synced /client bundle into ${outDir}${apiOrigin ? ` (API -> ${apiOrigin})` : ''}`);
