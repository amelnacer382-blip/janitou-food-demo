# JANITOU FOOD — Packaging Mobile Stores (Décision 009)

Wrapper natif **Capacitor** pour distribuer l'espace client `/client` sur **Google Play Store** (`.aab`) et **Apple App Store** (`.ipa`).

## Prérequis locaux
1. Installer les dépendances dans `mobile/` :
   ```bash
   cd mobile
   npm install
   ```
2. Générer le bundle web en pointant vers votre domaine API HTTPS de production :
   ```bash
   JANITOU_API_ORIGIN=https://app.janitoufood.dz npm run sync:web
   ```
3. Ajouter les plateformes natives :
   - **Android** (nécessite Android Studio + Android SDK) :
     ```bash
     npx cap add android
     npm run android:open
     ```
     Puis **Build → Generate Signed App Bundle / APK** pour exporter `.aab`.
   - **iOS** (nécessite macOS + Xcode + Apple Developer Account) :
     ```bash
     npx cap add ios
     npm run ios:open
     ```
     Puis **Product → Archive** pour exporter `.ipa` vers App Store Connect.
