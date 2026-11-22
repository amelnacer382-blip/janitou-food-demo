# JANITOU FOOD — Rapport d'exécution des tests & assurance qualité

**Date :** 16/11/2026
**Environnement :** Bun 1.4.4, TypeScript 5.7.2, Linux (WSL2), PostgreSQL 16 en CI
**Statut :** **34/34 tests réussis (100 %), typage strict sans erreur**

---

## 1. Synthèse

| Étape | Commande | Résultat |
| --- | --- | --- |
| Tests unitaires & intégration | `bun test` | **34 pass, 0 fail** |
| Typage strict API | `tsc --noEmit -p apps/api/tsconfig.json` | **0 erreur** |
| Build packages | `bun run build:bun` | OK |
| Smoke HTTP (rôles, backup, restore) | serveur + `curl` | OK |
| PostgreSQL 16 + migrations | CI `db:generate`, `db:migrate`, smoke | workflow CI |

## 2. Couverture fonctionnelle

- Coût matière, pricing, production, déficits, bons de commande, réception.
- Tournées, statuts, rémunération, transfert, **flotte et charge**.
- KDS, étiquettes, emballage individuel et **collectif**.
- Clients, filiales, soldes prépayés, factures, paiements, **remises**.
- 14 rapports officiels, audit, Emergency Workshop Package.
- Persistance et restauration complète, validation et rejet des payloads invalides.
- Authentification staff, MFA TOTP + codes de récupération, matrice de rôles.
- **Ordres de travail, ateliers/capacités, écarts prévu/réel.**
- **Alternatives permanentes/limitées/réservation, prix spécifique et épuisement.**
- **Versionnement des recettes**, proposition de menu 7 jours.
- **Remise client**, remise facture, prix de référence.

## 3. Fichiers de tests

| Fichier | Périmètre |
| --- | --- |
| `apps/api/test/platform.test.ts` | moteur métier, production, achats, tournées, rapports, persistance, restauration, course d'écriture |
| `apps/api/test/router.test.ts` | HTTP, auth, MFA, administration utilisateurs, sessions, audit |
| `apps/api/test/auth.test.ts` | login, rôles, logout |
| `apps/api/test/client.test.ts` | PWA client, commandes publiques, approbation, suivi |
| `apps/api/test/simple.test.ts` | mode manager simple |
| `apps/api/test/phase1-security.test.ts` | matrice de rôles legacy, ré-auth, validation restore |
| `apps/api/test/phase1-operations.test.ts` | ordres de travail, ateliers, flotte, versions, alternatives, menu, remises, emballage |

## 4. Limites connues

- Les tests locaux utilisent le backend JSON éphémère ; le backend PostgreSQL est couvert par le smoke CI (pas par les tests unitaires locaux).
- Pas de tests de charge (Phase 2).
- La vérification visuelle navigateur n'a pas pu être automatisée dans cet environnement ; le HTML/JS a été contrôlé syntaxiquement et les endpoints par smoke HTTP.
