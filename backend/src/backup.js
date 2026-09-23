// Sauvegarde a chaud du fichier SQLite : node src/backup.js [dossier]
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from './db.js';

const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `cals-${stamp}.db`);
const db = openDatabase();
await db.backup(target);
db.close();
console.log(`Sauvegarde ecrite : ${target}`);
