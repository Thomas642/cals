# Cals - Document de conception et de build (GDD v2)

Version 2.0 - Specification prete pour implementation
Document destine a un agent de developpement (Claude Code). Les choix techniques sont verrouilles. Application web personnelle mono-utilisateur de recomposition corporelle : calcul des besoins, suivi calories/macros, base d'aliments sourcee, assistant IA nutritionnel, recettes et programme d'entrainement.

---

## 0. Decisions verrouillees

| Sujet | Decision |
|---|---|
| Nombre d'utilisateurs | Mono-profil (usage personnel unique) |
| Base de donnees | SQLite |
| Fournisseur IA | API Anthropic (Claude) |
| Modele IA | Claude Haiku 4.5 (`claude-haiku-4-5`) |
| Facturation IA | Pay-as-you-go, cle d'API cote backend uniquement, distincte de tout abonnement |
| Hebergement | Auto-heberge sur VPS (Docker Compose, reverse proxy, tunnel Cloudflare Zero Trust) |
| Langue de l'application et de l'IA | Francais |

Hors perimetre (non demande) : multi-profils, authentification multi-comptes, application mobile native. L'architecture ne doit pas empecher un passage multi-profils ulterieur, mais ne l'implemente pas.

---

## 1. Vision et principe directeur

Cals centralise le pilotage d'une recomposition corporelle : calcul des besoins journaliers, saisie et suivi des apports (calories et macros), reference nutritionnelle fiable, assistant IA et idees de recettes.

Principe non negociable : **rigueur des donnees**. Toute valeur nutritionnelle affichee est soit issue d'une base de reference (CIQUAL ANSES, USDA FoodData Central, etiquette produit), soit explicitement marquee comme estimee. L'IA ne fabrique jamais de valeur non sourcee ; en cas d'incertitude elle le declare.

---

## 2. Perimetre fonctionnel

### 2.1 Onboarding et calcul des besoins
Saisie a la premiere ouverture : prenom ou nom d'utilisateur, sexe, date de naissance (ou age), taille (cm), poids actuel (kg), niveau d'activite, objectif (perte de gras / maintien / prise de masse) et intensite.
Sortie calculee : BMR, TDEE, cible calorique, cible proteique, repartition glucides/lipides optionnelle. Moteur en section 4.

### 2.2 Suivi journalier
Journal par date, navigation jour par jour. Ajout depuis la base (recherche + quantite) ou saisie libre. Jauges calories et proteines avec restant et depassement. Glucides et lipides prevus (macros completes). Sauvegarde persistante. Les valeurs d'une entree sont figees a la saisie et ne changent pas retroactivement si l'aliment de reference est corrige.

### 2.3 Base d'aliments
Aliments pre-charges sourcees (annexe A). Champs : nom, kcal, proteines, glucides, lipides, unite (100 g ou unite), source, indicateur estime. CRUD des aliments perso. Recherche texte. Distinction visuelle sourcee / estimee.

### 2.4 Assistant IA
Repond aux questions macros en langage naturel, estime un aliment absent de la base et propose de l'ajouter (valeur marquee estimee), aide a atteindre les cibles, convertit les poids bruts/nets. Contrat et garde-fous en section 6.

### 2.5 Recettes et routines
Bibliotheque de recettes (ingredients references + quantites, calcul auto des macros par portion, etapes, tags). Creation perso. Ajout au journal en une action. Idees generees par l'IA selon le restant du jour. Routines reutilisables.

### 2.6 Statistiques
Courbe de poids, adherence aux cibles (ecart moyen calories et proteines sur 7 et 30 jours), moyennes glissantes.

### 2.7 Programme d'entrainement
Consultation du split 5 seances (annexe C), par jour, series/reps, notes. Extension possible : journal de charges.

---

## 3. Modele de donnees (SQLite)

Schema DDL de reference. Un seul profil (contrainte applicative : une seule ligne dans `profile`).

```sql
CREATE TABLE profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  username        TEXT NOT NULL,
  sex             TEXT NOT NULL CHECK (sex IN ('M','F')),
  birth_date      TEXT,                 -- ISO YYYY-MM-DD
  height_cm       REAL NOT NULL,
  weight_kg       REAL NOT NULL,        -- poids courant
  activity_level  TEXT NOT NULL,        -- sedentary|light|moderate|intense|very_intense
  goal            TEXT NOT NULL,        -- fat_loss|maintain|gain
  goal_intensity  TEXT,                 -- light|moderate|aggressive
  target_kcal     INTEGER,              -- calcule
  target_protein_g INTEGER,             -- calcule
  target_carbs_g  INTEGER,              -- optionnel
  target_fat_g    INTEGER,              -- optionnel
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE weight_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  weight_kg  REAL NOT NULL
);

CREATE TABLE food (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kcal        REAL NOT NULL,            -- par unite de reference
  protein_g   REAL NOT NULL DEFAULT 0,
  carbs_g     REAL,
  fat_g       REAL,
  ref_unit    TEXT NOT NULL CHECK (ref_unit IN ('100g','unit')),
  source      TEXT,
  is_estimate INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE journal_entry (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,           -- YYYY-MM-DD
  food_id      INTEGER,                 -- NULL si saisie libre
  display_name TEXT NOT NULL,
  quantity     REAL NOT NULL,
  unit         TEXT NOT NULL,           -- g | unit
  kcal         REAL NOT NULL,           -- fige a la saisie
  protein_g    REAL NOT NULL DEFAULT 0,
  carbs_g      REAL,
  fat_g        REAL,
  origin       TEXT NOT NULL,           -- base|free|recipe|ia
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (food_id) REFERENCES food(id) ON DELETE SET NULL
);

CREATE TABLE recipe (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  servings     INTEGER NOT NULL DEFAULT 1,
  steps        TEXT,                    -- markdown ou texte
  tags         TEXT                     -- CSV ou JSON
);

CREATE TABLE recipe_ingredient (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL,
  food_id    INTEGER NOT NULL,
  quantity   REAL NOT NULL,
  unit       TEXT NOT NULL,             -- g | unit
  FOREIGN KEY (recipe_id) REFERENCES recipe(id) ON DELETE CASCADE,
  FOREIGN KEY (food_id)   REFERENCES food(id)   ON DELETE RESTRICT
);

CREATE INDEX idx_journal_date ON journal_entry(date);
CREATE INDEX idx_weight_date  ON weight_log(date);
```

Le programme d'entrainement (annexe C) peut etre stocke en dur cote front (contenu statique) ou en table dediee si un journal de charges est ajoute plus tard.

---

## 4. Moteur de calcul

### 4.1 BMR - Mifflin-St Jeor
- Homme : BMR = (10 x poids_kg) + (6,25 x taille_cm) - (5 x age) + 5
- Femme : BMR = (10 x poids_kg) + (6,25 x taille_cm) - (5 x age) - 161

### 4.2 TDEE
TDEE = BMR x facteur d'activite.

| Niveau (code) | Facteur |
|---|---|
| sedentary | 1,2 |
| light | 1,375 |
| moderate | 1,55 |
| intense | 1,725 |
| very_intense | 1,9 |

### 4.3 Cible calorique
- fat_loss : deficit 10 a 20 % sous le TDEE (light 10 %, moderate 15 %, aggressive 20 %).
- maintain : TDEE.
- gain : surplus 5 a 15 % au-dessus du TDEE.

### 4.4 Cible proteique
- 1,6 a 2,2 g/kg. En fat_loss ou recomposition : viser 2,0 a 2,2 g/kg.

### 4.5 Repartition optionnelle
- Lipides : 0,8 a 1 g/kg minimum. Glucides : reste des calories.

### 4.6 Recalcul
Les cibles sont recalculees a chaque modification du poids ou de l'objectif. L'utilisateur peut aussi forcer des cibles manuelles (elles priment alors sur le calcul).

---

## 5. API backend (REST)

Format JSON. La cle d'API Claude n'est jamais exposee au front ; seul le backend appelle api.anthropic.com.

| Methode | Route | Role |
|---|---|---|
| GET | /api/profile | Recuperer le profil et les cibles |
| PUT | /api/profile | Mettre a jour le profil ; recalcule les cibles |
| GET | /api/foods?q= | Lister / rechercher les aliments |
| POST | /api/foods | Creer un aliment perso |
| PUT | /api/foods/:id | Editer un aliment |
| DELETE | /api/foods/:id | Supprimer un aliment |
| GET | /api/journal?date=YYYY-MM-DD | Entrees du jour |
| POST | /api/journal | Ajouter une entree |
| DELETE | /api/journal/:id | Supprimer une entree |
| GET | /api/recipes | Lister les recettes |
| POST | /api/recipes | Creer une recette |
| PUT | /api/recipes/:id | Editer une recette |
| DELETE | /api/recipes/:id | Supprimer une recette |
| GET | /api/weights | Historique de poids |
| POST | /api/weights | Ajouter une mesure de poids |
| POST | /api/assistant | Poser une question a l'IA (voir section 6) |

Validation obligatoire cote backend : toute entree de journal issue de l'IA passe la meme validation qu'une saisie manuelle (types, bornes, coherence unite/quantite) avant insertion.

---

## 6. Integration IA (Claude Haiku 4.5)

### 6.1 Flux
Front -> POST /api/assistant -> backend assemble le contexte -> appel api.anthropic.com (modele `claude-haiku-4-5`, endpoint https://api.anthropic.com/v1/messages) -> reponse JSON validee -> retour au front.

Optimisations cout : activer le prompt caching sur le prompt systeme et la base d'aliments (input repete). Pas de Batch API (usage temps reel).

### 6.2 Contexte transmis a chaque appel
- Profil : sexe, age, poids, cibles kcal et proteines.
- Restant du jour : kcal et proteines restantes.
- Base d'aliments pertinente (nom, valeurs, unite, source) ou sous-ensemble filtre par la requete.

### 6.3 Contrat de sortie
L'assistant repond toujours par un objet JSON unique :

```json
{
  "answer": "texte en francais pour l'utilisateur",
  "proposed_entries": [
    {
      "aliment": "Oeuf dur",
      "quantite": 2,
      "unite": "unit",
      "kcal": 144,
      "proteines_g": 12.6,
      "source": "CIQUAL",
      "est_estime": false
    }
  ],
  "confidence": "haute"
}
```

`proposed_entries` est vide si la reponse n'implique pas d'ajout. Le backend parse et valide ce JSON avant tout affichage d'action d'ajout. Toute valeur avec `est_estime = true` est affichee comme estimee dans l'interface.

### 6.4 Prompt systeme (a utiliser tel quel)

```
Tu es l'assistant nutritionnel de l'application Cals. Tu aides un utilisateur unique
a suivre ses calories et ses macros pour une recomposition corporelle.

REGLES DE DONNEES (prioritaires) :
- Ta source de verite est la base d'aliments fournie dans le contexte. Utilise-la en priorite.
- Toute valeur nutritionnelle que tu fournis vient soit d'une base citee (base Cals,
  CIQUAL ANSES, USDA FoodData Central, etiquette produit), soit est marquee comme estimee
  (est_estime = true).
- N'invente jamais une valeur non sourcee. Si tu n'as pas de donnee fiable, dis-le
  clairement dans "answer" et mets proposed_entries a vide.
- Signale les facteurs qui font varier une valeur quand l'impact est notable
  (cuisson, variete, poids brut ou net).

FORMAT :
- Reponds toujours par un unique objet JSON valide conforme au schema fourni :
  { "answer": string, "proposed_entries": array, "confidence": "haute"|"moyenne"|"faible" }.
- "answer" est en francais, concis et direct.
- Remplis proposed_entries uniquement quand l'utilisateur veut enregistrer un ou
  plusieurs aliments.
- Si une quantite manque pour un calcul, ne devine pas : demande-la dans "answer".

PERIMETRE :
- Reste sur le calcul et le suivi nutritionnel.
- Ne donne aucun avis medical ni diagnostic. Pour toute demande de sante personnalisee,
  invite a consulter un professionnel.
- N'encourage aucun comportement a risque (restriction extreme, objectif de poids
  dangereux). Si une demande va dans ce sens, refuse la partie concernee et reste factuel.

CONTEXTE (fourni a chaque appel) : profil et cibles de l'utilisateur, restant du jour,
base d'aliments pertinente.
```

### 6.5 Mode degrade
L'application reste pleinement utilisable sans IA (saisie manuelle depuis la base). En cas d'erreur ou d'indisponibilite de l'API, le front l'indique et bascule sur la saisie manuelle.

---

## 7. Architecture technique

| Couche | Choix |
|---|---|
| Frontend | React (SPA) |
| Backend / API | Node.js (Express) ou Python (FastAPI) |
| Base de donnees | SQLite (fichier persiste sur volume Docker) |
| IA | API Anthropic, modele `claude-haiku-4-5`, appel cote backend |
| Deploiement | Docker Compose (services front, backend, volume SQLite) |
| Exposition | Reverse proxy + tunnel Cloudflare Zero Trust |
| Supervision | Integration possible a une stack Prometheus/Grafana/Loki existante |

Contraintes :
- Cle d'API Claude en variable d'environnement cote backend, jamais dans le front ni dans le depot.
- Sauvegarde reguliere du fichier SQLite (journal et recettes = la vraie valeur).
- Seed initial de la table food via un script a partir de l'annexe A.
- Un seul profil : contrainte applicative et CHECK (id = 1) sur la table profile.

---

## 8. Ecrans

1. Onboarding (mesures + objectif) et ecran de resultats (cibles).
2. Journal du jour (jauges + repas + ajout).
3. Base d'aliments (recherche, CRUD perso).
4. Assistant IA (conversation + actions d'ajout).
5. Recettes (liste, detail, creation).
6. Statistiques (courbe de poids, adherence).
7. Programme d'entrainement (consultation par jour).
8. Reglages (cibles manuelles, objectif, recalcul, export/sauvegarde).

---

## 9. Roadmap par phases

**Phase 0 - MVP**
Onboarding + moteur de calcul. Journal calories + proteines. Base d'aliments seed + CRUD perso. Persistance SQLite. Pas d'IA.

**Phase 1 - Macros et statistiques**
Glucides/lipides. Historique de poids + courbe. Adherence 7/30 jours. Recalcul auto des cibles.

**Phase 2 - Assistant IA**
Endpoint /api/assistant avec Claude Haiku 4.5, prompt systeme et contrat JSON. Questions macros, estimation d'aliments, aide aux cibles. Validation stricte avant enregistrement.

**Phase 3 - Recettes et routines**
Recettes avec calcul par portion, ajout au journal, generation d'idees par IA, routines reutilisables.

**Phase 4 - Entrainement**
Integration du split (annexe C) et journal de charges.

---

## 10. Risques et limites
- Precision des estimations : valeurs de composition variables selon variete, cuisson, portion. A presenter comme reperes.
- Hallucination IA : maitrisee par le sourcing obligatoire, la priorite a la base et la validation backend.
- Perimetre non medical : disclaimer sur les ecrans de cibles et d'assistant ; pas de diagnostic.
- Tarifs et noms de modeles IA evolutifs : verifier claude.com/pricing a l'implementation.

---

## Annexe A - Aliments de reference (seed)

Valeurs par 100 g sauf mention unite. Proteines marquees (estimee) a verifier sur etiquette.

| Aliment | kcal | Proteines | Unite | Source |
|---|---|---|---|---|
| Aiguillettes Le Gaulois | 97 | 22 | 100g | Fiche Carrefour |
| Cuisse poulet (viande + peau, crue) | 188 | 17 | 100g | CIQUAL |
| Cuisse poulet cuite (viande + peau) | 232 | 26 | 100g | CIQUAL (rotie) |
| Blanc de poulet cru | 112 | 23 | 100g | CIQUAL |
| Riz blanc cru | 350 | 7 | 100g | CIQUAL |
| Pates crues | 350 | 12 | 100g | CIQUAL |
| Pomme de terre crue | 80 | 2 | 100g | CIQUAL |
| Panes tomate mozza Vege | 227 | 11 | 100g | Fiche produit (OFF) |
| Barre Nature Valley Proteine caramel sale | 198 | 10,4 | unit (40 g) | Fiche Carrefour |
| Skyr Siggi's Cereales Miel & Noix | 93 | 9 | 100g | Emballage |
| Skyr nature 0 % | 57 | 10 | 100g | Fiche produit |
| Banane (pulpe) | 90,5 | 1,1 | 100g | CIQUAL 2020 |
| Banane entiere (poids non pele) | 58 | 0,7 | 100g | CIQUAL 2020 (~64 % pulpe) |
| Huile d'olive vierge | 899 | 0 | 100g | CIQUAL |
| Oeuf dur | 72 | 6,3 | unit (~50 g) | CIQUAL |
| Thon au naturel (egoutte) | 105 | 26 | 100g | CIQUAL |
| Pain de mie | 251 | 8 (estimee) | 100g | Emballage |
| Cancoillotte a la noix | 161 | 13 (estimee) | 100g | fatsecret |
| Gnocchi au fromage | 196 | 6,1 | 100g | Emballage |

## Annexe B - Formules

- BMR homme : (10 x poids_kg) + (6,25 x taille_cm) - (5 x age) + 5
- BMR femme : (10 x poids_kg) + (6,25 x taille_cm) - (5 x age) - 161
- TDEE : BMR x facteur (1,2 / 1,375 / 1,55 / 1,725 / 1,9)
- Deficit fat_loss : 10 a 20 % sous TDEE
- Surplus gain : 5 a 15 % au-dessus TDEE
- Proteines : 1,6 a 2,2 g/kg (haut de fourchette en deficit)
- Lipides : 0,8 a 1 g/kg minimum ; Glucides : reste des calories

## Annexe C - Programme d'entrainement (5 seances)

Materiel : alteres, poids du corps, appui stable (chaise/banc). Frequence : chaque muscle 2 fois/semaine, ne pas enchainer J1 et J4.

- J1 Jambes + abdos : squat 4x10, fentes 3x10/jambe, step-up 3x10/jambe, mollets 3x15-20, abdos simples 3x25, genoux vers coudes 3x25.
- J2 Epaules + biceps : developpe epaules 4x8, elevations frontales 4x8, tirage menton 4x8, curl simple 4x8, curl marteau 4x8.
- J3 Dos + pecs + abdos : rowing alteres penche 4x8-10, tractions ou rowing australien 3xmax, pompes 4x15, touchers de talons 3x25, rotations dos droit 3x25.
- J4 Jambes + abdos : squat 4x10, fentes bulgares 3x8/jambe, step-up 3x10/jambe, mollets 3x15-20, abdos simples 3x25, rotations obliques 3x25.
- J5 Haut complet : developpe epaules 4x8, rowing alteres penche 4x8, pompes 4x15, curl simple 3x10, curl marteau 3x10, elevations frontales 3x12.

Reflexe transverse : surcharge progressive (augmenter charge ou reps au fil des semaines).

---

Fin du document.
