import { openDatabase, seedFoods } from './db.js';

const db = openDatabase();
const n = seedFoods(db);
console.log(n > 0 ? `${n} aliments inseres.` : 'Table food deja remplie : aucun ajout.');
db.close();
