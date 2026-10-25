import fs from 'node:fs';
import path from 'node:path';

// Fresh data folder for every run (database, uploads, outputs).
export default function globalSetup() {
  const dir = path.resolve('.e2e-data');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
