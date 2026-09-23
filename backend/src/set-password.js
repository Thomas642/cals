// Definit l'identifiant et le mot de passe de Cals.
//   docker compose exec backend node src/set-password.js <identifiant>
// Le mot de passe est demande deux fois (saisie masquee), ou lu dans CALS_PASSWORD.
import readline from 'node:readline';
import { openDatabase } from './db.js';
import { setCredentials } from './lib/auth.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const username = process.argv[2];
if (!username) {
  console.error('Usage : node src/set-password.js <identifiant>');
  process.exit(1);
}
let password = process.env.CALS_PASSWORD;
if (!password) {
  password = await askHidden('Nouveau mot de passe (8 caracteres minimum) : ');
  const again = await askHidden('Confirmer le mot de passe : ');
  if (password !== again) {
    console.error('Les mots de passe ne correspondent pas.');
    process.exit(1);
  }
}
const db = openDatabase();
try {
  setCredentials(db, username, password);
  console.log(`Identifiants enregistres pour "${username}". Toutes les sessions ont ete deconnectees.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
