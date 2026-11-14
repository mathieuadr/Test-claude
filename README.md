# 🏙️ Skyline — le jeu des quartiers

Jeu de plateau immobilier **multijoueur en temps réel**, pensé pour le téléphone.
Achète des terrains, construis maisons et hôtels, négocie avec tes amis… et ruine-les avec style.

- 📱 **PWA** : installable sur l’écran d’accueil (iOS et Android), plein écran, fonctionne comme une app
- ⚡ **Temps réel** via WebSocket : chacun joue depuis son téléphone
- 🔗 **Invitation en un tap** : code à 4 lettres ou lien partagé (`/?room=ABCD`)
- 🔄 **Reconnexion automatique** : si tu fermes l’app ou perds le réseau, tu reviens dans ta partie
- ☁️ **Cloud ready** : Docker, `/healthz`, port via `$PORT`, heartbeat WebSocket, arrêt propre

## Règles intégrées
2 à 6 joueurs · 1 500 ₭ au départ · 200 ₭ en passant par le Départ · doubles = on rejoue (3 doubles = prison) ·
achat de terrains · loyers doublés sur un quartier complet · maisons/hôtels avec construction équilibrée ·
4 lignes de métro, 2 services · cartes Opportunité et Fortune · prison (double, caution ou carte) ·
hypothèques (+10 % à la levée) · **échanges** de terrains / argent / cartes entre joueurs ·
dettes et faillite · réactions emoji 😂🔥.

L’hôte peut éliminer un joueur parti pour débloquer la partie.

## Lancer en local
```bash
npm install
npm start          # http://localhost:8080
```
Pour jouer à plusieurs sur le même Wi-Fi : ouvre `http://<ip-de-ton-ordi>:8080` sur les téléphones.
(L’installation en PWA nécessite HTTPS, donc un déploiement cloud.)

## Déployer dans le cloud
Le serveur est un seul process Node (≥ 18) qui sert l’app et le WebSocket sur le même port.

**Render (gratuit)** — New → Blueprint → choisis ce dépôt : `render.yaml` s’occupe du reste.

**Fly.io**
```bash
fly launch --copy-config --no-deploy
fly deploy
```

**Docker (n’importe où : Cloud Run, Railway, VPS…)**
```bash
docker build -t skyline .
docker run -p 8080:8080 skyline
```

> Les parties sont gardées en mémoire : utilise **une seule instance** (pas d’autoscaling horizontal).
> Un redémarrage du serveur termine les parties en cours.

## Tests
```bash
npm test             # simule 300 parties complètes et vérifie les invariants du moteur
node test/e2e.js     # 3 téléphones virtuels jouent une partie (serveur sur :8099, Playwright requis)
```

## Structure
```
server/board.js   plateau, quartiers, cartes
server/game.js    moteur de règles (autoritaire côté serveur)
server/index.js   HTTP statique + WebSocket + salles
public/           app PWA (HTML/CSS/JS sans framework, service worker, manifest, icônes)
```
