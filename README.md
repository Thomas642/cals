# Family Tracker

Application web progressive (PWA) auto-hébergée de partage de position GPS en famille.

## Stack

- **Backend** : Node.js + Express + Socket.io
- **Base de données** : PostgreSQL + PostGIS
- **Frontend** : HTML/CSS/JS vanilla + Leaflet.js (OpenStreetMap)
- **Notifications** : Web Push API (sans Firebase)
- **Déploiement** : Nginx reverse proxy + Let's Encrypt

## Démarrage rapide (Docker)

```bash
cp .env.example .env
# Remplir les variables dans .env

docker compose up -d

# Créer le premier compte admin
docker compose exec api node scripts/create-admin.js "Prénom" "admin@exemple.com" "motdepasse"
```

L'API tourne sur `http://localhost:3000`, le frontend est servi par Nginx.

## Démarrage manuel (VPS Ubuntu)

```bash
chmod +x scripts/setup.sh
sudo ./scripts/setup.sh

# Créer le premier compte admin
cd /var/www/familytracker/backend
node scripts/create-admin.js "Prénom" "admin@exemple.com" "motdepasse"

# SSL
certbot --nginx -d tracker.example.com
```

## Structure

```
FamilyTracker/
├── backend/
│   ├── src/
│   │   ├── app.js              # Serveur Express + Socket.io
│   │   ├── config/database.js  # Pool PostgreSQL
│   │   ├── middleware/auth.js  # JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js         # Inscription (invitation) + login
│   │   │   ├── positions.js    # Réception et lecture des positions GPS
│   │   │   ├── history.js      # Historique des trajets
│   │   │   ├── zones.js        # Géofencing
│   │   │   ├── members.js      # Profils + avatar + admin
│   │   │   └── notify.js       # SOS + test push
│   │   └── services/
│   │       ├── geofence.js     # Détection entrée/sortie de zones
│   │       └── watchdog.js     # Alertes batterie + déconnexion
│   └── scripts/create-admin.js
├── frontend/
│   ├── index.html              # App principale (carte)
│   ├── login.html              # Connexion + inscription par invitation
│   ├── sw.js                   # Service Worker (cache + push)
│   ├── manifest.json           # PWA manifest
│   ├── css/app.css
│   └── js/
│       ├── api.js              # Wrapper fetch + JWT
│       ├── auth.js             # Garde d'authentification
│       ├── map.js              # Module carte Leaflet
│       ├── geolocation.js      # Module GPS (avec économie batterie)
│       ├── notifications.js    # Push subscription + toasts
│       └── app.js              # Bootstrap et logique UI
├── database/schema.sql         # Schéma PostgreSQL + PostGIS
├── nginx/familytracker.conf    # Configuration Nginx
├── docker-compose.yml
└── scripts/setup.sh            # Script d'installation VPS
```

## Fonctionnalités

- Authentification JWT avec invitation par lien unique
- Carte temps réel OpenStreetMap + Leaflet.js
- Partage GPS en arrière-plan (Service Worker)
- Économie batterie (intervalle étendu si immobile)
- Historique des trajets avec replay animé
- Géofencing — alertes entrée/sortie de zones
- Bouton SOS (appui long 3s)
- Notifications push (Web Push API, sans Firebase)
- Mode privé (suspension du partage)
- Dashboard admin (gestion membres, invitations, stats)
- PWA installable Android + iOS

## Variables d'environnement

Voir `.env.example` à la racine et `backend/.env.example`.

Générer les clés VAPID :
```bash
npx web-push generate-vapid-keys
```
