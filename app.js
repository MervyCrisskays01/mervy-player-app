/**
 * MervyPlayer — Logique client (navigateur / iPhone)
 *
 * Rôle : interface utilisateur, lecteur audio, stockage local (IndexedDB),
 * gestion des playlists, recherche YouTube et mode hors-ligne (PWA).
 */
// État global de l'application
const state = {
    songs: [],
    playlists: [],
    favorites: new Set(),
    currentQueue: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    isRepeat: 'none', // 'none' | 'all' | 'one'
    activeTab: 'search',
    activePlaylistId: null,
    sortMode: 'recent' // 'recent' | 'title' | 'artist'
};

// Active download abort controllers map
const activeDownloadAbortControllers = new Map();

// DOM Elements
const el = {
    // Navigation & Layout
    tabs: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    splashScreen: document.getElementById('splash-screen'),
    forceUpdateBtn: document.getElementById('force-update-btn'),
    
    // Search Tab
    searchInput: document.getElementById('youtube-search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    searchResultsPanel: document.getElementById('search-results-panel'),
    searchResultsHeader: document.getElementById('search-results-header'),
    searchResultsCount: document.getElementById('search-results-count'),
    searchResultsList: document.getElementById('search-results-list'),
    searchResultsPlaceholder: document.getElementById('search-results-placeholder'),
    
    // Library Tab
    libraryList: document.getElementById('library-list'),
    libraryPanel: document.getElementById('library-panel'),
    libraryListHeader: document.getElementById('library-list-header'),
    libraryFilterCount: document.getElementById('library-filter-count'),
    libraryEmpty: document.getElementById('library-empty'),
    libraryCount: document.getElementById('library-count'),
    librarySearchInput: document.getElementById('library-search-input'),
    libraryClearBtn: document.getElementById('library-clear-btn'),
    librarySortSelect: document.getElementById('library-sort-select'),
    exportAllBtn: document.getElementById('export-all-btn'),
    importBtn: document.getElementById('import-btn'),
    importFileInput: document.getElementById('import-file-input'),
    
    // Playlists Tab
    createPlaylistBtn: document.getElementById('create-playlist-btn'),
    playlistsGrid: document.getElementById('playlists-grid'),
    playlistsEmpty: document.getElementById('playlists-empty'),
    playlistDetailView: document.getElementById('playlist-detail-view'),
    playlistDetailTitle: document.getElementById('playlist-detail-title'),
    playlistDetailCount: document.getElementById('playlist-detail-count'),
    playlistDetailList: document.getElementById('playlist-detail-list'),
    playlistBackBtn: document.getElementById('playlist-back-btn'),
    playlistPlayAll: document.getElementById('playlist-play-all'),
    playlistDelete: document.getElementById('playlist-delete'),
    
    // Mini Player
    floatingPlayer: document.getElementById('floating-player'),
    floatingTrigger: document.getElementById('floating-player-trigger'),
    floatingThumbnail: document.getElementById('floating-thumbnail'),
    floatingTitle: document.getElementById('floating-title'),
    floatingArtist: document.getElementById('floating-artist'),
    floatingPlayBtn: document.getElementById('floating-play-btn'),
    floatingPlayPath: document.getElementById('floating-play-icon-path'),
    floatingNextBtn: document.getElementById('floating-next-btn'),
    floatingProgressTiny: document.getElementById('player-progress-fill-tiny'),
    
    // Fullscreen Player Drawer
    fullscreenPlayer: document.getElementById('fullscreen-player'),
    playerPullHandle: document.getElementById('player-pull-handle'),
    playerCloseBtn: document.getElementById('player-close-btn'),
    playerCoverArt: document.getElementById('player-cover-art'),
    playerTrackTitle: document.getElementById('player-track-title'),
    playerTrackArtist: document.getElementById('player-track-artist'),
    favoriteBtn: document.getElementById('favorite-btn'),
    heartIconPath: document.getElementById('heart-icon-path'),
    
    // Scrubber
    playerTimeCurrent: document.getElementById('player-time-current'),
    playerTimeDuration: document.getElementById('player-time-duration'),
    playerProgressSlider: document.getElementById('player-progress-slider'),
    playerProgressFill: document.getElementById('player-progress-fill'),
    scrubberTrackWrap: document.querySelector('.scrubber-track-wrap'),
    
    // Controls
    shuffleBtn: document.getElementById('shuffle-btn'),
    prevBtn: document.getElementById('prev-btn'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    playPath: document.getElementById('play-icon-path'),
    nextBtn: document.getElementById('next-btn'),
    repeatBtn: document.getElementById('repeat-btn'),
    repeatBadge: document.getElementById('repeat-badge'),
    addToPlaylistBtn: document.getElementById('add-to-playlist-btn'),
    visualizerBars: document.querySelector('.visualizer-bars'),
    
    toastContainer: document.getElementById('toast-container'),
    
    // Audio Node
    audio: document.getElementById('native-audio-element'),
    
    // Modals
    playlistModal: document.getElementById('playlist-modal'),
    playlistNameInput: document.getElementById('playlist-name-input'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
    modalCreateBtn: document.getElementById('modal-create-btn'),
    
    addToPlaylistModal: document.getElementById('add-to-playlist-modal'),
    addToPlaylistCancelBtn: document.getElementById('add-to-playlist-cancel-btn'),
    playlistSelectorList: document.getElementById('playlist-selector-list')
};

// SVG Paths
const ICONS = {
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z"
};

// ----------------------------------------------------
// 1. CONFIGURATION SERVEUR DYNAMIQUE
// Sauvegarde l'URL du serveur PC dans localStorage pour ne pas
// dépendre de l'IP (qui change). L'URL est utilisée pour les
// appels API (recherche, téléchargement) mais PAS pour le stockage.
// ----------------------------------------------------
const serverConfig = {
    baseUrl: '',

    init() {
        const saved = localStorage.getItem('mp_server_url');
        if (saved) {
            this.baseUrl = saved;
        } else {
            // Première fois : utiliser l'origine actuelle (pour le premier chargement depuis le PC)
            this.baseUrl = window.location.origin;
            localStorage.setItem('mp_server_url', this.baseUrl);
        }
        console.log('[ServerConfig] URL serveur :', this.baseUrl);
    },

    save(url) {
        const clean = url.replace(/\/$/, '');
        this.baseUrl = clean;
        localStorage.setItem('mp_server_url', clean);
        console.log('[ServerConfig] URL serveur sauvegardée :', clean);
    },

    async ping() {
        try {
            const r = await fetch(this.baseUrl + '/api/ping', {
                signal: AbortSignal.timeout(4000)
            });
            return r.ok;
        } catch {
            return false;
        }
    },

    apiUrl(path) {
        return this.baseUrl + path;
    }
};

// ----------------------------------------------------
// 2. STOCKAGE HYBRIDE — OPFS (primaire) + IndexedDB (fallback)
//
// OPFS (Origin Private File System) stocke les fichiers audio
// dans un vrai système de fichiers privé lié à l'ORIGINE du site
// (ex: mervycrisskays01.github.io), PAS à l'IP du serveur.
// C'est beaucoup plus stable que IndexedDB sur iOS Safari PWA.
// ----------------------------------------------------
const storage = {
    idbInstance: null,
    opfsSupported: false,
    idbAvailable: false,
    dbName: 'MervyPlayerDB',

    // ---- OPFS : stockage des fichiers audio ----
    async opfsInit() {
        try {
            if ('storage' in navigator && 'getDirectory' in navigator.storage) {
                // Test OPFS write access
                const root = await navigator.storage.getDirectory();
                await root.getDirectoryHandle('audio', { create: true });
                this.opfsSupported = true;
                console.log('[Storage] OPFS disponible ✅');
            } else {
                console.log('[Storage] OPFS non disponible, fallback IndexedDB');
            }
        } catch (e) {
            console.warn('[Storage] OPFS init failed:', e);
            this.opfsSupported = false;
        }
    },

    opfsSaveAudio(id, arrayBuffer) {
        return new Promise((resolve, reject) => {
            try {
                // Safari iOS exige que l'écriture OPFS se fasse dans un Web Worker (createWritable n'existe pas sur le thread principal)
                const workerCode = `
                    self.onmessage = async (e) => {
                        try {
                            const { id, arrayBuffer } = e.data;
                            const root = await navigator.storage.getDirectory();
                            const dir = await root.getDirectoryHandle('audio', { create: true });
                            const fh = await dir.getFileHandle(id + '.m4a', { create: true });
                            
                            // Utilise l'accès synchrone (SyncAccessHandle) dans le Worker pour iOS Safari
                            const accessHandle = await fh.createSyncAccessHandle();
                            accessHandle.truncate(0);
                            accessHandle.write(new Uint8Array(arrayBuffer));
                            accessHandle.flush();
                            accessHandle.close();
                            self.postMessage({ success: true });
                        } catch (err) {
                            self.postMessage({ success: false, error: err.message || err.toString() });
                        }
                    };
                `;
                
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                const worker = new Worker(workerUrl);
                
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (e.data.success) {
                        resolve();
                    } else {
                        reject(new Error(e.data.error));
                    }
                };
                
                worker.onerror = (err) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(err);
                };
                
                // Transférer l'arrayBuffer pour éviter la copie mémoire
                worker.postMessage({ id, arrayBuffer }, [arrayBuffer]);
            } catch (err) {
                reject(err);
            }
        });
    },

    async opfsGetAudio(id) {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('audio');
        const fh = await dir.getFileHandle(`${id}.m4a`);
        const file = await fh.getFile();
        return file.arrayBuffer();
    },

    async opfsDeleteAudio(id) {
        try {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('audio');
            await dir.removeEntry(`${id}.m4a`);
        } catch (e) {
            console.warn('[OPFS] Delete failed (file may not exist):', e);
        }
    },

    async opfsListIds() {
        try {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('audio');
            const ids = [];
            for await (const [name] of dir.entries()) {
                if (name.endsWith('.m4a')) ids.push(name.replace('.m4a', ''));
            }
            return ids;
        } catch {
            return [];
        }
    },

    // ---- IndexedDB : stockage des métadonnées + fallback audio ----
    idbInit() {
        return new Promise((resolve) => {
            // iOS Workaround: Touch window.indexedDB early
            if (typeof window !== 'undefined' && window.indexedDB) {
                try {
                    const dummyReq = window.indexedDB.open('mervyplayer_dummy_init', 1);
                    dummyReq.onsuccess = (e) => { if (e.target.result) e.target.result.close(); };
                } catch (e) { /* expected */ }
            }

            let attempts = 0;
            const maxAttempts = 10;

            const tryOpen = () => {
                try {
                    const request = indexedDB.open(this.dbName, 2);

                    request.onerror = () => {
                        attempts++;
                        console.warn(`[IDB] Open attempt ${attempts}/${maxAttempts} failed`);
                        if (attempts >= maxAttempts) {
                            console.error('[IDB] IndexedDB indisponible après plusieurs tentatives. Mode dégradé.');
                            this.idbAvailable = false;
                            resolve(); // Ne pas rejeter — on continue avec OPFS
                        } else {
                            setTimeout(tryOpen, Math.min(attempts * 600, 3000));
                        }
                    };

                    request.onblocked = () => {
                        console.warn('[IDB] Bloqué par une autre connexion ouverte');
                    };

                    request.onsuccess = (e) => {
                        this.idbInstance = e.target.result;
                        this.idbAvailable = true;
                        this.idbInstance.onclose = () => {
                            console.warn('[IDB] Connexion perdue, tentative de réouverture...');
                            this.idbInstance = null;
                            this.idbAvailable = false;
                            this.idbInit().catch(() => {});
                        };
                        console.log('[Storage] IndexedDB disponible ✅');
                        resolve();
                    };

                    request.onupgradeneeded = (e) => {
                        const database = e.target.result;
                        if (!database.objectStoreNames.contains('songs')) {
                            database.createObjectStore('songs', { keyPath: 'id' });
                        }
                        if (!database.objectStoreNames.contains('playlists')) {
                            database.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
                        }
                    };
                } catch (err) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        this.idbAvailable = false;
                        resolve();
                    } else {
                        setTimeout(tryOpen, Math.min(attempts * 600, 3000));
                    }
                }
            };

            tryOpen();
        });
    },

    idbGetAll(storeName) {
        if (!this.idbAvailable || !this.idbInstance) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.idbInstance.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    idbSave(storeName, item) {
        if (!this.idbAvailable || !this.idbInstance) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.idbInstance.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.put(item);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    idbDelete(storeName, key) {
        if (!this.idbAvailable || !this.idbInstance) return Promise.resolve();
        return new Promise((resolve, reject) => {
            try {
                const tx = this.idbInstance.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.delete(key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) { reject(e); }
        });
    },

    // ---- Interface unifiée ----
    async init() {
        await Promise.all([this.opfsInit(), this.idbInit()]);
        // Demander la persistance du stockage à iOS (recommandé)
        if (navigator.storage && navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            console.log(`[Storage] Persistance accordée: ${granted ? '✅ oui' : '⚠️ non garanti'}`);
        }
    },

    // Sauvegarde une chanson : audio → OPFS (ou IDB fallback), méta → IDB + localStorage
    async saveSong(song) {
        const { audioData, ...meta } = song;

        if (this.opfsSupported && audioData) {
            await this.opfsSaveAudio(song.id, audioData);
            meta.storageType = 'opfs';
        } else if (this.idbAvailable && audioData) {
            // Fallback : stocker dans IDB avec l'audio
            await this.idbSave('songs', { ...meta, audioData, storageType: 'idb' });
            this._syncMetaToLocalStorage(meta);
            return;
        }

        // Sauvegarder les métadonnées dans IDB (sans l'audio binaire)
        await this.idbSave('songs', meta);
        this._syncMetaToLocalStorage(meta);
    },

    // Charge l'audio d'une chanson (depuis OPFS ou IDB selon storageType)
    async getAudio(song) {
        if (song.storageType === 'opfs') {
            return this.opfsGetAudio(song.id);
        } else if (song.audioData) {
            // Données déjà chargées (IDB legacy ou import local)
            return song.audioData;
        } else if (this.idbAvailable) {
            // Tentative de lecture depuis IDB
            const all = await this.idbGetAll('songs');
            const found = all.find(s => s.id === song.id);
            return found?.audioData || null;
        }
        return null;
    },

    // Récupère toutes les chansons (métadonnées, sans audioData)
    async getAllSongs() {
        if (this.idbAvailable) {
            try {
                const songs = await this.idbGetAll('songs');
                // Pour les chansons IDB legacy (avec audioData), on les garde tel quel
                return songs;
            } catch (e) {
                console.warn('[Storage] IDB getAll songs failed, fallback localStorage');
            }
        }
        // Fallback : reconstruire depuis localStorage
        return this._loadMetaFromLocalStorage();
    },

    // Playlists : toujours via IDB
    getAllPlaylists() { return this.idbGetAll('playlists'); },
    savePlaylist(pl) { return this.idbSave('playlists', pl); },
    deletePlaylist(id) { return this.idbDelete('playlists', id); },

    // Supprime une chanson de tous les storages
    async deleteSong(id) {
        await this.idbDelete('songs', id);
        if (this.opfsSupported) await this.opfsDeleteAudio(id);
        this._removeMetaFromLocalStorage(id);
    },

    // Miroir localStorage pour les métadonnées (sans audio)
    _syncMetaToLocalStorage(meta) {
        try {
            const key = 'mp_meta_' + meta.id;
            const { audioData, thumbnailBlob, ...safeMeta } = meta;
            localStorage.setItem(key, JSON.stringify(safeMeta));
            // Garder un index des IDs
            const ids = JSON.parse(localStorage.getItem('mp_song_ids') || '[]');
            if (!ids.includes(meta.id)) {
                ids.push(meta.id);
                localStorage.setItem('mp_song_ids', JSON.stringify(ids));
            }
        } catch (e) { /* localStorage plein — ignorer */ }
    },

    _removeMetaFromLocalStorage(id) {
        try {
            localStorage.removeItem('mp_meta_' + id);
            const ids = JSON.parse(localStorage.getItem('mp_song_ids') || '[]');
            localStorage.setItem('mp_song_ids', JSON.stringify(ids.filter(i => i !== id)));
        } catch (e) { /* ignorer */ }
    },

    _loadMetaFromLocalStorage() {
        try {
            const ids = JSON.parse(localStorage.getItem('mp_song_ids') || '[]');
            return ids.map(id => {
                try { return JSON.parse(localStorage.getItem('mp_meta_' + id)); } catch { return null; }
            }).filter(Boolean);
        } catch { return []; }
    },

    // Migration automatique des anciennes données IndexedDB (audioData dans IDB) → OPFS
    async migrateToOPFS() {
        if (!this.opfsSupported || !this.idbAvailable) return;
        if (localStorage.getItem('mp_opfs_migrated') === '2') return;

        console.log('[Storage] Vérification migration OPFS...');
        try {
            const songs = await this.idbGetAll('songs');
            let migrated = 0;
            for (const song of songs) {
                if (song.audioData && song.storageType !== 'opfs') {
                    await this.opfsSaveAudio(song.id, song.audioData);
                    const { audioData, thumbnailBlob, ...meta } = song;
                    meta.storageType = 'opfs';
                    // Ré-enregistrer la miniature séparément si existante
                    if (thumbnailBlob) meta.thumbnailBlob = thumbnailBlob;
                    await this.idbSave('songs', meta);
                    this._syncMetaToLocalStorage(meta);
                    migrated++;
                } else {
                    this._syncMetaToLocalStorage(song);
                }
            }
            if (migrated > 0) console.log(`[Storage] Migration OPFS terminée : ${migrated} fichier(s) migré(s)`);
            localStorage.setItem('mp_opfs_migrated', '2');
        } catch (e) {
            console.warn('[Storage] Migration OPFS partielle ou échouée:', e);
        }
    }
};

// Alias db → storage pour compatibilité avec le code existant
const db = {
    get instance() { return storage.idbInstance; },
    init: () => storage.idbInit(),
    getAll: (s) => storage.idbGetAll(s),
    save: (s, item) => storage.idbSave(s, item),
    delete: (s, key) => storage.idbDelete(s, key)
};

// ----------------------------------------------------
// 2. HELPER FUNCTIONS
// ----------------------------------------------------

// Format seconds into MM:SS
function formatTime(secs) {
    if (isNaN(secs)) return '0:00';
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Escape HTML to prevent broken layout from special characters in titles
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// Sanitize filename for export (iPhone Files app)
function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|#%&{}$!'`@+=]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function buildExportFilename(song) {
    const title = sanitizeFilename(song.title);
    const artist = sanitizeFilename(song.artist);
    return `${artist} - ${title}.m4a`;
}

// Toast notification helper
function showToast(message, type = 'info', duration = 3500) {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Toggle clear button visibility on inputs
function updateClearButton(inputEl, clearBtn) {
    if (!inputEl || !clearBtn) return;
    clearBtn.classList.toggle('hidden', inputEl.value.trim() === '');
}

// Update repeat mode visual state
function updateRepeatUI() {
    el.repeatBtn.classList.remove('active', 'repeat-one');
    el.repeatBadge.classList.add('hidden');
    el.repeatBtn.style.color = '';
    el.repeatBtn.style.opacity = '';

    if (state.isRepeat === 'all') {
        el.repeatBtn.classList.add('active');
    } else if (state.isRepeat === 'one') {
        el.repeatBtn.classList.add('active', 'repeat-one');
        el.repeatBadge.classList.remove('hidden');
    }

    localStorage.setItem('mervyplayer-repeat', state.isRepeat);
}

// Poll server download progress during yt-dlp extraction
async function pollDownloadProgress(videoId, progressFill, progressText, onProgress, signal) {
    let attempts = 0;
    const maxAttempts = 600;

    while (attempts < maxAttempts) {
        if (signal && signal.aborted) return;
        try {
            const res = await fetch(serverConfig.apiUrl(`/api/download-status?id=${videoId}`), { signal });
            if (res.ok) {
                const data = await res.json();
                const serverPercent = Math.min(35, Math.max(5, Math.round(data.percent * 0.35)));
                if (progressFill) progressFill.style.width = `${serverPercent}%`;
                if (progressText && data.message) progressText.textContent = data.message;
                if (onProgress) onProgress(data);

                if (data.status === 'ready' || data.percent >= 100) return;
                if (data.status === 'error') throw new Error(data.message || 'Échec du téléchargement');
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            if (e.message && e.message.includes('Échec')) throw e;
        }

        await new Promise(r => setTimeout(r, 500));
        attempts++;
    }
}

// Convert Blob/File to ArrayBuffer
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// Function to handle local file imports
async function handleImportLocalFiles(files) {
    if (!files || files.length === 0) return;
    
    showToast(`Import de ${files.length} fichier(s) en cours...`, 'info');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const file of files) {
        // Validate that file is an audio file (to support accept="*/*" on iOS)
        const isAudio = file.type.startsWith('audio/') || 
                        /\.(mp3|m4a|wav|mp4|aac|caf|flac|ogg)$/i.test(file.name);
        if (!isAudio) {
            console.warn('Skipping non-audio file:', file.name);
            failCount++;
            continue;
        }

        try {
            // Read file to ArrayBuffer
            const arrayBuffer = await fileToArrayBuffer(file);
            
            // Extract filename info (split by dash if present)
            // Remove extension first
            const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            let artist = 'Artiste Inconnu';
            let title = nameWithoutExt;
            
            const dashIndex = nameWithoutExt.indexOf('-');
            if (dashIndex !== -1) {
                artist = nameWithoutExt.substring(0, dashIndex).trim();
                title = nameWithoutExt.substring(dashIndex + 1).trim();
            }
            
            // Get duration using Web Audio API OfflineAudioContext
            let duration = 0;
            try {
                duration = await getAudioDuration(arrayBuffer);
            } catch (e) {
                console.warn('Could not extract audio duration dynamically, defaulting to 0:', e);
            }
            
            // Generate unique local ID
            const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const localSong = {
                id: localId,
                title: title,
                artist: artist,
                duration: duration,
                audioData: arrayBuffer,
                thumbnailBlob: null,
                createdAt: Date.now()
            };
            
            // Save to database
            await db.save('songs', localSong);
            state.songs.push(localSong);
            successCount++;
        } catch (err) {
            console.error('Failed to import file:', file.name, err);
            failCount++;
        }
    }
    
    // Refresh library and UI
    ui.renderLibraryList();
    
    if (successCount > 0) {
        showToast(`${successCount} morceau(x) importé(s) avec succès !`, 'success');
    }
    if (failCount > 0) {
        showToast(`${failCount} fichier(s) non importé(s) due à une erreur.`, 'error');
    }
    
    // Clear input value so same files can be re-imported if needed
    el.importFileInput.value = '';
}

// Robust duration extraction using OfflineAudioContext (no user gesture required on iOS)
function getAudioDuration(arrayBuffer) {
    return new Promise((resolve) => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            resolve(0);
            return;
        }
        try {
            const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
            ctx.decodeAudioData(arrayBuffer.slice(0), (buffer) => {
                resolve(buffer.duration);
            }, (err) => {
                console.warn('Web Audio decode failed:', err);
                resolve(0);
            });
        } catch (e) {
            console.warn('Web Audio OfflineAudioContext failed:', e);
            resolve(0);
        }
    });
}

// Create object URL from stored thumbnail Blob or use online url
function getThumbnailUrl(song) {
    if (song.isOnline && song.thumbnail) {
        return song.thumbnail;
    }
    if (song.thumbnailBlob) {
        return URL.createObjectURL(song.thumbnailBlob);
    }
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%23221a36"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="%23a855f7" font-size="64">🎵</text></svg>';
}

// Dismiss splash screen with fade-out animation
function dismissSplash(minDurationMs = 2200) {
    return new Promise((resolve) => {
        if (!el.splashScreen) {
            resolve();
            return;
        }

        const elapsed = Date.now() - (window.__splashStart || Date.now());
        const remaining = Math.max(0, minDurationMs - elapsed);

        setTimeout(() => {
            el.splashScreen.classList.add('splash-exit');
            setTimeout(() => {
                el.splashScreen.remove();
                resolve();
            }, 650);
        }, remaining);
    });
}

// ----------------------------------------------------
// 3. MOTEUR AUDIO — Lecture, file d'attente, repeat/shuffle
// ----------------------------------------------------
let currentBlobUrl = null;

const audioPlayer = {
    async load(song) {
        // Release previous Blob URL to prevent memory leaks
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        try {
            if (song.isOnline) {
                // Play directly from YouTube live streaming API (uses serverConfig for dynamic IP)
                el.audio.src = serverConfig.apiUrl(`/api/stream-youtube?id=${song.id}`);
            } else {
                // Charge l'audio depuis OPFS ou IDB selon le type de stockage
                let audioData = song.audioData;
                if (!audioData || song.storageType === 'opfs') {
                    audioData = await storage.getAudio(song);
                }
                if (!audioData) {
                    throw new Error('Fichier audio introuvable dans le stockage local.');
                }
                const blob = new Blob([audioData], { type: 'audio/mp4' });
                currentBlobUrl = URL.createObjectURL(blob);
                el.audio.src = currentBlobUrl;
            }
        } catch (e) {
            console.error('[Player] Erreur chargement audio:', e);
            showToast('Impossible de charger ce morceau. ' + (e.message || ''), 'error', 4000);
        }
    },

    updatePlayerUIAndMetadata(song) {
        try {
            if (song.duration > 0) {
                updateProgressUI(0, song.duration);
            } else {
                el.playerProgressSlider.value = 0;
                el.playerProgressSlider.max = 100;
                el.playerProgressFill.style.width = '0%';
                el.floatingProgressTiny.style.width = '0%';
                el.playerTimeCurrent.textContent = '0:00';
                el.playerTimeDuration.textContent = '0:00';
                if (el.scrubberTrackWrap) {
                    el.scrubberTrackWrap.style.setProperty('--progress', '0%');
                }
            }
            
            // Update UI elements
            el.playerTrackTitle.textContent = song.title;
            el.playerTrackArtist.textContent = song.artist;
            el.floatingTitle.innerHTML = `<span class="marquee">${song.title}</span>`;
            el.floatingArtist.textContent = song.artist;
            
            const coverUrl = getThumbnailUrl(song);
            el.playerCoverArt.src = coverUrl;
            el.floatingThumbnail.src = coverUrl;
            
            // Favorite Button state
            if (state.favorites.has(song.id)) {
                el.favoriteBtn.classList.add('active');
            } else {
                el.favoriteBtn.classList.remove('active');
            }
            
            // Show Mini Player
            el.floatingPlayer.classList.remove('hidden');
            
            // Media Session updates (iOS lock screen)
            mediaSession.update(song, coverUrl);
            
        } catch (e) {
            console.error('Error updating player UI/metadata:', e);
        }
    },

    play() {
        if (!el.audio.src) return;
        el.audio.play().then(() => {
            state.isPlaying = true;
            this.updateUI();
            mediaSession.updatePlaybackState('playing');
        }).catch(err => {
            console.warn('Playback error (typically requires user gesture):', err);
        });
    },

    pause() {
        el.audio.pause();
        state.isPlaying = false;
        this.updateUI();
        mediaSession.updatePlaybackState('paused');
    },

    togglePlay() {
        if (state.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    },

    prev() {
        if (state.currentQueue.length === 0) return;
        
        // If song is past 3 seconds, restart it instead of prev
        if (el.audio.currentTime > 3) {
            el.audio.currentTime = 0;
            return;
        }

        let nextIndex;
        if (state.isShuffle && state.currentQueue.length > 1) {
            nextIndex = Math.floor(Math.random() * state.currentQueue.length);
            if (nextIndex === state.currentIndex) {
                nextIndex = (nextIndex + 1) % state.currentQueue.length;
            }
        } else {
            nextIndex = state.currentIndex - 1;
        }
        
        if (nextIndex < 0 || nextIndex >= state.currentQueue.length) {
            nextIndex = state.isRepeat === 'all' ? state.currentQueue.length - 1 : 0;
        }

        this.playQueueIndex(nextIndex);
    },

    next() {
        if (state.currentQueue.length === 0) return;
        
        let nextIndex;
        if (state.isShuffle && state.currentQueue.length > 1) {
            nextIndex = Math.floor(Math.random() * state.currentQueue.length);
            if (nextIndex === state.currentIndex) {
                nextIndex = (nextIndex + 1) % state.currentQueue.length;
            }
        } else {
            nextIndex = state.currentIndex + 1;
        }
        
        if (nextIndex >= state.currentQueue.length || nextIndex < 0) {
            if (state.isRepeat === 'all') {
                nextIndex = 0;
            } else {
                this.pause();
                el.audio.currentTime = 0;
                return;
            }
        }

        this.playQueueIndex(nextIndex);
    },

    async playQueueIndex(index) {
        if (index < 0 || index >= state.currentQueue.length) return;
        state.currentIndex = index;
        const song = state.currentQueue[index];
        await this.load(song); // await OPFS/IDB async load
        this.play();
        this.updatePlayerUIAndMetadata(song);
        ui.renderLibraryList(); // update active styling in lists
        if (state.activePlaylistId) ui.renderPlaylistDetail(state.activePlaylistId);
    },

    setQueue(songsList, startIndex = 0) {
        state.currentQueue = [...songsList];
        this.playQueueIndex(startIndex);
    },

    updateUI() {
        if (state.isPlaying) {
            // Update Play/Pause button icons
            el.playPath.setAttribute('d', ICONS.pause);
            el.floatingPlayPath.setAttribute('d', ICONS.pause);
            el.playerCoverArt.style.animationPlayState = 'running';
            el.visualizerBars.classList.add('playing');
        } else {
            el.playPath.setAttribute('d', ICONS.play);
            el.floatingPlayPath.setAttribute('d', ICONS.play);
            el.playerCoverArt.style.animationPlayState = 'paused';
            el.visualizerBars.classList.remove('playing');
        }

        // Reset active layout state in lists
        const currentSong = state.currentQueue[state.currentIndex];
        highlightCurrentTrack(currentSong);
    }
};

// ----------------------------------------------------
// 4. iOS LOCK SCREEN (MEDIA SESSION API)
// ----------------------------------------------------
const mediaSession = {
    update(song, coverUrl) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.title,
                artist: song.artist,
                album: 'MervyPlayer Offline',
                artwork: [
                    { src: coverUrl, sizes: '300x300', type: 'image/jpeg' },
                    { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
                ]
            });
            // Re-bind action handlers every time track changes (critical workaround for iOS WebKit)
            this.init();
            this.updatePosition();
        }
    },

    updatePlaybackState(status) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = status;
        }
    },

    updatePosition() {
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            const song = state.currentQueue[state.currentIndex];
            const duration = getPlaybackDuration(song?.duration);
            if (duration > 0 && isFinite(duration) && !isNaN(el.audio.currentTime)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: duration,
                        playbackRate: el.audio.playbackRate || 1.0,
                        position: Math.max(0, Math.min(el.audio.currentTime, duration))
                    });
                } catch (e) {
                    console.warn('Failed to set mediaSession position state:', e);
                }
            }
        }
    },

    init() {
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
                navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
                navigator.mediaSession.setActionHandler('previoustrack', () => audioPlayer.prev());
                navigator.mediaSession.setActionHandler('nexttrack', () => audioPlayer.next());
                
                // Seek action handlers
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (details.fastSeek && el.audio.fastSeek) {
                        el.audio.fastSeek(details.seekTime);
                    } else {
                        el.audio.currentTime = details.seekTime;
                    }
                    this.updatePosition();
                });
            } catch (e) {
                console.warn('Failed to bind MediaSession handlers:', e);
            }
        }
    }
};

// Durée effective du morceau (priorité au fallback qui est la durée théorique correcte)
function getPlaybackDuration(fallback = 0) {
    if (fallback > 0) return fallback;
    const d = el.audio.duration;
    if (!isNaN(d) && isFinite(d) && d > 0) return d;
    return 0;
}

// Synchronise barre, fill, mini-player et labels de temps
function updateProgressUI(currentTime, duration) {
    if (!duration || duration <= 0 || !isFinite(duration)) return;

    currentTime = Math.max(0, Math.min(currentTime, duration));
    const percent = (currentTime / duration) * 100;

    el.playerProgressSlider.max = duration;
    el.playerProgressSlider.value = currentTime;
    el.playerProgressFill.style.width = `${percent}%`;
    el.floatingProgressTiny.style.width = `${percent}%`;
    el.playerTimeCurrent.textContent = formatTime(currentTime);
    el.playerTimeDuration.textContent = formatTime(duration);

    if (el.scrubberTrackWrap) {
        el.scrubberTrackWrap.style.setProperty('--progress', `${percent}%`);
    }
}

// Crée une ligne style Audiomack (bibliothèque / playlists)
function createAudiomackRow(song, index, options = {}) {
    const { mode = 'library', isPlaying = false } = options;
    const row = document.createElement('div');
    row.className = `am-row${isPlaying ? ' is-playing' : ''}`;
    row.id = `${mode}-track-${song.id}`;
    row.dataset.songId = song.id;

    const thumbUrl = getThumbnailUrl(song);
    const eqBars = `
        <span class="am-eq" aria-hidden="true">
            <span></span><span></span><span></span>
        </span>`;

    let menuItems = '';
    if (mode === 'library') {
        menuItems = `
            <button type="button" class="am-menu-item track-add-pl-btn">Ajouter à une playlist</button>
            <button type="button" class="am-menu-item track-export-btn">Exporter</button>
            <button type="button" class="am-menu-item danger track-delete-btn">Supprimer</button>
        `;
    } else {
        menuItems = `
            <button type="button" class="am-menu-item danger track-remove-btn">Retirer de la playlist</button>
        `;
    }

    row.innerHTML = `
        <button type="button" class="am-row-play track-play-btn" aria-label="Écouter ${escapeHtml(song.title)}">
            <img class="am-row-cover" src="${thumbUrl}" alt="" loading="lazy">
            ${eqBars}
        </button>
        <div class="am-row-info track-play-btn">
            <div class="am-row-title">${escapeHtml(song.title)}</div>
            <div class="am-row-artist">${escapeHtml(song.artist)}</div>
        </div>
        <span class="am-row-duration">${formatTime(song.duration)}</span>
        <button type="button" class="am-row-more" aria-label="Options">
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
        </button>
        <div class="am-row-menu hidden">${menuItems}</div>
    `;

    const moreBtn = row.querySelector('.am-row-more');
    const menu = row.querySelector('.am-row-menu');
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.am-row-menu').forEach(m => {
            if (m !== menu) m.classList.add('hidden');
        });
        menu.classList.toggle('hidden');
    });

    return row;
}

// Ferme les menus contextuels des lignes
function closeAudiomackMenus() {
    document.querySelectorAll('.am-row-menu').forEach(m => m.classList.add('hidden'));
}

// Met en surbrillance la piste en cours dans toutes les listes
function highlightCurrentTrack(currentSong) {
    document.querySelectorAll('.track-card, .search-result-card, .am-row').forEach(card => {
        card.classList.remove('is-playing', 'is-streaming');
    });

    if (!currentSong) return;

    const ids = [
        `library-track-${currentSong.id}`,
        `playlist-track-${currentSong.id}`,
        `search-item-${currentSong.id}`
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('is-playing');
            if (currentSong.isOnline) el.classList.add('is-streaming');
        }
    });
}

// ----------------------------------------------------
// 5. INTERFACE — Rendu des listes, recherche, bibliothèque
// ----------------------------------------------------
const ui = {
    // Navigation Tabs Toggle
    switchTab(tabId) {
        state.activeTab = tabId;
        
        el.tabs.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        el.tabContents.forEach(content => {
            if (content.id === `tab-${tabId}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
        
        // Hide playlist details when switching tabs
        if (tabId !== 'playlists') {
            el.playlistDetailView.classList.add('hidden');
            state.activePlaylistId = null;
        }
    },

    // Render Search Results from YouTube
    renderSearchResults(results) {
        el.searchResultsList.innerHTML = '';

        if (results.length === 0) {
            el.searchResultsPanel.classList.add('hidden');
            el.searchResultsPlaceholder.classList.remove('hidden');
            el.searchResultsPlaceholder.innerHTML = `
                <svg viewBox="0 0 24 24" width="56" height="56" class="empty-icon">
                    <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <p>Aucun résultat trouvé. Essayez un autre mot-clé.</p>
            `;
            return;
        }

        el.searchResultsPlaceholder.classList.add('hidden');
        el.searchResultsPanel.classList.remove('hidden');
        el.searchResultsCount.textContent = `${results.length} résultat${results.length > 1 ? 's' : ''}`;

        results.forEach((item, index) => {
            const card = document.createElement('article');
            const isCurrent = state.currentQueue[state.currentIndex]?.id === item.id;
            const isStreaming = isCurrent && state.currentQueue[state.currentIndex]?.isOnline;
            const inLibrary = state.songs.some(s => s.id === item.id);

            card.className = `search-result-card${isCurrent ? ' is-playing' : ''}${isStreaming ? ' is-streaming' : ''}${inLibrary ? ' is-imported' : ''}`;
            card.id = `search-item-${item.id}`;

            card.innerHTML = `
                <div class="search-result-row">
                    <button type="button" class="search-thumb-btn play-preview-btn" aria-label="Écouter ${escapeHtml(item.title)}">
                        <img class="search-thumb" src="${item.thumbnail}" alt="" loading="lazy">
                        <span class="search-thumb-play">
                            <svg viewBox="0 0 24 24" width="20" height="20">
                                <path fill="currentColor" d="M8 5v14l11-7z"/>
                            </svg>
                        </span>
                    </button>
                    <div class="search-result-info">
                        <span class="search-result-rank">${index + 1}</span>
                        <div class="search-result-text">
                            <h4 class="search-result-title">${escapeHtml(item.title)}</h4>
                            <p class="search-result-artist">${escapeHtml(item.artist)}</p>
                        </div>
                    </div>
                </div>
                <div class="search-result-footer" id="actions-${item.id}">
                    <div class="search-result-meta">
                        <span class="search-result-duration">${formatTime(item.duration)}</span>
                        ${inLibrary
                            ? '<span class="search-status-badge imported">Importé</span>'
                            : '<span class="search-status-badge preview">Aperçu dispo</span>'}
                    </div>
                    <div class="search-result-actions">
                        <button type="button" class="search-action-btn play-btn play-preview-btn" title="Écouter">
                            <svg viewBox="0 0 24 24" width="15" height="15">
                                <path fill="currentColor" d="M8 5v14l11-7z"/>
                            </svg>
                            <span>Écouter</span>
                        </button>
                        ${inLibrary ? `
                            <span class="search-imported-icon" title="Déjà dans MervyPlayer">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                            </span>
                        ` : `
                            <button type="button" class="search-action-btn download-btn download-action-btn" title="Télécharger">
                                <svg viewBox="0 0 24 24" width="15" height="15">
                                    <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                                </svg>
                                <span>Télécharger</span>
                            </button>
                        `}
                    </div>
                </div>
                <div class="search-download-progress hidden" id="progress-container-${item.id}">
                    <div class="search-download-fill" id="progress-fill-${item.id}"></div>
                    <span class="search-download-label" id="progress-text-${item.id}">En cours...</span>
                    <button type="button" class="cancel-download-btn" id="cancel-btn-${item.id}" style="float: right; margin-top: -18px; position: relative; z-index: 10; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; cursor: pointer;">Annuler</button>
                </div>
            `;

            card.querySelectorAll('.play-preview-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handlePlaySearchSong(item, results);
                });
            });

            const downloadBtn = card.querySelector('.download-action-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDownload(item);
                });
            }

            const cancelBtn = card.querySelector('.cancel-download-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleCancelDownload(item.id);
                });
            }

            el.searchResultsList.appendChild(card);
        });
    },

    // Play song directly from YouTube search list (live streaming preview)
    handlePlaySearchSong(track, resultsList) {
        // Check if already in local library
        const localCopy = state.songs.find(s => s.id === track.id);
        if (localCopy) {
            // Load and play locally
            audioPlayer.setQueue(state.songs, state.songs.indexOf(localCopy));
            return;
        }

        // Otherwise, construct temporary queue resolving online status
        const tempQueue = resultsList.map(item => {
            const local = state.songs.find(s => s.id === item.id);
            if (local) return local;
            return {
                id: item.id,
                title: item.title,
                artist: item.artist,
                duration: item.duration,
                thumbnail: item.thumbnail,
                isOnline: true
            };
        });

        const activeIdx = tempQueue.findIndex(item => item.id === track.id);
        audioPlayer.setQueue(tempQueue, activeIdx !== -1 ? activeIdx : 0);
    },

    // YouTube Search/Download Orchestration
    async handleDownload(track) {
        const actions = document.getElementById(`actions-${track.id}`);
        const progressContainer = document.getElementById(`progress-container-${track.id}`);
        const progressFill = document.getElementById(`progress-fill-${track.id}`);
        const progressText = document.getElementById(`progress-text-${track.id}`);
        
        if (actions) actions.classList.add('hidden');
        if (progressContainer) progressContainer.classList.remove('hidden');
        
        const controller = new AbortController();
        const signal = controller.signal;
        activeDownloadAbortControllers.set(track.id, controller);

        try {
            progressFill.style.width = '5%';
            progressText.textContent = 'Connexion à YouTube...';
            
            const downloadPromise = fetch(serverConfig.apiUrl(`/api/download?id=${track.id}`), { signal })
                .then(async (r) => {
                    const data = await r.json();
                    if (!r.ok || data.error) throw new Error(data.error || 'Téléchargement échoué');
                    return data;
                });

            await Promise.all([
                downloadPromise,
                pollDownloadProgress(track.id, progressFill, progressText, null, signal)
            ]);
            
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            progressFill.style.width = '40%';
            progressText.textContent = 'Transfert vers iPhone...';
            
            const fileResponse = await fetch(serverConfig.apiUrl(`/api/stream?id=${track.id}`), { signal });
            if (!fileResponse.ok) throw new Error("Fichier non disponible");
            
            const reader = fileResponse.body.getReader();
            const contentLength = +fileResponse.headers.get('Content-Length') || 8000000;
            
            let receivedLength = 0;
            let chunks = [];
            
            while (true) {
                if (signal.aborted) {
                    reader.cancel();
                    throw new DOMException('Aborted', 'AbortError');
                }
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                receivedLength += value.length;
                
                const percent = 40 + Math.round((receivedLength / contentLength) * 45);
                progressFill.style.width = `${percent}%`;
                progressText.textContent = `Transfert : ${percent}%`;
            }
            
            const audioBlob = new Blob(chunks, { type: 'audio/mp4' });
            const audioArrayBuffer = await fileToArrayBuffer(audioBlob);
            
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            progressFill.style.width = '90%';
            progressText.textContent = 'Enregistrement miniature...';
            let thumbnailBlob = null;
            try {
                const thumbRes = await fetch(serverConfig.apiUrl(`/api/proxy-thumbnail?url=${encodeURIComponent(track.thumbnail)}`), { signal });
                if (thumbRes.ok) thumbnailBlob = await thumbRes.blob();
            } catch (e) {
                if (e.name === 'AbortError') throw e;
                console.warn('Thumbnail download failed', e);
            }
            
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            progressFill.style.width = '98%';
            progressText.textContent = 'Sauvegarde dans MervyPlayer...';
            
            let duration = track.duration;
            if (!duration || duration <= 0) {
                try {
                    duration = await getAudioDuration(audioArrayBuffer);
                } catch (e) {
                    console.warn('Could not decode downloaded audio duration:', e);
                }
            }

            const offlineSong = {
                id: track.id,
                title: track.title,
                artist: track.artist,
                duration: duration || 0,
                audioData: audioArrayBuffer,
                thumbnailBlob: thumbnailBlob,
                createdAt: Date.now()
            };
            
            await storage.saveSong(offlineSong);
            // En mémoire : on garde la référence audio pour la lecture immédiate
            state.songs.push(offlineSong);
            
            activeDownloadAbortControllers.delete(track.id);
            
            progressFill.style.width = '100%';
            progressText.textContent = 'Importé avec succès !';
            showToast(`"${track.title}" ajouté à MervyPlayer`, 'success');
            
            setTimeout(() => {
                if (progressContainer) progressContainer.classList.add('hidden');

                const card = document.getElementById(`search-item-${track.id}`);
                if (card) card.classList.add('is-imported');

                if (actions) {
                    actions.innerHTML = `
                        <div class="search-result-meta">
                            <span class="search-result-duration">${formatTime(track.duration)}</span>
                            <span class="search-status-badge imported">Importé</span>
                        </div>
                        <div class="search-result-actions">
                            <button type="button" class="search-action-btn play-btn play-preview-btn" title="Écouter">
                                <svg viewBox="0 0 24 24" width="15" height="15">
                                    <path fill="currentColor" d="M8 5v14l11-7z"/>
                                </svg>
                                <span>Écouter</span>
                            </button>
                            <span class="search-imported-icon" title="Déjà dans MervyPlayer">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                            </span>
                        </div>
                    `;
                    actions.classList.remove('hidden');
                    actions.querySelector('.play-preview-btn')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const localCopy = state.songs.find(s => s.id === track.id);
                        if (localCopy) audioPlayer.setQueue(state.songs, state.songs.indexOf(localCopy));
                    });
                }
            }, 1500);
            
            this.renderLibraryList();
            
        } catch (error) {
            activeDownloadAbortControllers.delete(track.id);
            
            if (error.name === 'AbortError') {
                console.log('Download aborted for video:', track.id);
                showToast(`Téléchargement annulé`, 'info');
            } else {
                console.error('Download failed:', error);
                showToast(`Erreur : ${error.message}`, 'error', 5000);
            }
            
            if (actions) actions.classList.remove('hidden');
            if (progressContainer) progressContainer.classList.add('hidden');
        }
    },

    // Cancel YouTube download in progress
    async handleCancelDownload(videoId) {
        console.log(`Cancelling download for video: ${videoId}`);
        const controller = activeDownloadAbortControllers.get(videoId);
        if (controller) {
            controller.abort();
            activeDownloadAbortControllers.delete(videoId);
        }
        
        // Update UI immediately (hide progress, show buttons)
        const actions = document.getElementById(`actions-${videoId}`);
        const progressContainer = document.getElementById(`progress-container-${videoId}`);
        if (actions) actions.classList.remove('hidden');
        if (progressContainer) progressContainer.classList.add('hidden');
        
        try {
            await fetch(serverConfig.apiUrl(`/api/cancel-download?id=${videoId}`));
        } catch (e) {
            console.warn('Failed to notify server of cancellation:', e);
        }
    },

    // Render Offline Library Tab
    renderLibraryList() {
        const filter = el.librarySearchInput.value.toLowerCase().trim();
        let filteredSongs = [...state.songs];
        
        if (filter !== '') {
            filteredSongs = state.songs.filter(song => 
                song.title.toLowerCase().includes(filter) || 
                song.artist.toLowerCase().includes(filter)
            );
        }
        
        // Sorting modes logic
        if (state.sortMode === 'recent') {
            filteredSongs.sort((a, b) => b.createdAt - a.createdAt);
        } else if (state.sortMode === 'title') {
            filteredSongs.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
        } else if (state.sortMode === 'artist') {
            filteredSongs.sort((a, b) => a.artist.localeCompare(b.artist, 'fr', { sensitivity: 'base' }));
        }

        el.libraryCount.textContent = `${state.songs.length} titre${state.songs.length > 1 ? 's' : ''}`;
        el.libraryList.innerHTML = '';
        
        if (filteredSongs.length === 0) {
            el.libraryEmpty.classList.remove('hidden');
            if (el.libraryListHeader) el.libraryListHeader.classList.add('hidden');
            return;
        }
        
        el.libraryEmpty.classList.add('hidden');
        if (el.libraryListHeader) {
            el.libraryListHeader.classList.remove('hidden');
            const label = filter
                ? `${filteredSongs.length} sur ${state.songs.length} titre${filteredSongs.length > 1 ? 's' : ''}`
                : `${filteredSongs.length} titre${filteredSongs.length > 1 ? 's' : ''}`;
            if (el.libraryFilterCount) el.libraryFilterCount.textContent = label;
        }

        filteredSongs.forEach((song, idx) => {
            const isCurrent = state.currentQueue[state.currentIndex]?.id === song.id;
            const row = createAudiomackRow(song, idx, { mode: 'library', isPlaying: isCurrent });

            row.querySelectorAll('.track-play-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeAudiomackMenus();
                    audioPlayer.setQueue(filteredSongs, idx);
                });
            });

            row.querySelector('.track-add-pl-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAudiomackMenus();
                this.openAddToPlaylistModal(song.id);
            });

            row.querySelector('.track-export-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAudiomackMenus();
                this.handleExportSong(song);
            });

            row.querySelector('.track-delete-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAudiomackMenus();
                this.handleDeleteSong(song.id);
            });

            el.libraryList.appendChild(row);
        });
    },

    // Export single song to iPhone Files app (MervyPlayer folder)
    async handleExportSong(song, useShare = true) {
        try {
            const blob = new Blob([song.audioData], { type: 'audio/mp4' });
            const filename = buildExportFilename(song);

            if (useShare && navigator.share && navigator.canShare) {
                const file = new File([blob], filename, { type: 'audio/mp4' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: song.title,
                        text: `${song.artist}`
                    });
                    showToast('Morceau exporté !', 'success');
                    return;
                }
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            // Short delay to ensure browser registers the download action before cleaning up
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 500);
            
            showToast(`${filename} exporté !`, 'success');
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('Export failed:', e);
                showToast("Échec de l'exportation : " + song.title, 'error');
            }
        }
    },

    async handleExportAll() {
        if (state.songs.length === 0) {
            showToast('Aucune musique à exporter', 'error');
            return;
        }

        if (typeof JSZip === 'undefined') {
            showToast("Le module d'exportation ZIP n'est pas chargé.", 'error');
            return;
        }

        showToast(`Préparation de l'exportation de ${state.songs.length} morceau(x)...`, 'info', 4000);

        try {
            const zip = new JSZip();
            
            state.songs.forEach(song => {
                const filename = buildExportFilename(song);
                // Add the file binary data into the ZIP
                zip.file(filename, song.audioData);
            });

            showToast("Génération de l'archive ZIP...", 'info', 3000);
            
            // Generate ZIP buffer
            const content = await zip.generateAsync({ type: 'blob' });
            const zipFilename = 'MervyPlayer_Export.zip';

            // Use Web Share API if supported (especially important on iOS Standalone PWA where direct downloads reload/crash the app)
            if (navigator.share && navigator.canShare) {
                try {
                    const file = new File([content], zipFilename, { type: 'application/zip' });
                    if (navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'MervyPlayer Export',
                            text: `Exportation de ma bibliothèque (${state.songs.length} morceaux)`
                        });
                        showToast('Exportation ZIP réussie !', 'success', 5000);
                        return;
                    }
                } catch (shareError) {
                    // AbortError is thrown if the user cancels the share sheet, which we should ignore
                    if (shareError.name === 'AbortError') {
                        console.log('User cancelled sharing the ZIP file');
                        return;
                    }
                    console.warn('Web Share failed, falling back to download:', shareError);
                }
            }
            
            // Fallback for desktop / browsers that do not support navigator.share
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFilename;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 1000);

            showToast('Exportation ZIP réussie ! Touchez le ZIP dans l\'app Fichiers pour extraire vos musiques.', 'success', 6000);
        } catch (error) {
            console.error('ZIP generation failed:', error);
            showToast("Échec de la création de l'archive ZIP", 'error');
        }
    },

    // Delete Song confirmation and actions
    async handleDeleteSong(songId) {
        if (confirm('Voulez-vous vraiment supprimer ce morceau de votre iPhone ?')) {
            try {
                // Delete from all storages (OPFS + IDB + localStorage)
                await storage.deleteSong(songId);
                
                // Remove from state list
                state.songs = state.songs.filter(s => s.id !== songId);
                
                // Clean from playlists references
                state.playlists.forEach(async (playlist) => {
                    if (playlist.songIds.includes(songId)) {
                        playlist.songIds = playlist.songIds.filter(id => id !== songId);
                        await storage.savePlaylist(playlist);
                    }
                });

                // Stop playback if playing the deleted song
                const currentPlaying = state.currentQueue[state.currentIndex];
                if (currentPlaying && currentPlaying.id === songId) {
                    audioPlayer.pause();
                    el.audio.src = '';
                    el.floatingPlayer.classList.add('hidden');
                    state.currentQueue = [];
                    state.currentIndex = -1;
                }

                this.renderLibraryList();
                this.renderPlaylistsGrid();
                
            } catch (err) {
                console.error('Delete failed:', err);
                alert('Erreur lors de la suppression.');
            }
        }
    },

    // Render Playlist Tab grid list
    renderPlaylistsGrid() {
        el.playlistsGrid.innerHTML = '';
        
        if (state.playlists.length === 0) {
            el.playlistsEmpty.classList.remove('hidden');
            return;
        }
        
        el.playlistsEmpty.classList.add('hidden');

        state.playlists.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'playlist-card';

            const firstSong = pl.songIds.length
                ? state.songs.find(s => s.id === pl.songIds[0])
                : null;
            const artContent = firstSong
                ? `<img src="${getThumbnailUrl(firstSong)}" alt="" class="playlist-art-img">`
                : `<span class="playlist-art-emoji">🎶</span>`;

            card.innerHTML = `
                <div class="playlist-art">${artContent}</div>
                <div class="playlist-name">${escapeHtml(pl.name)}</div>
                <div class="playlist-count">${pl.songIds.length} morceau${pl.songIds.length > 1 ? 's' : ''}</div>
            `;
            
            card.addEventListener('click', () => {
                this.renderPlaylistDetail(pl.id);
            });

            el.playlistsGrid.appendChild(card);
        });
    },

    // Open detailed view of selected Playlist
    renderPlaylistDetail(playlistId) {
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        state.activePlaylistId = playlistId;
        el.playlistDetailTitle.textContent = playlist.name;
        el.playlistDetailCount.textContent = `${playlist.songIds.length} morceau${playlist.songIds.length > 1 ? 's' : ''}`;

        const playlistSongs = playlist.songIds
            .map(id => state.songs.find(song => song.id === id))
            .filter(Boolean);

        const largeArt = document.querySelector('.playlist-large-art');
        if (largeArt) {
            if (playlistSongs.length > 0) {
                largeArt.innerHTML = `<img src="${getThumbnailUrl(playlistSongs[0])}" alt="">`;
            } else {
                largeArt.innerHTML = '🎶';
            }
        }

        el.playlistDetailList.innerHTML = '';

        if (playlistSongs.length === 0) {
            el.playlistDetailList.innerHTML = '<div class="empty-state"><p>Cette playlist est vide.</p></div>';
        } else {
            playlistSongs.forEach((song, idx) => {
                const isCurrent = state.currentQueue[state.currentIndex]?.id === song.id;
                const row = createAudiomackRow(song, idx, { mode: 'playlist', isPlaying: isCurrent });

                row.querySelectorAll('.track-play-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        closeAudiomackMenus();
                        audioPlayer.setQueue(playlistSongs, idx);
                    });
                });

                row.querySelector('.track-remove-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeAudiomackMenus();
                    this.handleRemoveSongFromPlaylist(playlist, song.id);
                });

                el.playlistDetailList.appendChild(row);
            });
        }

        // Setup Play All Button
        el.playlistPlayAll.onclick = () => {
            if (playlistSongs.length > 0) {
                audioPlayer.setQueue(playlistSongs, 0);
            }
        };

        // Setup Delete Playlist button
        el.playlistDelete.onclick = async () => {
            if (confirm(`Voulez-vous vraiment supprimer la playlist "${playlist.name}" ?`)) {
                await storage.deletePlaylist(playlist.id);
                state.playlists = state.playlists.filter(p => p.id !== playlist.id);
                el.playlistDetailView.classList.add('hidden');
                state.activePlaylistId = null;
                this.renderPlaylistsGrid();
            }
        };

        el.playlistDetailView.classList.remove('hidden');
    },

    // Remove song from specific playlist
    async handleRemoveSongFromPlaylist(playlist, songId) {
        playlist.songIds = playlist.songIds.filter(id => id !== songId);
        await storage.savePlaylist(playlist);
        this.renderPlaylistDetail(playlist.id);
        this.renderPlaylistsGrid();
    },

    // Playlist Dialog Modal actions
    openAddToPlaylistModal(songId) {
        el.playlistSelectorList.innerHTML = '';
        
        if (state.playlists.length === 0) {
            el.playlistSelectorList.innerHTML = '<p class="empty-state">Veuillez créer une playlist d\'abord.</p>';
        } else {
            state.playlists.forEach(pl => {
                const item = document.createElement('div');
                item.className = 'modal-list-item';
                item.textContent = pl.name;
                item.addEventListener('click', async () => {
                    // Check if already in playlist
                    if (!pl.songIds.includes(songId)) {
                        pl.songIds.push(songId);
                        await storage.savePlaylist(pl);
                        this.renderPlaylistsGrid();
                        alert(`Ajouté à "${pl.name}"`);
                    } else {
                        alert(`Ce morceau est déjà dans la playlist "${pl.name}"`);
                    }
                    el.addToPlaylistModal.classList.add('hidden');
                });
                el.playlistSelectorList.appendChild(item);
            });
        }
        
        el.addToPlaylistModal.classList.remove('hidden');
    }
};

// ----------------------------------------------------
// 6. EVENT LISTENERS SETUP
// ----------------------------------------------------
function setupEventListeners() {
    
    // Tab Clicks
    el.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            ui.switchTab(btn.getAttribute('data-tab'));
        });
    });

    // ---- Panneau Paramètres ----
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsCancelBtn = document.getElementById('settings-cancel-btn');
    const settingsSaveBtn = document.getElementById('settings-save-btn');
    const settingsServerUrl = document.getElementById('settings-server-url');
    const settingsTestBtn = document.getElementById('settings-test-btn');
    const settingsTestResult = document.getElementById('settings-test-result');
    const settingsOpfsBadge = document.getElementById('settings-opfs-badge');
    const settingsIdbBadge = document.getElementById('settings-idb-badge');
    const settingsSongsCount = document.getElementById('settings-songs-count');
    const serverStatusDot = document.getElementById('server-status-dot');

    function openSettingsModal() {
        // Pré-remplir avec l'URL actuelle
        if (settingsServerUrl) settingsServerUrl.value = serverConfig.baseUrl;
        // Afficher le statut du stockage
        if (settingsOpfsBadge) {
            settingsOpfsBadge.textContent = storage.opfsSupported ? '✅ OPFS' : '⚠️ OPFS indispo';
            settingsOpfsBadge.className = 'settings-badge ' + (storage.opfsSupported ? 'ok' : 'fail');
        }
        if (settingsIdbBadge) {
            settingsIdbBadge.textContent = storage.idbAvailable ? '✅ IDB' : '❌ IDB';
            settingsIdbBadge.className = 'settings-badge ' + (storage.idbAvailable ? 'ok' : 'fail');
        }
        if (settingsSongsCount) {
            settingsSongsCount.textContent = `${state.songs.length} morceau${state.songs.length > 1 ? 'x' : ''}`;
        }
        if (settingsTestResult) {
            settingsTestResult.textContent = '';
            settingsTestResult.className = 'settings-test-result';
        }
        if (settingsModal) settingsModal.classList.remove('hidden');
    }

    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
    if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', () => {
        if (settingsModal) settingsModal.classList.add('hidden');
    });

    if (settingsTestBtn && settingsServerUrl && settingsTestResult) {
        settingsTestBtn.addEventListener('click', async () => {
            const url = settingsServerUrl.value.trim().replace(/\/$/, '');
            if (!url) return;
            settingsTestResult.textContent = 'Test en cours...';
            settingsTestResult.className = 'settings-test-result checking';
            try {
                const r = await fetch(url + '/api/ping', { signal: AbortSignal.timeout(4000) });
                if (r.ok) {
                    settingsTestResult.textContent = '✅ Serveur accessible !';
                    settingsTestResult.className = 'settings-test-result ok';
                } else {
                    settingsTestResult.textContent = `❌ Erreur HTTP ${r.status}`;
                    settingsTestResult.className = 'settings-test-result fail';
                }
            } catch (e) {
                settingsTestResult.textContent = '❌ Inaccessible. Vérifiez l\'IP et que le serveur est démarré.';
                settingsTestResult.className = 'settings-test-result fail';
            }
        });
    }

    if (settingsSaveBtn && settingsServerUrl) {
        settingsSaveBtn.addEventListener('click', () => {
            const url = settingsServerUrl.value.trim().replace(/\/$/, '');
            if (url) {
                serverConfig.save(url);
                showToast('URL serveur sauvegardée !', 'success');
            }
            if (settingsModal) settingsModal.classList.add('hidden');
        });
    }

    // Vérification périodique du statut du serveur (toutes les 30s)
    async function checkServerStatus() {
        if (!serverStatusDot) return;
        serverStatusDot.className = 'server-dot checking';
        const ok = await serverConfig.ping();
        serverStatusDot.className = 'server-dot ' + (ok ? 'online' : 'offline');
        serverStatusDot.title = ok
            ? `Serveur connecté : ${serverConfig.baseUrl}`
            : `Serveur hors-ligne. Appuyez sur ⚙️ pour configurer.`;
    }

    // Vérifier au démarrage (après 2s) puis toutes les 30s
    setTimeout(() => {
        checkServerStatus();
        setInterval(checkServerStatus, 30000);
    }, 2000);


    let searchRequestId = 0;
    let searchDebounceTimeout = null;

    async function triggerSearch() {
        const query = el.searchInput.value.trim();
        if (query === '') {
            el.searchResultsList.innerHTML = '';
            el.searchResultsPanel.classList.add('hidden');
            el.searchResultsPlaceholder.classList.remove('hidden');
            return;
        }

        const currentRequestId = ++searchRequestId;

        el.searchResultsPlaceholder.classList.add('hidden');
        el.searchResultsPanel.classList.remove('hidden');
        el.searchResultsList.innerHTML = `
            <div class="search-loading">
                <div class="visualizer-bars playing">
                    <span class="bar bar-1"></span>
                    <span class="bar bar-2"></span>
                    <span class="bar bar-3"></span>
                    <span class="bar bar-4"></span>
                    <span class="bar bar-5"></span>
                </div>
                <p>Recherche sur YouTube...</p>
            </div>
        `;

        try {
            const res = await fetch(serverConfig.apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
            if (!res.ok) throw new Error('Erreur de recherche');

            const data = await res.json();

            // Ignorer si l'utilisateur a tapé autre chose entre-temps
            if (currentRequestId !== searchRequestId) return;

            ui.renderSearchResults(data);
        } catch (error) {
            if (currentRequestId !== searchRequestId) return;

            console.error('Search error:', error);
            el.searchResultsPanel.classList.remove('hidden');
            el.searchResultsPlaceholder.classList.add('hidden');
            el.searchResultsList.innerHTML = `
                <div class="search-error">
                    <p>Serveur inaccessible. Allez dans <strong>⚙️ Paramètres</strong> pour configurer l'IP du serveur.</p>
                    <p style="font-size:0.8em;color:#a855f7;margin-top:6px;">URL actuelle : ${serverConfig.baseUrl}</p>
                </div>
            `;
        }
    }

    el.searchInput.addEventListener('input', () => {
        updateClearButton(el.searchInput, el.searchClearBtn);
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(triggerSearch, 700);
    });

    el.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
            triggerSearch();
        }
    });

    el.searchClearBtn.addEventListener('click', () => {
        el.searchInput.value = '';
        updateClearButton(el.searchInput, el.searchClearBtn);
        el.searchResultsList.innerHTML = '';
        el.searchResultsPanel.classList.add('hidden');
        el.searchResultsPlaceholder.classList.remove('hidden');
        el.searchInput.focus();
    });

    // Library Filtering & Clear
    el.librarySearchInput.addEventListener('input', () => {
        updateClearButton(el.librarySearchInput, el.libraryClearBtn);
        ui.renderLibraryList();
    });

    el.libraryClearBtn.addEventListener('click', () => {
        el.librarySearchInput.value = '';
        updateClearButton(el.librarySearchInput, el.libraryClearBtn);
        ui.renderLibraryList();
    });

    if (el.exportAllBtn) {
        el.exportAllBtn.addEventListener('click', () => ui.handleExportAll());
    }

    if (el.importBtn && el.importFileInput) {
        el.importBtn.addEventListener('click', () => {
            el.importFileInput.click();
        });
        
        el.importFileInput.addEventListener('change', (e) => {
            handleImportLocalFiles(e.target.files);
        });
    }

    if (el.forceUpdateBtn) {
        el.forceUpdateBtn.addEventListener('click', async () => {
            if (confirm("Voulez-vous forcer la mise à jour de l'application ? Cela va vider le cache sans supprimer vos musiques téléchargées.")) {
                showToast("Nettoyage du cache...", "info");
                
                // 1. Unregister all service workers
                if ('serviceWorker' in navigator) {
                    try {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                    } catch (err) {
                        console.error('Failed to unregister SW:', err);
                    }
                }
                
                // 2. Delete all caches
                if (window.caches) {
                    try {
                        const cacheNames = await caches.keys();
                        for (let name of cacheNames) {
                            await caches.delete(name);
                        }
                    } catch (err) {
                        console.error('Failed to clear caches:', err);
                    }
                }
                
                // 3. Reload page
                window.location.reload(true);
            }
        });
    }

    // Library Sorting Selector
    if (el.librarySortSelect) {
        el.librarySortSelect.addEventListener('change', (e) => {
            state.sortMode = e.target.value;
            localStorage.setItem('mervyplayer-sort', state.sortMode);
            ui.renderLibraryList();
        });
    }

    // Create Playlist Modal Open
    el.createPlaylistBtn.addEventListener('click', () => {
        el.playlistModal.classList.remove('hidden');
        el.playlistNameInput.focus();
    });

    el.modalCancelBtn.addEventListener('click', () => {
        el.playlistModal.classList.add('hidden');
        el.playlistNameInput.value = '';
    });

    el.modalCreateBtn.addEventListener('click', async () => {
        const name = el.playlistNameInput.value.trim();
        if (name === '') return;

        const newPlaylist = {
            name: name,
            songIds: [],
            createdAt: Date.now()
        };

        try {
            const id = await storage.savePlaylist(newPlaylist);
            newPlaylist.id = id;
            state.playlists.push(newPlaylist);
            
            el.playlistModal.classList.add('hidden');
            el.playlistNameInput.value = '';
            ui.renderPlaylistsGrid();
        } catch (err) {
            console.error('Create playlist failed:', err);
        }
    });

    el.addToPlaylistCancelBtn.addEventListener('click', () => {
        el.addToPlaylistModal.classList.add('hidden');
    });

    // Playlist Back button
    el.playlistBackBtn.addEventListener('click', () => {
        el.playlistDetailView.classList.add('hidden');
        state.activePlaylistId = null;
    });

    // ---------------- PLAYBACK ACTIONS ----------------
    
    // Play/Pause Action triggers
    el.playPauseBtn.addEventListener('click', () => audioPlayer.togglePlay());
    el.floatingPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent opening drawer
        audioPlayer.togglePlay();
    });

    // Skip controls
    el.nextBtn.addEventListener('click', () => audioPlayer.next());
    el.floatingNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audioPlayer.next();
    });
    
    el.prevBtn.addEventListener('click', () => audioPlayer.prev());

    // Toggle items: Shuffle
    el.shuffleBtn.addEventListener('click', () => {
        state.isShuffle = !state.isShuffle;
        el.shuffleBtn.classList.toggle('active', state.isShuffle);
        localStorage.setItem('mervyplayer-shuffle', state.isShuffle ? '1' : '0');
        showToast(state.isShuffle ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée');
    });

    // Toggle items: Repeat (none → all → one → none)
    el.repeatBtn.addEventListener('click', () => {
        if (state.isRepeat === 'none') {
            state.isRepeat = 'all';
            showToast('Répéter toute la playlist');
        } else if (state.isRepeat === 'all') {
            state.isRepeat = 'one';
            showToast('Répéter ce morceau');
        } else {
            state.isRepeat = 'none';
            showToast('Répétition désactivée');
        }
        updateRepeatUI();
    });

    // Favorite/Heart Toggle
    el.favoriteBtn.addEventListener('click', async () => {
        const currentSong = state.currentQueue[state.currentIndex];
        if (!currentSong) return;

        if (state.favorites.has(currentSong.id)) {
            state.favorites.delete(currentSong.id);
            el.favoriteBtn.classList.remove('active');
            
            // Remove from "Favoris" playlist if it exists
            const favPlaylist = state.playlists.find(p => p.name === 'Favoris');
            if (favPlaylist) {
                favPlaylist.songIds = favPlaylist.songIds.filter(id => id !== currentSong.id);
                await storage.savePlaylist(favPlaylist);
                ui.renderPlaylistsGrid();
            }
        } else {
            state.favorites.add(currentSong.id);
            el.favoriteBtn.classList.add('active');
            
            // Auto add to or create "Favoris" playlist
            let favPlaylist = state.playlists.find(p => p.name === 'Favoris');
            if (!favPlaylist) {
                favPlaylist = { name: 'Favoris', songIds: [], createdAt: Date.now() };
                const id = await storage.savePlaylist(favPlaylist);
                favPlaylist.id = id;
                state.playlists.push(favPlaylist);
            }
            if (!favPlaylist.songIds.includes(currentSong.id)) {
                favPlaylist.songIds.push(currentSong.id);
                await storage.savePlaylist(favPlaylist);
                ui.renderPlaylistsGrid();
            }
        }
    });

    // Add current playing song to playlist from full player
    el.addToPlaylistBtn.addEventListener('click', () => {
        const currentSong = state.currentQueue[state.currentIndex];
        if (currentSong) {
            ui.openAddToPlaylistModal(currentSong.id);
        }
    });

    // ---------------- AUDIO INTERFACE LISTENERS ----------------

    el.audio.addEventListener('loadedmetadata', () => {
        const song = state.currentQueue[state.currentIndex];
        const duration = getPlaybackDuration(song?.duration);
        if (duration > 0) {
            updateProgressUI(el.audio.currentTime, duration);
            mediaSession.updatePosition();
        }
    });

    el.audio.addEventListener('durationchange', () => {
        const song = state.currentQueue[state.currentIndex];
        const duration = getPlaybackDuration(song?.duration);
        if (duration > 0) {
            updateProgressUI(el.audio.currentTime, duration);
            mediaSession.updatePosition();
        }
    });

    el.audio.addEventListener('timeupdate', () => {
        const song = state.currentQueue[state.currentIndex];
        const duration = getPlaybackDuration(song?.duration);
        if (duration > 0) {
            updateProgressUI(el.audio.currentTime, duration);
            mediaSession.updatePosition();

            // iOS Background Suspension Workaround:
            // Trigger transition 0.8 seconds before the song ends while the audio element is still actively playing.
            // This prevents iOS Safari from suspending the JS thread when the audio naturally ends in the background.
            if (song && el.audio.currentTime >= duration - 0.8 && !el.audio.paused) {
                console.log('Transitioning to next track before iOS suspends thread:', song.title);
                if (state.isRepeat === 'one') {
                    el.audio.currentTime = 0;
                    audioPlayer.play();
                } else {
                    audioPlayer.next();
                }
            }
        }
    });

    let isScrubbing = false;

    el.playerProgressSlider.addEventListener('input', (e) => {
        isScrubbing = true;
        const song = state.currentQueue[state.currentIndex];
        const duration = getPlaybackDuration(song?.duration);
        if (duration > 0) {
            updateProgressUI(+e.target.value, duration);
        }
    });

    el.playerProgressSlider.addEventListener('change', (e) => {
        const targetTime = +e.target.value;
        el.audio.currentTime = targetTime;
        isScrubbing = false;
    });

    el.playerProgressSlider.addEventListener('pointerdown', () => { isScrubbing = true; });
    el.playerProgressSlider.addEventListener('pointerup', () => { isScrubbing = false; });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.am-row-more') && !e.target.closest('.am-row-menu')) {
            closeAudiomackMenus();
        }
    });

    // Auto next when track ends
    el.audio.addEventListener('ended', () => {
        if (state.isRepeat === 'one') {
            el.audio.currentTime = 0;
            audioPlayer.play();
        } else {
            audioPlayer.next();
        }
    });

    // Setup Drawer slider toggles (Apple Music Style)
    el.floatingTrigger.addEventListener('click', () => {
        el.fullscreenPlayer.classList.remove('collapsed');
    });

    el.playerCloseBtn.addEventListener('click', () => {
        el.fullscreenPlayer.classList.add('collapsed');
    });
    
    el.playerPullHandle.addEventListener('click', () => {
        el.fullscreenPlayer.classList.add('collapsed');
    });

    // Support swipe down gesture on notch handle to close fullscreen player
    let touchStartY = 0;
    el.playerPullHandle.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    });
    el.playerPullHandle.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        if (currentY - touchStartY > 30) {
            el.fullscreenPlayer.classList.add('collapsed');
        }
    });

    // Auto-recover on foreground resume : re-check IDB + rafraîchir l'UI
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            console.log('[App] Retour au premier plan. Vérification du stockage...');
            if (!storage.idbAvailable || !storage.idbInstance) {
                try {
                    await storage.idbInit();
                    console.log('[App] IDB réouvert avec succès.');
                } catch (e) {
                    console.warn('[App] IDB toujours indisponible, OPFS + localStorage utilisés.');
                }
            }
            // Toujours rafraîchir depuis la source disponible
            try {
                state.songs = await storage.getAllSongs();
                state.playlists = await storage.getAllPlaylists();
                ui.renderLibraryList();
                ui.renderPlaylistsGrid();
            } catch (e) {
                console.error('[App] Erreur au rafraîchissement:', e);
            }
        }
    });

    // Close IndexedDB on pagehide/unload to prevent locking during reloads (crucial iOS workaround)
    window.addEventListener('pagehide', () => {
        if (storage.idbInstance) {
            storage.idbInstance.close();
            storage.idbInstance = null;
            storage.idbAvailable = false;
            console.log('[App] IndexedDB fermée proprement sur pagehide.');
        }
    });
}

// ----------------------------------------------------
// 7. INITIALIZATION BLOCK
// ----------------------------------------------------
async function initApp() {
    window.__splashStart = Date.now();

    // 0. Initialiser la config serveur (URL sauvegardée)
    serverConfig.init();

    // 1. Initialiser les contrôles audio et les listeners
    try {
        mediaSession.init();
        setupEventListeners();
    } catch (e) {
        console.warn('[App] Échec setup audio/listeners:', e);
    }

    // 2. Initialiser le stockage (OPFS + IDB en parallèle)
    await storage.init();

    try {
        // Migration automatique IndexedDB legacy → OPFS (silencieuse)
        await storage.migrateToOPFS();

        // Charger les données
        state.songs = await storage.getAllSongs();
        state.playlists = await storage.getAllPlaylists();

        // Restaurer les favoris
        const favPlaylist = state.playlists.find(p => p.name === 'Favoris');
        if (favPlaylist) {
            favPlaylist.songIds.forEach(id => state.favorites.add(id));
        }

        // Restaurer les préférences joueur
        const savedRepeat = localStorage.getItem('mervyplayer-repeat');
        if (savedRepeat && ['none', 'all', 'one'].includes(savedRepeat)) {
            state.isRepeat = savedRepeat;
            updateRepeatUI();
        }
        if (localStorage.getItem('mervyplayer-shuffle') === '1') {
            state.isShuffle = true;
            el.shuffleBtn.classList.add('active');
        }
        const savedSort = localStorage.getItem('mervyplayer-sort');
        if (savedSort && el.librarySortSelect) {
            state.sortMode = savedSort;
            el.librarySortSelect.value = savedSort;
        }

        // Afficher la bibliothèque
        ui.renderLibraryList();
        ui.renderPlaylistsGrid();

        // Rapport de stockage
        const opfsTag = storage.opfsSupported ? '✅ OPFS' : '⚠️ IDB uniquement';
        const idbTag = storage.idbAvailable ? '✅ IDB' : '❌ IDB indisponible';
        console.log(`[App] Stockage : ${opfsTag} | ${idbTag} | ${state.songs.length} morceau(x) chargé(s)`);

        if (!storage.idbAvailable && !storage.opfsSupported) {
            showToast('⚠️ Stockage hors-ligne limité. Connectez-vous régulièrement.', 'error', 8000);
        } else if (!storage.idbAvailable) {
            showToast('ℹ️ Base de données temporairement indisponible. Musiques OPFS disponibles.', 'info', 5000);
        }

        await dismissSplash(2200);

    } catch (e) {
        console.error('[App] Erreur au démarrage:', e);
        ui.renderLibraryList();
        ui.renderPlaylistsGrid();
        await dismissSplash(800);
        showToast('Erreur de démarrage. Vérifiez les paramètres.', 'error', 6000);
    }
}

// Register Service Worker for PWA Offline loading (register immediately, outside initApp, to prevent database locks)
if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            console.log('Service Worker controller changed. Reloading page...');
            window.location.reload();
        }
    });

    navigator.serviceWorker.register('./sw.js')
        .then(reg => {
            console.log('Service Worker Registered successfully', reg.scope);
            reg.update(); // Force a check for SW updates on launch
        })
        .catch(err => {
            console.error('Service Worker registration failed:', err);
            if (window.location.protocol !== 'https:') {
                console.warn('NOTE: Service Workers require HTTPS on iOS devices to support offline mode.');
            }
        });
} else {
    console.warn('Service Workers are not supported or are blocked by browser settings (CORS / HTTP context).');
}

// Start App when DOM parses
window.addEventListener('DOMContentLoaded', initApp);
