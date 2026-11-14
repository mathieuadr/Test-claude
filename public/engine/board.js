// Plateau original "Skyline" : 40 cases, 8 quartiers, 4 lignes de métro, 2 services.

export const GROUPS = {
  brown:  { name: 'Vieux Port',   color: '#a0715a', houseCost: 50 },
  sky:    { name: 'Les Canaux',   color: '#5cc8f2', houseCost: 50 },
  pink:   { name: 'Arts',         color: '#ef5da8', houseCost: 100 },
  orange: { name: 'Studios',      color: '#ff9b42', houseCost: 100 },
  red:    { name: 'Vermeil',      color: '#ff4d5e', houseCost: 150 },
  yellow: { name: 'Soleil',       color: '#ffd23f', houseCost: 150 },
  green:  { name: 'Jardins',      color: '#2fd08b', houseCost: 200 },
  blue:   { name: 'Riviera',      color: '#4f6bff', houseCost: 200 },
  metro:  { name: 'Métro',        color: '#c3c9d9' },
  utility:{ name: 'Services',     color: '#b18cff' },
};

const p = (name, group, price, rent) => ({ type: 'property', name, group, price, rent });
const m = (name) => ({ type: 'metro', name, group: 'metro', price: 200 });
const u = (name, icon) => ({ type: 'utility', name, group: 'utility', price: 150, icon });

export const TILES = [
  { type: 'go', name: 'Départ' },
  p('Rue des Tanneurs', 'brown', 60, [2, 10, 30, 90, 160, 250]),
  { type: 'chest', name: 'Fortune' },
  p('Impasse du Lavoir', 'brown', 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Taxe foncière', amount: 200 },
  m('Métro Nord'),
  p('Quai des Brumes', 'sky', 100, [6, 30, 90, 270, 400, 550]),
  { type: 'chance', name: 'Opportunité' },
  p('Allée des Saules', 'sky', 100, [6, 30, 90, 270, 400, 550]),
  p('Rue du Canal', 'sky', 120, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Prison' },
  p('Place des Arts', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  u('Centrale Solaire', '☀️'),
  p('Rue Galerie', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  p('Passage Lumière', 'pink', 160, [12, 60, 180, 500, 700, 900]),
  m('Métro Est'),
  p('Boulevard Jazz', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  { type: 'chest', name: 'Fortune' },
  p('Rue des Studios', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  p('Avenue Néon', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'parking', name: 'Pause café' },
  p('Cours Vermeil', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  { type: 'chance', name: 'Opportunité' },
  p('Rue Carmin', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  p('Place Écarlate', 'red', 240, [20, 100, 300, 750, 925, 1100]),
  m('Métro Sud'),
  p('Avenue Soleil', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  p('Rue Dorée', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  u('Réseau Fibre', '📡'),
  p('Place Ambre', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Au poste !' },
  p('Parc Émeraude', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  p('Allée Jade', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  { type: 'chest', name: 'Fortune' },
  p('Boulevard Sauge', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
  m('Métro Ouest'),
  { type: 'chance', name: 'Opportunité' },
  p('Tour Saphir', 'blue', 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Taxe de luxe', amount: 100 },
  p('Cap Azur', 'blue', 400, [50, 200, 600, 1400, 1700, 2000]),
];

TILES.forEach((t, i) => { t.index = i; });

export const GROUP_TILES = {};
TILES.forEach((t) => {
  if (t.group) (GROUP_TILES[t.group] ||= []).push(t.index);
});

// Cartes. kind: money | move | moveBy | jail | jailCard | payEach | collectEach | repairs | nearest
export const CHANCE = [
  { text: 'Avance jusqu’au Départ. Encaisse 200 ₭.', kind: 'move', to: 0 },
  { text: 'Rendez-vous à Cap Azur.', kind: 'move', to: 39 },
  { text: 'Va Place Écarlate. Si tu passes par le Départ, encaisse 200 ₭.', kind: 'move', to: 24 },
  { text: 'Va Place des Arts. Si tu passes par le Départ, encaisse 200 ₭.', kind: 'move', to: 11 },
  { text: 'Prends le métro le plus proche. Loyer doublé s’il appartient à quelqu’un.', kind: 'nearest', target: 'metro' },
  { text: 'Prends le métro le plus proche. Loyer doublé s’il appartient à quelqu’un.', kind: 'nearest', target: 'metro' },
  { text: 'Va au service le plus proche.', kind: 'nearest', target: 'utility' },
  { text: 'Ta startup lève des fonds ! Reçois 150 ₭.', kind: 'money', amount: 150 },
  { text: 'Dividendes de tes NFT (étonnant). Reçois 50 ₭.', kind: 'money', amount: 50 },
  { text: 'Recule de 3 cases.', kind: 'moveBy', steps: -3 },
  { text: 'Excès de vitesse en trottinette. Paie 15 ₭.', kind: 'money', amount: -15 },
  { text: 'Tu es élu·e maire du quartier. Verse 50 ₭ à chaque joueur.', kind: 'payEach', amount: 50 },
  { text: 'Rénovation énergétique : 25 ₭ par maison, 100 ₭ par hôtel.', kind: 'repairs', house: 25, hotel: 100 },
  { text: 'Direction le poste de police. Ne passe pas par le Départ.', kind: 'jail' },
  { text: 'Bon de sortie de prison. Garde cette carte.', kind: 'jailCard' },
];

export const CHEST = [
  { text: 'Avance jusqu’au Départ. Encaisse 200 ₭.', kind: 'move', to: 0 },
  { text: 'Erreur de la banque en ta faveur. Reçois 200 ₭.', kind: 'money', amount: 200 },
  { text: 'Visite chez le dentiste. Paie 50 ₭.', kind: 'money', amount: -50 },
  { text: 'Tu revends ta vieille console. Reçois 50 ₭.', kind: 'money', amount: 50 },
  { text: 'Bon de sortie de prison. Garde cette carte.', kind: 'jailCard' },
  { text: 'Direction le poste de police. Ne passe pas par le Départ.', kind: 'jail' },
  { text: 'C’est ton anniversaire ! Chaque joueur t’offre 10 ₭.', kind: 'collectEach', amount: 10 },
  { text: 'Remboursement d’impôts. Reçois 20 ₭.', kind: 'money', amount: 20 },
  { text: 'Ton assurance vie arrive à échéance. Reçois 100 ₭.', kind: 'money', amount: 100 },
  { text: 'Frais d’hôpital. Paie 100 ₭.', kind: 'money', amount: -100 },
  { text: 'Frais de scolarité. Paie 50 ₭.', kind: 'money', amount: -50 },
  { text: 'Prime de conseil. Reçois 25 ₭.', kind: 'money', amount: 25 },
  { text: 'Travaux de voirie : 40 ₭ par maison, 115 ₭ par hôtel.', kind: 'repairs', house: 40, hotel: 115 },
  { text: 'Tu gagnes un concours de design. Reçois 10 ₭.', kind: 'money', amount: 10 },
  { text: 'Tu hérites de 100 ₭.', kind: 'money', amount: 100 },
];

export const TOKENS = ['🚀', '🦄', '🐙', '🦊', '🎸', '🍩', '🛸', '🐼', '🌵', '👑'];
export const COLORS = ['#ff5d8f', '#4fd1ff', '#ffd23f', '#7cf29c', '#b18cff', '#ff9b42'];
