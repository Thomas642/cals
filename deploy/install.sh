#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  Cals — premiere installation sur le VPS (Ubuntu/Debian, Docker deja installe)
#
#  Usage (depuis n'importe ou) :
#    curl -fsSL https://raw.githubusercontent.com/Thomas642/cals/MAIN/deploy/install.sh -o install.sh
#    MODE=nginx bash install.sh        # nginx systeme + Certbot (comme l'ancien FamilyTracker)
#    MODE=tunnel bash install.sh       # tunnel Cloudflare Zero Trust existant
#
#  Variables optionnelles :
#    APP_DIR   dossier d'installation          (defaut : $HOME/cals)
#    DOMAIN    domaine principal               (defaut : gameone-val.com)
#    PORT      port local du frontend          (defaut : 8080)
#    REPO      depot git                       (defaut : https://github.com/Thomas642/cals.git)
#    BRANCH    branche                         (defaut : MAIN)
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

MODE="${MODE:-nginx}"
APP_DIR="${APP_DIR:-$HOME/cals}"
DOMAIN="${DOMAIN:-gameone-val.com}"
PORT="${PORT:-8080}"
REPO="${REPO:-https://github.com/Thomas642/cals.git}"
BRANCH="${BRANCH:-MAIN}"

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERREUR : %s\033[0m\n' "$*" >&2; exit 1; }

SUDO=sudo; [[ "$(id -u)" == 0 ]] && SUDO=""
[[ "$MODE" == "nginx" || "$MODE" == "tunnel" ]] || fail "MODE doit valoir nginx ou tunnel"
command -v git >/dev/null    || fail "git absent (sudo apt install git)"
command -v docker >/dev/null || fail "Docker absent (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || fail "plugin docker compose absent"

# Le port ne doit pas etre deja pris par un autre site du VPS.
if ss -ltn "( sport = :$PORT )" | grep -q LISTEN; then
  if ! docker ps --format '{{.Names}} {{.Ports}}' | grep -q "cals-frontend.*:$PORT->"; then
    fail "le port $PORT est deja utilise. Relancer avec PORT=<port libre>"
  fi
fi

say "Code source dans $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

say "Fichier .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s/^CALS_HTTP_PORT=.*/CALS_HTTP_PORT=$PORT/" .env
  read -rp "Cle API Anthropic (Entree pour laisser l'IA desactivee) : " KEY || true
  if [[ -n "${KEY:-}" ]]; then sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" .env; fi
  if [[ "$MODE" == "tunnel" ]]; then
    read -rp "Jeton du tunnel Cloudflare (Entree si un cloudflared tourne deja sur le VPS) : " TOK || true
    if [[ -n "${TOK:-}" ]]; then sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=$TOK|" .env; fi
  fi
  chmod 600 .env
else
  echo ".env deja present : conserve."
fi
PORT="$(grep -E '^CALS_HTTP_PORT=' .env | cut -d= -f2)"; PORT="${PORT:-8080}"

say "Construction et demarrage des conteneurs"
PROFILE_ARGS=()
if [[ "$MODE" == "tunnel" ]] && grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' .env; then PROFILE_ARGS=(--profile tunnel); fi
docker compose "${PROFILE_ARGS[@]}" up -d --build

say "Verification locale"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[[ "${ok:-}" == 1 ]] || fail "Cals ne repond pas sur 127.0.0.1:$PORT (voir : docker compose logs)"
curl -fsS "http://127.0.0.1:$PORT/api/health"; echo

if [[ "$MODE" == "nginx" ]]; then
  say "nginx systeme pour $DOMAIN"
  command -v nginx >/dev/null || fail "nginx absent (sudo apt install nginx)"
  if [[ ! -f /etc/nginx/cals.htpasswd ]]; then
    read -rp "Identifiant d'acces a Cals : " AUTH_USER
    read -rsp "Mot de passe : " AUTH_PASS; echo
    printf '%s:%s\n' "$AUTH_USER" "$(openssl passwd -apr1 "$AUTH_PASS")" | $SUDO tee /etc/nginx/cals.htpasswd >/dev/null
    $SUDO chmod 640 /etc/nginx/cals.htpasswd
    $SUDO chown root:www-data /etc/nginx/cals.htpasswd 2>/dev/null || true
  fi
  sed -e "s/__CALS_PORT__/$PORT/" -e "s/gameone-val.com www.gameone-val.com/$DOMAIN www.$DOMAIN/" \
    deploy/nginx/cals.conf | $SUDO tee /etc/nginx/sites-available/cals >/dev/null
  $SUDO ln -sf /etc/nginx/sites-available/cals /etc/nginx/sites-enabled/cals
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  if command -v certbot >/dev/null; then
    say "Certificat HTTPS (Certbot)"
    $SUDO certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" || echo "Certbot a echoue : voir la section Cloudflare du README."
  else
    echo "Certbot absent : sudo apt install certbot python3-certbot-nginx puis relancer ce script."
  fi
else
  say "Tunnel Cloudflare"
  cat <<TXT
Dans Cloudflare Zero Trust > Networks > Tunnels > (ton tunnel) > Public Hostname, ajouter :
  - Hostname : $DOMAIN          Service : HTTP  ->  $( [[ ${#PROFILE_ARGS[@]} -gt 0 ]] && echo "frontend:80" || echo "localhost:$PORT" )
  - Hostname : www.$DOMAIN      (meme service)
Puis proteger l'acces : Zero Trust > Access > Applications > Self-hosted, domaine $DOMAIN,
politique "Allow" limitee a ton adresse e-mail.
TXT
fi

say "Sauvegarde quotidienne (cron, 3 h)"
CRON_LINE="0 3 * * * $APP_DIR/deploy/backup.sh >> $APP_DIR/backups/backup.log 2>&1"
mkdir -p "$APP_DIR/backups"
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' ; echo "$CRON_LINE" ) | crontab -
echo "$CRON_LINE"

say "Termine : https://$DOMAIN"
