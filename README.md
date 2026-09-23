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
| IA | API Anthropic, modèle `claude-haiku-4-5`, appelé uniquement par le backend |
| Déploiement | Docker Compose (frontend nginx, backend, volume SQLite, tunnel Cloudflare optionnel) |

## Arborescence

```
backend/
  src/schema.sql          schéma SQLite (section 3 du GDD + routines + journal de charges)
  src/seed-data.js        aliments de l'annexe A
  src/lib/calc.js         moteur de calcul (section 4)
  src/lib/assistant.js    intégration Claude (section 6)
  src/app.js              routes REST (section 5)
  test/                   tests (node:test)
frontend/
  src/pages/              écrans (section 8)
  src/data/program.js     programme 5 séances (annexe C)
docs/cals-gdd-v2.md       spécification
```

## Développement local

```bash
# API (port 3000). Base créée dans backend/data/cals.db, seed automatique au premier démarrage.
cd backend && npm install && npm run dev

# Front (port 5173, proxy /api vers le port 3000)
cd frontend && npm install && npm run dev
```

Pour activer l'assistant : `ANTHROPIC_API_KEY=... npm run dev` côté backend.
Sans clé, l'application reste utilisable ; l'écran Assistant indique qu'il est désactivé (mode dégradé, section 6.5).

Tests backend : `cd backend && npm test`.

## Déploiement (VPS)

```bash
cp .env.example .env        # renseigner ANTHROPIC_API_KEY (et CLOUDFLARE_TUNNEL_TOKEN si tunnel)
docker compose up -d --build
# avec le tunnel Cloudflare Zero Trust :
docker compose --profile tunnel up -d --build
```

- Le frontend écoute sur `127.0.0.1:${CALS_HTTP_PORT}` (8080 par défaut), à placer derrière le reverse proxy.
- Avec le profil `tunnel`, configurer dans Zero Trust le hostname public vers `http://frontend:80`.
- La clé API n'est lue que par le service `backend` ; elle n'est jamais envoyée au navigateur ni versionnée.

### Sauvegarde

Le journal et les recettes sont stockés dans le volume `cals-data` (`/data/cals.db`).

```bash
# sauvegarde à chaud du fichier SQLite dans le volume
docker compose exec backend node src/backup.js /data/backups
# copie hors du conteneur
docker compose cp backend:/data/backups ./backups
```

À planifier via cron sur l'hôte. Un export JSON complet est aussi disponible dans Réglages (`GET /api/export`).

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
| Protéines `fat_loss` | 2,0 à 2,2 g/kg | 2,0 g/kg |
| Protéines `maintain` / `gain` | 1,6 à 2,2 g/kg | 1,8 g/kg |
| Lipides | 0,8 à 1 g/kg | 0,9 g/kg |
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
  imposé par les sorties structurées (`output_config.format`) puis revalidé côté serveur ; les
  propositions invalides sont rejetées et signalées. L'historique de conversation (10 derniers
  messages) est renvoyé par le front à chaque appel.
- **Prompt caching** : `cache_control` est posé sur le bloc « prompt système + base d'aliments ».
  D'après la documentation Anthropic, le préfixe minimal cachable pour Claude Haiku 4.5 est de
  4096 tokens : avec la base de 19 aliments le préfixe est plus court et le cache ne s'active pas ;
  il s'activera quand la base aura grossi. Vérifiable via `usage.cache_read_input_tokens` dans la
  réponse de `/api/assistant`.
- Tarifs et noms de modèles évoluent : vérifier claude.com/pricing avant mise en production.
