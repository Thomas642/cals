import { openDatabase } from './db.js';
import { createApp } from './app.js';

const db = openDatabase();
const port = Number(process.env.PORT) || 3000;
const app = createApp(db);
app.locals.processor.resume();
const server = app.listen(port, () => {
  console.log(`API Animes sur le port ${port} (medias : ${process.env.MEDIA_DIR || 'data/media'})`);
});
// Les envois de morceaux et la lecture de longues videos ne doivent pas etre coupes par les delais par defaut.
server.requestTimeout = 0;

process.on('unhandledRejection', (err) => console.error('[process] promesse rejetee non geree :', err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
