#!/usr/bin/env bash
# JANITOU FOOD — Ubuntu 22.04/24.04 VPS bootstrap.
# Run as root from the repository root: sudo bash deploy/vps-provision.sh
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "This script must run as root (sudo)." >&2
  exit 1
fi

APP_DIR=${APP_DIR:-/opt/janitou-food}
DOMAIN=${DOMAIN:-}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg ufw fail2ban jq git docker.io docker-compose-v2

systemctl enable --now docker
systemctl enable --now fail2ban

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p "${APP_DIR}"

cat <<EOF
VPS prepared for JANITOU FOOD.

Next steps:
  1. Clone the client repository into ${APP_DIR}:
       git clone <repository-url> ${APP_DIR}
  2. Copy the environment template and set strong secrets:
       cd ${APP_DIR}
       cp .env.production.example .env.production
       editor .env.production   # DOMAIN, DB_PASSWORD, WHATSAPP/TWILIO, MFA
  3. Issue the first certificate (port 80 must be free):
       docker run --rm -p 80:80 \\
         -v janitou-food-management_letsencrypt:/etc/letsencrypt \\
         -v janitou-food-management_certbot_webroot:/var/www/certbot \\
         certbot/certbot certonly --standalone -d ${DOMAIN:-your.domain} \\
         --email admin@${DOMAIN:-your.domain} --agree-tos --non-interactive
  4. Start the stack:
       docker compose --env-file .env.production -f deploy/docker-compose.prod.yml up -d --build
  5. Verify:
       curl -fsS https://${DOMAIN:-your.domain}/health
       curl -fsS https://${DOMAIN:-your.domain}/api/v1/openapi.json > /dev/null

DNS: point an A record for ${DOMAIN:-your.domain} to this server before step 3.
EOF
