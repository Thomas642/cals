import { openDatabase, seedFoods } from './db.js';
import { createApp } from './app.js';
import { resolveModel, resolveProvider } from './lib/assistant.js';

const db = openDatabase();
const seeded = seedFoods(db);
if (seeded) console.log(`Seed initial : ${seeded} aliments`);

const port = Number(process.env.PORT) || 3000;
const server = createApp(db).listen(port, () => {
  const provider = resolveProvider();
  console.log(`Cals API sur le port ${port} (IA : ${provider ? `${provider} / ${resolveModel(provider)}` : 'desactivee'})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
