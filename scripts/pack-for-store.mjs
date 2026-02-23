#!/usr/bin/env node
/**
 * Builds the extension and creates a ZIP suitable for Chrome Web Store upload.
 * Output: save-link-to-notion.zip (contents of dist/)
 */
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outZip = path.join(rootDir, 'save-link-to-notion.zip');

async function main() {
  try {
    await stat(distDir);
  } catch {
    console.error('Folder "dist" nie istnieje. Uruchom najpierw: npm run build');
    process.exit(1);
  }

  const output = createWriteStream(outZip);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`Utworzono: ${outZip} (${(archive.pointer() / 1024).toFixed(1)} KB)`);
    console.log('Ten plik możesz wgrać w Chrome Developer Dashboard.');
  });

  archive.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });

  archive.pipe(output);
  archive.directory(distDir, false);
  await archive.finalize();
}

main();
