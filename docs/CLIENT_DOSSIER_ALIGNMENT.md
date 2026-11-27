# JANITOU FOOD — Alignement Dossier Client (Phase 0) & Implémentation

Ce document assure la traçabilité entre le dossier officiel du client (`00 - FOUNDATION`, `01 - MANAGEMENT`, `03 - PROJECT CONTROL CENTER`) et le dépôt applicatif (`janitou-food-management`).

## 1. Stack technique retenue (pour mise à jour `02 - DEVELOPMENT`)

- **Runtime & Langage :** Bun / Node.js 20+, TypeScript 5.7 strict (`ES2022` / `NodeNext`).
- **Backend :** API HTTP modulaire (`apps/api`), RBAC centralisé (`apps/api/src/modules/common/policy.ts`), journal d'audit avant/après avec rétention 2 ans.
- **Base de données :** PostgreSQL 16 + Prisma (`packages/database`), stockage hybride (`app_state` JSONB + tables relationnelles d'identité/sessions/audit) et mode fichier atomique pour les tests locaux.
- **Frontends :** Dashboard ERP (`/dashboard`), PWA Manager (`/app`), PWA Client (`/client`).
- **Déploiement :** Docker multi-stage non-root, Nginx TLS + Certbot (`deploy/docker-compose.prod.yml`), CI GitHub Actions (`.github/workflows/ci.yml`).

## 2. Couverture des exigences clés du dossier

| Référence dossier | Exigence | Implémentation |
| :--- | :--- | :--- |
| `BR-001`..`BR-018` | Cycle client, revue 10 j, cutoffs, extras | `store.ts`, `modules/client/routes.ts`, `modules/simple/routes.ts` |
| `BR-015` | Modification exceptionnelle sur abonnement fixe (`isExceptionOverride`) | `store.ts` (`updateClientOrder`) |
| `BR-019` | Plafonds d'extras personnalisés par client | `PATCH /api/v1/customers/:id/extra-overrides` |
| `BR-020`..`BR-050` | Règles calendrier, production, flotte, compta, audit, backup | `store.ts`, `modules/system/routes.ts`, `services/backup.ts` |
| `DOC-18 bis` (`20`–`23`) | Partenaires producteurs, commandes exceptionnelles, réception qualité, score cumulatif, réservations temporaires | `modules/partners/routes.ts`, `/api/v1/client/alternatives/:id/hold` |
| `DOC-19 bis` (`25`–`27`) | Expiration de session hors-ligne & nombre max de tentatives configurables | `SimpleSettings` (`offlineSessionTtlMinutes`, `offlineMaxRetries`), `apps/web/src/client/index.html` |
| `DOC-30` | Gestion du Jour Opérationnel (préparations J-1 rattachées à J) | `GET/POST/PATCH /api/v1/production/operational-day` |
| `DOC-36` & `Décision 011` §4 | Tâches périodiques & fiches imprimables pour personnel sans smartphone | `modules/tasks/routes.ts` (`/api/v1/tasks/periodic`, `/api/v1/tasks/printable`) |
| `Décision 011` | Session unique `ADMIN`, appareils de confiance, reset mot de passe WhatsApp/Email | `store.ts`, `modules/auth/routes.ts`, `/api/v1/simple/devices` |
| `Décision 012` & `DOC-31` | Activation d'urgence contrôlée par l'humain, chaîne d'escalade, réconciliation & résolution de conflits | `/api/v1/emergency/activate`, `/incidents/:id/conflicts`, `/incidents/:id/resolve` |
| `Décision 009` & `BR-051` | Éligibilité contrôlée par le serveur ; auto-inscription activable (`allowClientSelfRegistration`) | `POST /api/v1/client/register`, `SimpleSettings` |

## 3. Actions externes restantes

1. **Stores mobiles (`Décision 009`)** : empaqueter `/client` (Capacitor ou Trusted Web Activity) pour soumission sur **Google Play Store** et **Apple App Store**.
2. **Synchronisation Google Drive** : copier ce document et les ADR dans le dossier `02 - DEVELOPMENT` du Drive du client.
3. **Production VPS** : renseigner `.env.production`, changer les mots de passe démo, activer `JANITOU_MFA_REQUIRED_ADMINS=1` et configurer `WHATSAPP_CLOUD_TOKEN` / `TWILIO_*`.
