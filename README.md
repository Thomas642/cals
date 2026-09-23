# Cals

Application web personnelle (mono-utilisateur) de recomposition corporelle : calcul des besoins,
suivi calories/macros, base d'aliments sourcée, assistant IA nutritionnel, recettes, routines
et programme d'entraînement.

La spécification complète est dans [`docs/cals-gdd-v2.md`](docs/cals-gdd-v2.md) (GDD v2).

## Stack

| Couche | Choix |
|---|---|
| Frontend | React 19 (SPA, Vite), servi par nginx |
| Backend | Node.js 22 + Express 5 |
| Base de données | SQLite (`better-sqlite3`), fichier sur volume Docker |
| IA | Google Gemini (`gemini-3.6-flash` par défaut) ou Anthropic Claude (`claude-haiku-4-5`), appelé uniquement par le backend |
| Déploiement | Docker Compose (frontend nginx, backend, volume SQLite, tunnel Cloudflare optionnel) |

## Arborescence

```
backend/
  src/schema.sql          schéma SQLite (section 3 du GDD + routines + journal de charges)
  src/seed-data.js        aliments de l'annexe A
  src/lib/calc.js         moteur de calcul (section 4)
  src/lib/assistant.js    intégration IA Gemini / Claude (section 6)
  src/app.js              routes REST (section 5)
  test/                   tests (node:test)
frontend/
  src/pages/              écrans (section 8)
  src/data/program.js     programme 5 séances (annexe C)
deploy/
  install.sh              première installation sur le VPS
  update.sh / backup.sh   mise à jour, sauvegarde
  nginx/cals.conf         bloc nginx pour gameone-val.com
docs/cals-gdd-v2.md       spécification
```

## Développement local

```bash
# API (port 3000). Base créée dans backend/data/cals.db, seed automatique au premier démarrage.
cd backend && npm install && npm run dev

# Front (port 5173, proxy /api vers le port 3000)
cd frontend && npm install && npm run dev
```

Pour activer l'assistant : `GEMINI_API_KEY=... npm run dev` (ou `ANTHROPIC_API_KEY=...`) côté backend.
Sans clé, l'application reste utilisable ; l'écran Assistant indique qu'il est désactivé (mode dégradé, section 6.5).

Tests backend : `cd backend && npm test`.

## Déploiement sur le VPS (gameone-val.com)

Cals tourne dans ses propres conteneurs (projet Docker Compose `cals`) et n'écoute qu'en local sur
`127.0.0.1:8080`. Il ne touche ni aux autres conteneurs ni aux autres sites nginx du VPS
(dont `famille.gameone-val.com`) : un bloc `server` dédié à `gameone-val.com` est ajouté.

### Prérequis sur le VPS

- Docker + plugin `docker compose`, `git`
- Mode `nginx` : nginx système et Certbot (`sudo apt install nginx certbot python3-certbot-nginx`)
- DNS Cloudflare : enregistrements `gameone-val.com` et `www` vers le VPS (ou vers le tunnel)

### Installation (une seule fois)

Le dépôt est privé : le cloner avec ses identifiants GitHub, puis lancer le script depuis le clone.

```bash
git clone git@github.com:Thomas642/cals.git ~/cals          # clé SSH GitHub sur le VPS
# ou : git clone https://github.com/Thomas642/cals.git ~/cals  (jeton d'accès personnel comme mot de passe)

MODE=nginx bash ~/cals/deploy/install.sh     # nginx système + Certbot
# ou
MODE=tunnel bash ~/cals/deploy/install.sh    # tunnel Cloudflare Zero Trust
```

Le script :
1. clone le dépôt dans `~/cals` (modifiable avec `APP_DIR=...`) ;
2. crée `.env` (demande la clé API Gemini, facultative) ;
3. construit et démarre les conteneurs, puis vérifie `http://127.0.0.1:8080/api/health` ;
4. mode `nginx` : installe `deploy/nginx/cals.conf` dans `/etc/nginx/sites-available/cals`,
   recharge nginx, lance Certbot ;
   mode `tunnel` : affiche le « Public Hostname » à ajouter dans Zero Trust ;
5. demande l'identifiant et le mot de passe de connexion à Cals ;
6. programme la sauvegarde quotidienne (cron, 3 h).

Si le port 8080 est déjà pris sur le VPS : `PORT=8090 MODE=nginx bash install.sh`.

### Connexion

Cals affiche son propre écran de connexion (identifiant + mot de passe). Après connexion, une
session est gardée par cookie sécurisé (`HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS) :
90 jours avec « Rester connecté », sinon jusqu'à la fermeture du navigateur. Le mot de passe est
stocké haché (scrypt). 5 échecs depuis une même IP bloquent les tentatives 15 minutes.

```bash
# définir ou changer l'identifiant et le mot de passe (déconnecte toutes les sessions)
docker compose -f ~/cals/docker-compose.yml exec backend node src/set-password.js <identifiant>
```

### Cloudflare et HTTPS (mode nginx)

- Après Certbot, régler Cloudflare > SSL/TLS sur **Full (strict)**.
- Si Certbot échoue derrière le proxy Cloudflare, passer temporairement les enregistrements DNS
  `gameone-val.com` et `www` en « DNS only » (nuage gris), relancer
  `sudo certbot --nginx -d gameone-val.com -d www.gameone-val.com`, puis les repasser en « Proxied ».

### Mise à jour, sauvegarde

```bash
bash ~/cals/deploy/update.sh    # sauvegarde, git pull, reconstruction, vérification
bash ~/cals/deploy/backup.sh    # sauvegarde manuelle -> ~/cals/backups (30 dernières conservées)
docker compose -f ~/cals/docker-compose.yml logs -f backend   # journaux
```

Un export JSON complet est aussi disponible dans Réglages (`GET /api/export`).

### Ancien dossier FamilyTracker

Ce dépôt contenait auparavant FamilyTracker. Si un clone de ce dépôt sert encore un site sur le VPS
(l'ancienne configuration utilisait `/home/ubuntu/FamilyTracker`), **ne pas y faire de `git pull`** :
il récupérerait Cals à la place de l'ancien code. Cals s'installe dans un dossier séparé (`~/cals`).

## Assistant IA : Gemini ou Claude

Le fournisseur est choisi selon la clé présente dans `.env` (Gemini prioritaire), ou forcé avec
`AI_PROVIDER=gemini|anthropic`. Sans clé, l'assistant est désactivé et le reste de l'app fonctionne.

- **Gemini** (défaut) : clé à créer sur Google AI Studio (https://aistudio.google.com, « Get API key »).
  Modèle par défaut `gemini-3.6-flash`, modifiable avec `GEMINI_MODEL`. Le 23/09/2026, l'API a
  répondu pour `gemini-2.5-flash` : « no longer available to new users », en recommandant
  `gemini-3.6-flash`. Liste des modèles accessibles avec sa clé :
  `curl -s "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=$KEY"`.
  Si Google renvoie une erreur temporaire (500/502/503/504) 2 fois de suite, ou si le modèle est
  introuvable (404), l'assistant essaie les modèles de `GEMINI_FALLBACK_MODELS`
  (défaut `gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash`). Le 23/09/2026, `gemini-3.6-flash`, `gemini-3.7-flash` et
  `gemini-3.8-flash` ont renvoyé 503 « high demand » en niveau gratuit.
  D'après la page de tarifs Gemini consultée le 23/09/2026, ce modèle figure dans le niveau gratuit, et
  pour ce niveau : « Content used to improve our products » (contenu utilisé par Google pour améliorer
  ses produits) ; en niveau payant : « Content not used to improve our products ». Les questions
  envoyées contiennent le profil (sexe, âge, poids, cibles) et le journal du jour.
  Les quotas du niveau gratuit sont limités ; en cas de dépassement l'assistant affiche
  « Quota Gemini atteint » et la saisie manuelle reste disponible.
- **Claude** : clé sur https://console.anthropic.com, modèle `claude-haiku-4-5` (`CLAUDE_MODEL`).

Ajouter ou changer la clé après installation :

```bash
nano ~/cals/.env                                  # GEMINI_API_KEY=...
docker compose -f ~/cals/docker-compose.yml up -d
```

## API

Routes du GDD (section 5) : `/api/profile`, `/api/foods`, `/api/journal`, `/api/recipes`, `/api/weights`, `/api/assistant`.

Routes ajoutées pour les phases 1, 3 et 4 :

| Méthode | Route | Rôle |
|---|---|---|
| GET | /api/health | État de l'API et de l'IA |
| GET | /api/stats?end= | Totaux journaliers 30 j, adhérence 7/30 j, poids + moyenne glissante 7 j |
| DELETE | /api/weights/:id | Supprimer une mesure |
| GET | /api/recipes/:id | Détail d'une recette |
| POST | /api/recipes/:id/log | Ajouter une recette au journal (valeurs par portion figées) |
| GET/POST/DELETE | /api/routines | Routines réutilisables (créées depuis les entrées d'un jour) |
| POST | /api/routines/:id/log | Appliquer une routine à une date |
| GET/POST/DELETE | /api/workouts | Journal de charges |
| GET | /api/export | Export JSON de toutes les tables |

`POST /api/journal` accepte soit `{ date, food_id, quantity }` (valeurs calculées depuis la base),
soit une entrée complète (`display_name, quantity, unit, kcal, protein_g, …, origin`). Les deux passent
la même validation (types, bornes, cohérence unité/quantité), y compris les entrées proposées par l'IA.

## Choix d'implémentation

Paramètres que le GDD donne sous forme de fourchette, fixés ici (modifiables dans `backend/src/lib/calc.js`) :

| Paramètre | Fourchette GDD | Valeur retenue |
|---|---|---|
| Surplus `gain` | 5 à 15 % | light 5 %, moderate 10 %, aggressive 15 % |
| Protéines `fat_loss` | 2,0 à 2,2 g/kg | 2,2 g/kg |
| Protéines `maintain` / `gain` | 1,6 à 2,2 g/kg | 1,8 g/kg |
| Lipides | 0,8 à 1 g/kg | 0,8 g/kg |
| Glucides | reste des calories | (kcal − 4 × P − 9 × L) / 4 |

Autres décisions :

- **Données de l'annexe A** : l'annexe ne fournit ni glucides ni lipides ; ces champs sont laissés vides
  (aucune valeur inventée). Les jauges glucides/lipides indiquent le nombre d'entrées sans valeur.
  Pain de mie et cancoillotte sont marqués « estimé » (protéines estimées selon l'annexe).
- **Valeurs figées** : une entrée de journal copie ses valeurs à la saisie ; modifier ou supprimer
  l'aliment de référence ne la change pas.
- **Cibles manuelles** : colonne `manual_targets` ajoutée à `profile` ; quand elle est active, les
  changements de poids ne recalculent plus les cibles. Plancher de validation : 1000 kcal.
- **Poids** : une mesure par jour ; la plus récente devient le poids du profil et déclenche le recalcul.
- **Adhérence** : calculée sur les jours comportant au moins une entrée.
- **Assistant** : prompt système de la section 6.4 repris tel quel ; contrat JSON de la section 6.3
  imposé par les sorties structurées (Gemini : `responseJsonSchema` ; Claude : `output_config.format`)
  puis revalidé côté serveur ; les
  propositions invalides sont rejetées et signalées. L'historique de conversation (10 derniers
  messages) est renvoyé par le front à chaque appel.
- **Prompt caching (Claude uniquement)** : `cache_control` est posé sur le bloc « prompt système + base d'aliments ».
  D'après la documentation Anthropic, le préfixe minimal cachable pour Claude Haiku 4.5 est de
  4096 tokens : avec la base de 19 aliments le préfixe est plus court et le cache ne s'active pas ;
  il s'activera quand la base aura grossi. Vérifiable via `usage.cache_read_input_tokens` dans la
  réponse de `/api/assistant`.
- Tarifs, quotas gratuits et noms de modèles évoluent : vérifier https://ai.google.dev/gemini-api/docs/pricing
  et https://claude.com/pricing avant mise en production.
