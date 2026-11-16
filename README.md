# Animés

Site web privé pour regarder en famille des épisodes d'anime avec sous-titres français.
On crée une série, on y importe les vidéos des épisodes, puis les fichiers de sous-titres.
Le lecteur affiche les sous-titres, mémorise la position de lecture (par navigateur), marque les épisodes vus,
propose l'épisode suivant, et l'accueil affiche une rangée « Continuer à regarder ».

Ce dépôt contenait auparavant l'application nutrition « Cals ». Le code a été remplacé ; l'infrastructure
(Docker Compose, nginx, tunnel Cloudflare, écran de connexion, scripts de déploiement) est conservée.

## Stack

| Couche | Choix |
|---|---|
| Frontend | React 19 (SPA, Vite), servi par nginx |
| Backend | Node.js 22 + Express 5 |
| Base de données | SQLite (`better-sqlite3`) : séries, épisodes, pistes de sous-titres, identifiants |
| Fichiers | Vidéos et sous-titres sur le volume Docker `cals-data` (`/data/media`) |
| Déploiement | Docker Compose (frontend nginx, backend, tunnel Cloudflare optionnel) |

## Arborescence

```
backend/
  src/schema.sql          tables series, episode, subtitle, auth_user, auth_session
  src/app.js              routes REST, envoi des vidéos par morceaux, lecture (Range)
  src/lib/subtitles.js    conversion SRT / ASS / SSA -> WebVTT
  src/lib/auth.js         connexion (mot de passe scrypt, session par cookie)
  test/                   tests (node:test)
frontend/
  src/pages/              Bibliothèque, Série (import), Regarder (lecteur)
  src/uploads.js          file d'envoi : morceaux de 16 Mo, reprise automatique
  src/files.js            numéro d'épisode deviné depuis le nom du fichier, encodage des sous-titres
deploy/                   installation, mise à jour, sauvegarde, bloc nginx hôte
```

## Utilisation

Les outils d'import et d'édition n'apparaissent qu'avec le bouton **Gérer** (en haut à droite) ; sans lui, le site
reste en mode visionnage, sans boutons de suppression. Le choix est mémorisé dans chaque navigateur.

1. **Gérer > Nouvelle série** : donner un titre.
2. Sur la page de la série, **glisser les vidéos** dans la zone d'import (ou cliquer pour les choisir).
   Un épisode est créé par fichier et l'envoi démarre. On peut changer de page pendant l'envoi
   (panneau en bas à droite) ; fermer l'onglet l'interrompt.
3. **Sous-titres** : glisser les fichiers dans la même zone, ou utiliser le bouton « + Sous-titres » d'un épisode.
   Plusieurs pistes par épisode sont possibles (ex. français et anglais).

**Numéro d'épisode** : il est lu dans le nom du fichier, par exemple `[Groupe] Titre - 03 [1080p].mkv`,
`Titre S01E03.mp4`, `Titre 第3話.mp4`, `Titre_03_VOSTFR.mkv` → épisode 3. Un sous-titre `Titre - 03.srt` est
rattaché à l'épisode 3. Si aucun numéro n'est trouvé, la vidéo prend le numéro suivant ; le numéro et le titre
se modifient avec le crayon.

**Affiche et miniatures** : chaque épisode reçoit une miniature, capturée par le navigateur à 25 % de la vidéo
au moment de l'import (ou à la première visite de la série pour les épisodes déjà en ligne). Si le navigateur ne
sait pas décoder la vidéo, l'épisode garde une vignette colorée. L'affiche de la série est l'image choisie avec
« Choisir une affiche » (JPEG, PNG ou WebP, 8 Mo maximum), sinon la miniature du premier épisode.

**Langue de la piste** : lue dans le dernier mot du nom (`ep01.fr.srt`, `ep01_eng.ass`, `ep01.ja.srt`) ; français
par défaut. Un « JP » ailleurs dans le nom (`ARC 01 - EP 1 - JP.srt`) est ignoré.

### Formats

| Type | Formats acceptés | Remarques |
|---|---|---|
| Vidéo | mp4, m4v, webm, mkv, mov | Le navigateur lit la vidéo telle quelle (pas de conversion sur le serveur). **MP4 avec vidéo H.264 et son AAC** est le format le plus compatible. Les MKV et les vidéos HEVC/H.265 ne sont pas lus par tous les navigateurs : le lecteur affiche un message dans ce cas. |
| Sous-titres | srt, vtt, ass, ssa | Convertis en WebVTT à l'import. Pour ASS/SSA, seul le texte est gardé (styles, positions et effets ignorés). Encodages lus : UTF-8, UTF-16, et Windows-1252 en repli (anciens SRT français). |

### Conversion automatique (ffmpeg)

Après chaque envoi, le serveur analyse la vidéo avec ffmpeg (installé dans l'image du backend) :

- **Vidéo illisible par les navigateurs** (HEVC/H.265, H.264 10 bits, AV1, MPEG-4…) : conversion en MP4
  H.264 8 bits + AAC. Symptôme avant conversion : le son est lu mais l'image reste noire.
- **Seuls le conteneur ou l'audio posent problème** (MKV, audio FLAC/AC3/DTS, piste japonaise pas en premier) :
  les flux sont recopiés dans un MP4, sans réencoder la vidéo (rapide).
- **Miniature** : une image extraite à 25 % de la durée, même si le navigateur ne sait pas lire la vidéo.
- **Sous-titres texte intégrés** (ASS, SRT… dans un MKV) : ajoutés comme pistes « (intégré) ». Les sous-titres
  en image (PGS, VobSub) ne sont pas extraits.

Une vidéo à la fois, en priorité basse (`nice`) pour garder le site réactif. La durée dépend du processeur du
serveur et de la vidéo ; la progression s'affiche sur l'épisode et dans le lecteur, qui se recharge tout seul à la
fin. L'original est remplacé par la version convertie. Au démarrage, les épisodes jamais analysés (ceux importés
avant cette fonction) sont mis en file automatiquement. Réglages dans `.env` : `VIDEO_PROCESSING=off` désactive,
`X264_PRESET` / `X264_CRF` règlent la conversion. La conversion demande de l'espace libre : environ 1,6 fois la
taille du fichier.

**Langue d'une piste** : en mode Gérer, le petit sélecteur (FR / EN / JA) sur la piste la corrige.

### Envoi des vidéos

Les vidéos partent par morceaux (`PUT /api/episodes/:id/upload?offset=`) de 2 à 16 Mo : la taille s'adapte au
débit mesuré pour qu'un morceau dure une vingtaine de secondes. Après une coupure réseau, l'envoi reprend tout
seul à partir du dernier octet reçu (10 essais). Un morceau sans aucune progression pendant 45 s est relancé ;
côté serveur, un morceau sans octet reçu pendant 60 s est fermé, et un nouveau morceau ferme le précédent resté
ouvert. Si l'onglet a été fermé, l'épisode affiche « Envoi incomplet » : réimporter le même fichier (même nom,
même taille) dans la zone d'import, ou cliquer « Reprendre avec le même fichier », reprend l'envoi.
Si un proxy refuse les morceaux de 16 Mo (réponse 413), le site passe à des morceaux de 2 Mo, plus lents.

**Erreur 429 « Trop de requêtes »** : ce code ne vient pas de l'API (qui ne le renvoie qu'après des échecs de
connexion, avec un message explicite). Il est renvoyé par un intermédiaire devant le site (Cloudflare ou nginx)
qui limite le nombre de requêtes ; l'envoi d'une vidéo en fait une par morceau. Le site attend alors
(en-tête `Retry-After` s'il est fourni, sinon 60 s et plus) et reprend tout seul, y compris au chargement
de la page. Pour l'éviter :
- relever la limite du nginx de l'hôte (commande plus bas) : les morceaux passent de 2 Mo à 16 Mo,
  soit 8 fois moins de requêtes ;
- voir dans Cloudflare > Security > Events (ou Analytics) quelle règle a renvoyé le 429, et l'assouplir
  ou l'exclure pour le chemin `/api/episodes/` ;
- `curl -sI https://gameone-val.com/api/health` : un en-tête `server: cloudflare` indique que Cloudflare est devant.

Taille maximale d'une vidéo : 20 Go (`MAX_VIDEO_GB` dans `.env`). L'import est refusé s'il ne reste pas
assez d'espace disque sur le serveur (taille du fichier + 512 Mo).

## Développement local

```bash
cd backend && npm install && npm run dev      # API sur le port 3000, base et médias dans backend/data/
```

```bash
cd frontend && npm install && npm run dev     # front sur le port 5173, proxy /api vers le port 3000
```

```bash
cd backend && CALS_PASSWORD=motdepasse node src/set-password.js moi   # identifiants de test
```

Tests backend : `cd backend && npm test`.

## Déploiement sur le VPS (gameone-val.com)

Le projet Docker Compose s'appelle toujours `cals`, s'installe dans `~/cals` et écoute sur
`127.0.0.1:8080`. Il ne touche pas aux autres conteneurs ni aux autres sites nginx du VPS.

### Passage de Cals au site Animés (installation existante)

```bash
bash ~/cals/deploy/update.sh
```

- L'identifiant et le mot de passe de connexion restent les mêmes (même fichier `cals.db`).
- Les anciennes tables de Cals restent dans `cals.db` mais ne sont plus lues ; rien n'est effacé.
- Les clés `GEMINI_*` / `ANTHROPIC_*` de `.env` ne servent plus et peuvent être retirées.

**nginx de l'hôte (mode nginx)** : `update.sh` ne modifie pas `/etc/nginx/sites-available/cals`, qui
limite les requêtes à 2 Mo. Le site fonctionne quand même (morceaux de 2 Mo, 8 fois plus de requêtes), mais pour des envois plus
rapides et une lecture en flux direct :

```bash
sudo sed -i -e 's/client_max_body_size 2M;/client_max_body_size 70M;/' -e 's/proxy_read_timeout 120s;/proxy_read_timeout 3600s;\n        proxy_request_buffering off;\n        proxy_buffering off;/' /etc/nginx/sites-available/cals
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Première installation

Le dépôt est privé : le cloner avec ses identifiants GitHub, puis lancer le script depuis le clone.

```bash
git clone git@github.com:Thomas642/cals.git ~/cals
```

```bash
MODE=nginx bash ~/cals/deploy/install.sh     # nginx système + Certbot
```

ou

```bash
MODE=tunnel bash ~/cals/deploy/install.sh    # tunnel Cloudflare Zero Trust
```

Le script crée `.env`, construit et démarre les conteneurs, vérifie `http://127.0.0.1:8080/api/health`,
installe le bloc nginx (mode `nginx`) ou affiche le « Public Hostname » à ajouter (mode `tunnel`),
demande l'identifiant et le mot de passe, et programme la sauvegarde quotidienne (cron, 3 h).
Si le port 8080 est déjà pris : `PORT=8090 MODE=nginx bash install.sh`.

### Connexion

Un seul identifiant pour le site, à partager avec la famille. Session gardée par cookie sécurisé
(`HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS) : 90 jours avec « Rester connecté ». Mot de passe haché
(scrypt). 5 échecs depuis une même IP bloquent les tentatives 15 minutes.

```bash
docker compose -f ~/cals/docker-compose.yml exec backend node src/set-password.js <identifiant>
```

(change l'identifiant et le mot de passe et déconnecte toutes les sessions)

### Cloudflare et HTTPS (mode nginx)

- Après Certbot, régler Cloudflare > SSL/TLS sur **Full (strict)**.
- Si Certbot échoue derrière le proxy Cloudflare, passer temporairement les enregistrements DNS
  `gameone-val.com` et `www` en « DNS only » (nuage gris), relancer
  `sudo certbot --nginx -d gameone-val.com -d www.gameone-val.com`, puis les repasser en « Proxied ».
- Diffuser de la vidéo à travers le proxy Cloudflare est encadré par les conditions d'utilisation de
  Cloudflare ; les relire avant de partager le site largement (elles peuvent avoir changé).

### Mise à jour, sauvegarde, espace disque

```bash
bash ~/cals/deploy/update.sh    # sauvegarde, git pull, reconstruction, vérification
```

```bash
bash ~/cals/deploy/backup.sh    # sauvegarde de la base -> ~/cals/backups (30 dernières conservées)
```

```bash
docker compose -f ~/cals/docker-compose.yml logs -f backend
```

La sauvegarde ne copie que la base SQLite (séries, épisodes, pistes, identifiants), **pas les vidéos**.
Les vidéos et sous-titres sont dans le volume Docker `cals_cals-data` ; l'espace libre du serveur est affiché
en bas de la Bibliothèque. Ne pas lancer `docker compose down -v` : l'option `-v` supprime ce volume.

## API

Toutes les routes sauf `/api/health` et `/api/auth/*` exigent une session.

| Méthode | Route | Rôle |
|---|---|---|
| GET | /api/health | État de l'API |
| GET / POST | /api/auth/status, /api/auth/login, /api/auth/logout | Connexion |
| GET | /api/storage | Espace disque libre, volume des vidéos |
| GET / POST | /api/series | Liste (avec nombre d'épisodes) / création `{ title, description }` |
| GET / PUT / DELETE | /api/series/:id | Détail avec épisodes et pistes / modification / suppression (fichiers compris) |
| POST | /api/series/:id/episodes | Annonce d'une vidéo `{ filename, size, number?, title? }` |
| GET / PUT / DELETE | /api/episodes/:id | Détail (avec épisodes précédent/suivant) / numéro et titre / suppression |
| PUT | /api/episodes/:id/upload?offset=N | Morceau de vidéo (corps brut, 64 Mo max). 409 + `received` si la position est fausse |
| PUT | /api/episodes/:id/thumbnail | Miniature (corps brut JPEG/PNG/WebP, 2 Mo max) |
| PUT / DELETE | /api/series/:id/cover | Affiche de la série (corps brut, 8 Mo max) / retour à la miniature |
| POST | /api/episodes/:id/subtitles | `{ filename, content, label?, lang? }`, converti en WebVTT |
| PUT / DELETE | /api/subtitles/:id | Nom et langue `{ label, lang }` / suppression d'une piste |
| POST | /api/episodes/:id/process | Relance l'analyse et la conversion |
| GET | /api/media/video/:id | Lecture de la vidéo (requêtes partielles `Range`) |
| GET | /api/media/subtitle/:id | Piste WebVTT |
| GET | /api/media/thumb/:id, /api/media/cover/:id | Miniature, affiche |

## Suite prévue

Génération automatique des sous-titres français depuis l'audio japonais (transcription puis traduction),
à brancher sur l'import de sous-titres existant.
