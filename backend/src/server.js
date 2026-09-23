import { openDatabase, seedFoods } from './db.js';
import { createApp } from './app.js';

const db = openDatabase();
const seeded = seedFoods(db);
if (seeded) console.log(`Seed initial : ${seeded} aliments`);

const port = Number(process.env.PORT) || 3000;
const server = createApp(db).listen(port, () => {
  console.log(`Cals API sur le port ${port} (IA ${process.env.ANTHROPIC_API_KEY ? 'active' : 'desactivee'})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
