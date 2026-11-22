# JANITOU FOOD — Dossier de recette Phase 1

**Référence devis :** D2026-0005 (Phase 1 — 177 000 DA HT, prix ferme)
**Date de recette technique :** 16/11/2026
**Commit de référence :** `95cfcf3` + travaux Phase 1 du 16/11/2026
**Environnement vérifié :** Bun 1.4, TypeScript 5.7, PostgreSQL 16 (CI), JSONB/file pour les tests locaux

---

## 1. Preuves d'exécution

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Tests métier, API, sécurité, MFA, restauration | `bun test` | **34 tests, 34 succès, 0 échec** |
| Typage strict de l'API | `tsc --noEmit -p apps/api/tsconfig.json` | **0 erreur** |
| Build des packages partagés | `bun run build:bun` | OK |
| Smoke HTTP | santé, login admin/chef/ops, matrice de rôles, backup/restore | OK |
| PostgreSQL + migrations | `db:generate` / `db:migrate` + smoke CI | workflow `.github/workflows/ci.yml` |
| Build Docker | `docker compose -f deploy/docker-compose.prod.yml config` | configuration valide |

---

## 2. Conformité ligne par ligne (Phase 1)

| # | Ligne du devis | État | Implémentation / preuve |
| --- | --- | --- | --- |
| 01 | Analyse & spécifications | **Conforme** | ADR-001→011, procédures, `docs/BILAN_AVANCEMENT_PHASE_1.md`, critères de recette ci-dessous. |
| 02 | Clients | **Conforme** | CRUD, validation/suspension/gel/annulation/réactivation, société/filiale (`parentCompanyId`, `isSubsidiary`), type d'abonnement, programme hebdomadaire, préférences/notes, historique, relevé de compte, moyen de distribution, lien WhatsApp. |
| 03 | Commandes | **Conforme** | Types `AUTOMATIC/WEEKLY/EXCEPTIONAL/CORPORATE/SUBSIDIARY/INDIVIDUAL`, midi/soir/alternatives, suppléments et prix automatiques, modification/annulation avec snapshots d'audit, cutoff et dates de fermeture, approbation des comptes et commandes `PENDING`. |
| 04 | Repas, fiches, emballage, alternatives | **Conforme** | Recettes **versionnées** (`recipeVersions`), familles, activation, prix de référence, allergènes, coût matière. Emballage individuel + **bacs collectifs** dérivés de la production. Alternatives **permanentes / limitées / sur réservation**, prix spécifique, quantité restante, fenêtre de validité, **routage atelier**. |
| 05 | Calendrier & règles | **Conforme** | Moteur de **proposition 7 jours** (`POST /meal-plans/propose`) + 5 règles (frites, viande hachée, pâtes 1×/semaine, samedi < 45 min, même ingrédient) + alertes + validation humaine avant enregistrement. |
| 06 | Production, achats, pénuries, ateliers | **Conforme** | Plan validable, **ordres de travail** par recette/service, quantités réelles, suivi d'étapes (préparation → production → conditionnement → contrôle), **écarts prévu/réel**, surplus/pénuries + propositions, ateliers avec **station, capacité, affectation**, fournisseurs, PO, réception et réassort. |
| 07 | Distribution | **Conforme** | Flotte (**type, capacité max, immatriculation**), calcul de **charge par tournée**, affectation avec contrôle de capacité, listes/manifeste, tournées, statuts, rémunération chauffeur, transfert de tournée. |
| 08 | Comptabilité | **Conforme** | Facturation automatique, prépayé, paiements, soldes, relevés, reçus, **remises facture (%, fixe)**, **remise client permanente**, distinction payé/non payé, **ajustement du prix de référence**. |
| 09 | Utilisateurs, rôles, sécurité, audit | **Conforme** | Rôles issus de la session, **matrice de permissions par module**, scrypt, sessions hashées et révocables, TOTP + codes de récupération, **ré-authentification** (backup, restore, rôle/mot de passe), audit avant/après, dernier admin protégé. |
| 10 | UI/UX | **Conforme** | Dashboard ERP enrichi (ordres de travail, écarts, flotte, alternatives, versions, remises, proposition de menu), PWA manager `/app`, PWA client `/client`, responsive, AR/FR. |
| 11 | 14 rapports essentiels | **Conforme** | `generateReport(1…14)` + hub et export. |
| 12 | Tests & QA dont Backup/Restore | **Conforme** | 34 tests (dont restauration, persistance, sécurité, MFA, alternatives, ateliers, flotte, remises). CI PostgreSQL + smoke. |
| 13 | Déploiement, formation, docs, backup/restore, continuité | **Conforme côté code** | Docker multi-stage non-root, nginx TLS, migrations Prisma, sauvegardes `0600`/`0700`, rétention 14 j, restauration validée/auditée, Emergency Workshop Package, documentation utilisateur/technique. La **session de formation** reste à planifier. |
| 14 | Gestion projet & GitHub | **Conforme côté dépôt** | Dépôt client, historique Git, CI restauré. Les 6 commits locaux doivent être **poussés** par le propriétaire du dépôt. |
| 15 | Hébergement VPS (1 an) | **Action externe** | `deploy/vps-provision.sh` prépare Ubuntu (Docker, UFW, fail2ban) ; l'achat/attribution du VPS reste à faire. |
| 16 | Nom de domaine (1 an) | **Action externe** | À acheter et pointer (A record) vers le VPS ; `.env.production.example` et nginx sont prêts. |

---

## 3. Contrôles de sécurité livrés

| Contrôle | Comportement |
| --- | --- |
| Matrice legacy | Chef : recettes, menus, commandes, production, KDS. Ops : ajoute clients, achats, distribution, comptabilité, analytics, audit. Admin : tout + système. |
| Backup / restore | ADMIN + mot de passe (`X-Reauth-Password`) + audit. Restauration validée, toutes collections, admin actif obligatoire, sessions orphelines supprimées. |
| Ré-authentification | Restauration, export de sauvegarde, changement de rôle/activation/mot de passe d'un compte staff. |
| Persistance | Écritures sérialisées (plus de perte de session lors d'écritures concurrentes). |
| Fichiers | Upload images contrôlé par signature (JPEG/PNG/WebP, 5 Mo) ; sauvegardes en `0600` dans un dossier `0700`. |
| Sessions | Tokens opaques stockés en SHA-256, TTL staff 8 h, client 7 j, révocation unitaire ou globale. |

---

## 4. Recette opérationnelle (à signer)

- [ ] Créer/modifier un client, une filiale, un programme hebdomadaire.
- [ ] Créer une commande midi/soir avec alternative limitée et supplément.
- [ ] Proposer un menu 7 jours, vérifier les alertes, valider et enregistrer.
- [ ] Générer les ordres de travail, affecter un atelier, saisir les quantités réelles, consulter les écarts.
- [ ] Créer une tournée, vérifier la charge, affecter un véhicule, émarger les arrêts.
- [ ] Émettre une facture, appliquer une remise, encaisser un règlement, consulter le relevé.
- [ ] Exporter une sauvegarde avec ré-authentification, restaurer un backup valide.
- [ ] Vérifier qu'un compte CHEF est bloqué sur clients, achats, audit et restauration.
- [ ] Vérifier la persistance après redémarrage du service.
- [ ] Vérifier `/app`, `/client` et `/dashboard` sur mobile et desktop.

---

## 5. Actions externes restantes (hors code)

1. **Pousser les commits** (`git push origin main`) — le dépôt distant est en retard de 6 commits.
2. **Fournir le VPS et le domaine** (ligne 15/16), puis exécuter `sudo bash deploy/vps-provision.sh`, renseigner `.env.production` et lancer la stack.
3. **Planifier la formation** des utilisateurs clés (cuisine, distribution, administration) et la session de recette formelle.
4. **Changer les comptes de démonstration** et activer `JANITOU_MFA_REQUIRED_ADMINS=1` avant la mise en production.
5. **Confirmer la politique de conservation** des sauvegardes et l'hébergement des copies (obligation contractuelle).

---

## 6. Verdict

La Phase 1 est **techniquement livrable** : les 16 lignes du devis sont couvertes côté logiciel, les 34 tests et le typage passent, et les défauts bloquants identifiés lors de l'audit (restore non protégé, matrice de rôles absente, course de persistance, uploads non persistés) sont corrigés. La recette contractuelle reste conditionnée aux actions externes ci-dessus (VPS, domaine, formation, push Git).
