# MervyPlayer — Notes techniques

Document de référence pour comprendre le projet, le rôle de chaque fichier et le fonctionnement global de l'application.

---

## 1. Qu'est-ce que MervyPlayer ?

**MervyPlayer** est une **PWA** (Progressive Web App) : une application web installable sur l'écran d'accueil de l'iPhone, comme une vraie app.

Elle permet de :
- **Rechercher** des musiques sur YouTube
- **Écouter un aperçu** avant téléchargement (streaming via le PC)
- **Télécharger** les morceaux en format M4A sur l'iPhone (stockage local)
- **Écouter hors-ligne** les musiques importées
- **Créer des playlists** et gérer une bibliothèque personnelle
- **Exporter** les fichiers vers l'app Fichiers iPhone (dossier MervyPlayer)

### Architecture en deux parties

```
┌─────────────────────┐         Wi-Fi          ┌─────────────────────┐
│   iPhone (Safari)   │ ◄────────────────────► │   PC (Node.js)      │
│   PWA MervyPlayer   │      HTTPS :3000       │   server.js         │
│   index.html        │                        │   yt-dlp.exe        │
│   app.js            │                        │   bin/ + temp/      │
│   IndexedDB         │                        └──────────┬──────────┘
└─────────────────────┘                                   │
                                                            ▼
                                                    YouTube (Internet)
```

| Composant | Où ça tourne | Rôle |
|-----------|--------------|------|
| Interface (HTML/CSS/JS) | iPhone | Affichage, lecteur, playlists |
| IndexedDB | iPhone | Stockage des musiques téléchargées |
| Service Worker | iPhone | Cache de l'interface (PWA) |
| Serveur Node.js | PC Windows | API + téléchargement YouTube |
| yt-dlp | PC Windows | Outil qui extrait l'audio YouTube |

> **Important :** la recherche et le téléchargement **nécessitent le PC allumé** sur le même réseau Wi-Fi. Seule la **bibliothèque déjà importée** fonctionne sans PC.

---

## 2. Fichiers du projet — rôle de chacun

### Fichiers principaux (interface)

| Fichier | Importance | Description |
|---------|------------|-------------|
| `index.html` | ★★★★★ | Structure de l'app : onglets, lecteur, modales, splash screen |
| `styles.css` | ★★★★★ | Design complet : responsive iPhone XR, listes, navbar, animations |
| `app.js` | ★★★★★ | Toute la logique client : audio, IndexedDB, UI, recherche |
| `manifest.json` | ★★★★☆ | Config PWA : nom, icônes, couleurs pour l'écran d'accueil |
| `sw.js` | ★★★★☆ | Service Worker : met en cache l'interface pour chargement rapide |

### Fichiers serveur (PC)

| Fichier | Importance | Description |
|---------|------------|-------------|
| `server.js` | ★★★★★ | Serveur HTTP/HTTPS + API REST + yt-dlp |
| `bin/yt-dlp.exe` | ★★★★★ | Téléchargé auto au 1er lancement — extrait l'audio YouTube |
| `temp/` | ★★★☆☆ | Dossier temporaire pour les M4A avant envoi à l'iPhone |

### Certificats HTTPS

| Fichier | Importance | Description |
|---------|------------|-------------|
| `cert.pem` | ★★★★☆ | **Certificat public** SSL — présenté au navigateur pour HTTPS |
| `key.pem` | ★★★★★ | **Clé privée** SSL — signe les connexions sécurisées |

#### Pourquoi `cert.pem` et `key.pem` existent ?

Sur **iPhone**, Safari **exige HTTPS** pour :
- Enregistrer le Service Worker (mode PWA / hors-ligne partiel)
- Accéder à certaines APIs modernes

Le serveur génère automatiquement un **certificat auto-signé** au premier lancement (via OpenSSL). Ce n'est **pas** un certificat officiel (Let's Encrypt, etc.), donc Safari affichera un avertissement « connexion non sécurisée » — il faut appuyer sur **Avancé → Continuer** une fois.

| Fichier | Contient | Analogie |
|---------|----------|----------|
| `key.pem` | Clé secrète du serveur | La clé de votre maison — **ne jamais partager** |
| `cert.pem` | Identité publique du serveur | La plaque sur la porte — visible par tous |

Ces fichiers sont **recréés automatiquement** s'ils n'existent pas. Ils peuvent être supprimés pour forcer une régénération.

### Icônes PWA

| Fichier | Taille | Usage |
|---------|--------|-------|
| `icon-180.png` | 180×180 | iPhone — écran d'accueil (apple-touch-icon) |
| `icon-192.png` | 192×192 | Android / PWA standard |
| `icon-512.png` | 512×512 | Écran de démarrage PWA |
| `generate-icons.ps1` | — | Script PowerShell pour régénérer les icônes |

### Documentation

| Fichier | Description |
|---------|-------------|
| `NOTES_TECHNIQUES.md` | Ce document |

---

## 3. API du serveur (`server.js`)

| Endpoint | Méthode | Rôle |
|----------|---------|------|
| `/api/search?q=mot-clé` | GET | Recherche YouTube (jusqu'à **100** résultats) |
| `/api/download?id=VIDEO_ID` | GET | Télécharge le M4A dans `temp/` |
| `/api/download-status?id=VIDEO_ID` | GET | Progression du téléchargement (0–100 %) |
| `/api/stream?id=VIDEO_ID` | GET | Envoie le fichier M4A à l'iPhone |
| `/api/stream-youtube?id=VIDEO_ID` | GET | Streaming direct (aperçu sans télécharger) |
| `/api/proxy-thumbnail?url=...` | GET | Proxy pour les miniatures YouTube |

---

## 4. Stockage local (IndexedDB)

Base de données : **`MervyPlayerDB`**

### Store `songs` (clé : ID YouTube)
```javascript
{
  id: "dQw4w9WgXcQ",
  title: "Titre",
  artist: "Artiste",
  duration: 213,
  audioData: ArrayBuffer,    // Fichier M4A complet
  thumbnailBlob: Blob,       // Miniature
  createdAt: 1710000000000
}
```

### Store `playlists` (clé auto-incrémentée)
```javascript
{
  id: 1,
  name: "Favoris",
  songIds: ["id1", "id2"],
  createdAt: 1710000000000
}
```

---

## 5. Parcours utilisateur typique

### Recherche et aperçu
1. L'utilisateur tape dans la barre de recherche
2. Après 700 ms sans frappe, `app.js` appelle `/api/search`
3. `server.js` lance `yt-dlp ytsearch50:mot-clé`
4. Les résultats s'affichent en cartes
5. Bouton **Écouter** → `/api/stream-youtube` (streaming live)

### Téléchargement
1. Bouton **Télécharger** → `/api/download` (yt-dlp sur le PC)
2. Polling `/api/download-status` pour la barre de progression
3. `/api/stream` envoie le M4A à l'iPhone
4. `app.js` sauvegarde dans IndexedDB
5. Le morceau apparaît dans **Bibliothèque** (hors-ligne)

### Lecture
- Morceau local → Blob URL depuis IndexedDB
- Morceau en aperçu → stream YouTube via le PC
- **Media Session API** → contrôles sur l'écran de verrouillage iOS

---

## 6. Installation sur iPhone

1. Sur le PC : `node server.js`
2. iPhone et PC sur le **même Wi-Fi**
3. Safari → `https://IP-DU-PC:3000`
4. Accepter le certificat (Avancé → Continuer)
5. Partager → **Sur l'écran d'accueil**
6. L'app s'ouvre en mode standalone (sans barre Safari)

---

## 7. Recherche — pourquoi parfois peu de résultats ?

**Cause corrigée :** l'ancien code utilisait `--flat-playlist` et **annulait** la requête serveur à chaque frappe, ce qui tuait yt-dlp avant la fin → seulement 1–2 résultats.

**Solution actuelle :**
- Parsing robuste (playlist `entries` + lignes individuelles)
- Pas d'annulation agressive côté serveur
- Côté client : debounce 700 ms + ignore les réponses obsolètes
- Jusqu'à **100 résultats** par recherche (limite YouTube/yt-dlp)
- **Redémarrer le serveur** après chaque modification de `server.js` (Ctrl+C puis `node server.js`)

---

## 8. Préférences sauvegardées (localStorage)

| Clé | Valeur |
|-----|--------|
| `mervyplayer-repeat` | `none` / `all` / `one` |
| `mervyplayer-shuffle` | `0` / `1` |
| `mervyplayer-sort` | `recent` / `title` / `artist` |

---

## 9. Commandes utiles

```bash
# Démarrer le serveur
node server.js

# Régénérer les icônes (Windows PowerShell)
powershell -ExecutionPolicy Bypass -File generate-icons.ps1
```

---

## 10. Limites connues

- **Usage YouTube** : téléchargement pour usage personnel — respecter les conditions d'utilisation
- **Pas de dossier auto sur iPhone** : l'export crée des fichiers `MervyPlayer - Artiste - Titre.m4a` ; l'utilisateur choisit le dossier dans Fichiers
- **PC requis** pour recherche et nouveaux téléchargements
- **Certificat auto-signé** : avertissement Safari à accepter manuellement

---

*Document généré pour le projet MervyPlayer — dernière mise à jour : juin 2025*
