# 🏙️ Skyline — le jeu des quartiers

Jeu de plateau immobilier **multijoueur en temps réel**, pensé pour le téléphone.
Achète des terrains, construis maisons et hôtels, négocie avec tes amis… et ruine-les avec style.

👉 **Jouer : https://mathieuadr.github.io/Test-claude/**

- 📱 **PWA** installable sur l’écran d’accueil (iOS : Partager → « Sur l’écran d’accueil » ; Android : « Installer l’application »)
- 🔗 **Invitation en un tap** : code à 5 lettres ou lien partagé (`…/Test-claude/?room=ABCDE`)
- ⚡ **Sans serveur** : hébergé gratuitement sur GitHub Pages, les téléphones communiquent via un relais MQTT public
- 🔄 **Reconnexion automatique**, et si l’hôte quitte, un autre joueur reprend la partie automatiquement
- ⏭️ Un joueur absent ? N’importe qui peut **passer son tour** ou l’éliminer

## Règles intégrées
2 à 6 joueurs · 1 500 ₭ au départ · 200 ₭ en passant par le Départ · doubles = on rejoue (3 doubles = prison) ·
achat de terrains · loyers doublés sur un quartier complet · maisons/hôtels avec construction équilibrée ·
4 lignes de métro, 2 services · cartes Opportunité et Fortune · prison (double, caution ou carte) ·
hypothèques (+10 % à la levée) · **échanges** de terrains / argent / cartes · dettes et faillite · réactions emoji.

## Comment ça marche
```
public/engine/   moteur de règles (board.js, game.js) — exécuté par le téléphone « hôte »
public/net.js    réseau : relais MQTT (wss://broker.hivemq.com), état de la salle publié en message retenu,
                 reprise automatique de l’hôte si son téléphone se déconnecte
public/app.js    interface (HTML/CSS/JS sans framework), service worker, manifest
```
Le relais est public : les échanges de la partie ne sont pas chiffrés de bout en bout (ce n’est qu’un jeu).
Pour utiliser un autre relais MQTT-over-WebSocket : ajoute `?broker=wss://…` à l’URL (tous les joueurs doivent utiliser le même).

## Déploiement
Chaque push sur la branche par défaut (ou `main`) lance `.github/workflows/pages.yml` :
tests du moteur puis publication de `public/` sur GitHub Pages.
Si le premier déploiement échoue sur « configure-pages » : **Settings → Pages → Source : GitHub Actions**, puis relance le workflow.

## Développement
```bash
npm install
npm start            # app sur http://localhost:8099/Test-claude/?broker=ws://localhost:8883 (+ relais MQTT local)
npm test             # simule 300 parties complètes et vérifie les invariants du moteur
npm run e2e          # 3 téléphones virtuels jouent, rechargent, l’hôte part… (Playwright requis)
```
