/**
 * MervyPlayer — Serveur backend (Node.js)
 *
 * Rôle : faire le pont entre l'iPhone (PWA) et YouTube via yt-dlp.
 * - Sert les fichiers statiques (HTML, CSS, JS)
 * - Expose des API REST pour recherche, téléchargement et streaming audio
 * - Génère les certificats HTTPS (cert.pem / key.pem) pour iOS
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');

const PORT = 3000;
/** Nombre maximum de vidéos retournées par une recherche YouTube (ytsearchN) */
const SEARCH_LIMIT = 100;
const BIN_DIR = path.join(__dirname, 'bin');
const TEMP_DIR = path.join(__dirname, 'temp');
const YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp.exe');

// Load configuration
let config = {
    cookiesBrowser: 'chrome',
    cookiesFile: '',
    jsRuntime: 'node'
};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
        console.log('Configuration loaded:', config);
    } catch (e) {
        console.error('Error parsing config.json, using defaults:', e.message);
    }
}

/**
 * Builds the array of arguments for yt-dlp, adding JS runtime and cookies configuration.
 */
function getYtdlpArgs(additionalArgs = []) {
    const args = [];
    
    // 1. Add JS Runtime argument to avoid warnings and support format extraction
    if (config.jsRuntime && config.jsRuntime !== 'none') {
        const runtimeValue = config.jsRuntime === 'node' 
            ? `node:${process.execPath}` 
            : config.jsRuntime;
        args.push('--js-runtimes', runtimeValue);
    }
    
    // 2. Add Cookies argument if configured to bypass YouTube's bot detection
    if (config.cookiesFile && fs.existsSync(path.resolve(__dirname, config.cookiesFile))) {
        args.push('--cookies', path.resolve(__dirname, config.cookiesFile));
    } else if (config.cookiesBrowser && config.cookiesBrowser !== 'none') {
        args.push('--cookies-from-browser', config.cookiesBrowser);
    }
    
    return [...args, ...additionalArgs];
}

// Track download progress per video ID
const downloadProgress = new Map();
// Track active yt-dlp child processes for cancellation support
const activeDownloads = new Map();

// Ensure necessary directories exist
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Utility to download a file with redirect handling
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        
        function get(url) {
            https.get(url, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    get(response.headers.location);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
                    return;
                }
                
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }
        
        get(url);
    });
}

// Check and download yt-dlp.exe if missing
async function checkYtdlp() {
    if (!fs.existsSync(YTDLP_PATH)) {
        console.log('--- MervyPlayer Backend Initialization ---');
        console.log('yt-dlp.exe is missing. Downloading the latest version...');
        const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
        try {
            await downloadFile(downloadUrl, YTDLP_PATH);
            console.log('yt-dlp.exe downloaded successfully!');
        } catch (error) {
            console.error('Error downloading yt-dlp.exe:', error.message);
            console.log('Please download it manually from https://github.com/yt-dlp/yt-dlp/releases and place it in the "bin" folder.');
            process.exit(1);
        }
    } else {
        console.log('yt-dlp.exe is ready.');
    }
}

// Get local IP addresses for easy network access
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// Nettoie le dossier temp au démarrage (fichiers audio temporaires)
function cleanTempDir() {
    if (fs.existsSync(TEMP_DIR)) {
        const files = fs.readdirSync(TEMP_DIR);
        for (const file of files) {
            fs.unlinkSync(path.join(TEMP_DIR, file));
        }
        console.log('Temp directory cleaned.');
    }
}

// Mime types for static server
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

/**
 * Génère cert.pem et key.pem (certificat SSL auto-signé).
 * iOS exige HTTPS pour enregistrer le Service Worker (mode PWA offline).
 * key.pem  = clé privée du serveur (ne jamais partager)
 * cert.pem = certificat public présenté au navigateur
 */
function generateCertificates() {
    const keyPath = path.join(__dirname, 'key.pem');
    const certPath = path.join(__dirname, 'cert.pem');
    
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return true;
    }
    
    console.log('Generating self-signed SSL certificates...');
    const opensslPaths = [
        'openssl',
        '"C:\\Program Files\\Git\\usr\\bin\\openssl.exe"',
        '"C:\\Program Files\\Git\\bin\\openssl.exe"'
    ];
    
    for (const openssl of opensslPaths) {
        try {
            const cmd = `${openssl} req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=MervyPlayer"`;
            execSync(cmd, { stdio: 'ignore' });
            console.log('SSL certificates generated successfully using:', openssl);
            return true;
        } catch (e) {
            // try next path
        }
    }
    return false;
}

const { execSync } = require('child_process');

/**
 * Transforme la sortie JSON de yt-dlp en liste de morceaux normalisée.
 * Gère les formats : une ligne par vidéo OU une playlist avec tableau "entries".
 */
function parseYtdlpSearchOutput(stdout) {
    const results = [];
    const seenIds = new Set();

    function addVideo(parsed) {
        if (!parsed || !parsed.id || seenIds.has(parsed.id)) return;

        // yt-dlp renvoie _type "url" en mode flat-playlist (recherche YouTube)
        const typeOk = !parsed._type || parsed._type === 'video' || parsed._type === 'url';
        if (!typeOk) return;

        seenIds.add(parsed.id);
        results.push({
            id: parsed.id,
            title: parsed.title || 'Sans titre',
            artist: parsed.uploader || parsed.channel || parsed.uploader_id || 'Artiste inconnu',
            duration: parsed.duration || 0,
            thumbnail: parsed.thumbnail || `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`
        });
    }

    const lines = stdout.trim().split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);

            // Cas playlist / résultats groupés : extraire chaque entrée
            if (Array.isArray(parsed.entries)) {
                parsed.entries.forEach(addVideo);
            } else {
                addVideo(parsed);
            }
        } catch (e) {
            // Ligne JSON invalide — on ignore
        }
    }

    return results.slice(0, SEARCH_LIMIT);
}

// Démarrage du serveur après vérification de yt-dlp
checkYtdlp().then(() => {
    cleanTempDir();
    
    const useHttps = generateCertificates();
    const requestHandler = (req, res) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const pathname = parsedUrl.pathname;
        
        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        
        
        // ---------------- API ENDPOINTS ----------------
        
        // 0. Ping API: /api/ping (test de connectivité rapide)
        if (pathname === '/api/ping' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ ok: true, time: Date.now() }));
            return;
        }

        // 1. YouTube Search API: /api/search?q=query
        if (pathname === '/api/search' && req.method === 'GET') {
            const query = parsedUrl.searchParams.get('q');
            if (!query) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing query parameter q' }));
                return;
            }
            
            console.log(`Searching YouTube for: "${query}" (max ${SEARCH_LIMIT} results)`);
            
            const args = getYtdlpArgs([
                `ytsearch${SEARCH_LIMIT}:${query}`,
                '--flat-playlist',
                '--dump-json',
                '--no-warnings',
                '--ignore-errors',
                '--playlist-end', String(SEARCH_LIMIT)
            ]);
            
            const child = spawn(YTDLP_PATH, args);
            let stdout = '';
            let stderr = '';
            let responseSent = false;
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', (code) => {
                if (responseSent) return;

                const results = parseYtdlpSearchOutput(stdout);

                // Même si yt-dlp renvoie un code non nul, on affiche les résultats partiels
                if (results.length === 0 && code !== 0) {
                    console.error(`yt-dlp search error (code ${code}):`, stderr);
                    responseSent = true;
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Recherche échouée', details: stderr.slice(0, 200) }));
                    return;
                }

                console.log(`→ ${results.length} résultat(s) pour "${query}"`);
                responseSent = true;
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                    'X-MervyPlayer-Search-Limit': String(SEARCH_LIMIT)
                });
                res.end(JSON.stringify(results));
            });
            return;
        }
        
        // 2. YouTube Audio Download API: /api/download?id=videoId
        if (pathname === '/api/download' && req.method === 'GET') {
            const videoId = parsedUrl.searchParams.get('id');
            if (!videoId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing video id' }));
                return;
            }
            
            const targetPath = path.join(TEMP_DIR, `${videoId}.m4a`);
            
            // Check if already downloaded in temp
            if (fs.existsSync(targetPath)) {
                downloadProgress.set(videoId, { percent: 100, status: 'ready', message: 'Prêt' });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ready', id: videoId }));
                return;
            }
            
            console.log(`Starting download for video ID: ${videoId}`);
            downloadProgress.set(videoId, { percent: 5, status: 'starting', message: 'Connexion à YouTube...' });
            
            // Download format 140 (M4A / AAC 128kbps)
            const args = getYtdlpArgs([
                '-f', '140',
                '--newline',
                '-o', targetPath,
                `https://www.youtube.com/watch?v=` + videoId
            ]);
            
            const child = spawn(YTDLP_PATH, args);
            activeDownloads.set(videoId, child);
            let stderr = '';
            
            child.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                
                const percentMatch = chunk.match(/(\d+(?:\.\d+)?)\s*%/);
                if (percentMatch) {
                    const percent = Math.min(99, parseFloat(percentMatch[1]));
                    downloadProgress.set(videoId, {
                        percent,
                        status: 'downloading',
                        message: `Téléchargement : ${Math.round(percent)}%`
                    });
                }
            });
            
            child.on('close', (code) => {
                activeDownloads.delete(videoId);
                if (code !== 0) {
                    // Check if it was cancelled intentionally
                    const isCancelled = downloadProgress.get(videoId)?.status === 'cancelled';
                    if (isCancelled) {
                        console.log(`yt-dlp download for ID ${videoId} was cancelled by user.`);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Download cancelled' }));
                        return;
                    }
                    console.error(`yt-dlp download error (code ${code}):`, stderr);
                    downloadProgress.set(videoId, { percent: 0, status: 'error', message: 'Échec du téléchargement' });
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Download failed', details: stderr }));
                    return;
                }
                
                console.log(`Download finished for ID: ${videoId}`);
                downloadProgress.set(videoId, { percent: 100, status: 'ready', message: 'Prêt' });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ready', id: videoId }));
            });
            return;
        }

        // 2.5 Download progress polling: /api/download-status?id=videoId
        if (pathname === '/api/download-status' && req.method === 'GET') {
            const videoId = parsedUrl.searchParams.get('id');
            if (!videoId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing video id' }));
                return;
            }

            const progress = downloadProgress.get(videoId) || { percent: 0, status: 'idle', message: 'En attente...' };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(progress));
            return;
        }

        // 2.7 Cancel YouTube Download API: /api/cancel-download?id=videoId
        if (pathname === '/api/cancel-download' && req.method === 'GET') {
            const videoId = parsedUrl.searchParams.get('id');
            if (!videoId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing video id' }));
                return;
            }
            
            console.log(`Cancel request received for video ID: ${videoId}`);
            const child = activeDownloads.get(videoId);
            if (child) {
                downloadProgress.set(videoId, { percent: 0, status: 'cancelled', message: 'Téléchargement annulé' });
                try {
                    child.kill();
                    console.log(`Killed active yt-dlp process for ID: ${videoId}`);
                } catch (e) {
                    console.warn(`Failed to kill process:`, e);
                }
                activeDownloads.delete(videoId);
            } else {
                downloadProgress.set(videoId, { percent: 0, status: 'cancelled', message: 'Téléchargement annulé' });
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'cancelled', id: videoId }));
            return;
        }
        
        // 3. Audio File Stream API: /api/stream?id=videoId
        if (pathname === '/api/stream' && req.method === 'GET') {
            const videoId = parsedUrl.searchParams.get('id');
            const filePath = path.join(TEMP_DIR, `${videoId}.m4a`);
            
            if (!videoId || !fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'File not found. Download first.' }));
                return;
            }
            
            const stat = fs.statSync(filePath);
            
            res.writeHead(200, {
                'Content-Type': 'audio/mp4',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="${videoId}.m4a"`,
                'Cache-Control': 'no-cache'
            });
            
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            
            // Delete temp file once transfer is finished or connection closed
            res.on('finish', () => {
                setTimeout(() => {
                    fs.unlink(filePath, (err) => {
                        if (!err) console.log(`Cleaned up temp file: ${videoId}.m4a`);
                    });
                }, 5000); // 5s delay to ensure client finishes processing
            });
            
            res.on('close', () => {
                readStream.destroy();
            });
            return;
        }

        // 3.5. Direct YouTube Stream API (for online preview play): /api/stream-youtube?id=videoId
        if (pathname === '/api/stream-youtube' && req.method === 'GET') {
            const videoId = parsedUrl.searchParams.get('id');
            if (!videoId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing video id' }));
                return;
            }
            
            console.log(`Piping YouTube audio stream directly for ID: ${videoId}`);
            
            res.writeHead(200, {
                'Content-Type': 'audio/mp4',
                'Cache-Control': 'no-cache',
                'Transfer-Encoding': 'chunked'
            });
            
            // Spawn yt-dlp to stream directly to stdout in format 140
            const args = getYtdlpArgs([
                '-f', '140',
                '-o', '-',
                `https://www.youtube.com/watch?v=` + videoId
            ]);
            
            const child = spawn(YTDLP_PATH, args);
            child.stdout.pipe(res);
            
            // Handle connection abort
            req.on('close', () => {
                if (child.exitCode === null) {
                    child.kill();
                    console.log(`YouTube stream connection closed, killed yt-dlp child process for ID: ${videoId}`);
                }
            });
            
            child.on('error', (err) => {
                console.error(`yt-dlp stream process error for ID ${videoId}:`, err);
            });
            return;
        }
        
        // 4. Thumbnail Proxy API: /api/proxy-thumbnail?url=thumbnailUrl
        if (pathname === '/api/proxy-thumbnail' && req.method === 'GET') {
            const imageUrl = parsedUrl.searchParams.get('url');
            if (!imageUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing url parameter' }));
                return;
            }
            
            https.get(imageUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'text/plain' });
                    res.end('Failed to fetch image');
                    return;
                }
                
                res.writeHead(200, {
                    'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
                    'Cache-Control': 'public, max-age=86400'
                });
                proxyRes.pipe(res);
            }).on('error', (err) => {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error proxying image');
            });
            return;
        }
        
        // 4.5. SSL Certificate Download: /api/download-cert
        if (pathname === '/api/download-cert' && req.method === 'GET') {
            const certPath = path.join(__dirname, 'cert.pem');
            if (fs.existsSync(certPath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/x-x509-ca-cert',
                    'Content-Disposition': 'attachment; filename="mervyplayer-cert.pem"'
                });
                fs.createReadStream(certPath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Certificate file not found');
            }
            return;
        }
        
        // ---------------- STATIC FILE SERVER ----------------
        
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        
        // Safety check to prevent traversing out of the workspace
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }
        
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }
            
            const ext = path.extname(filePath);
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            
            const headers = { 'Content-Type': contentType };
            if (ext === '.js' || ext === '.html' || ext === '.json' || ext === '.css') {
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
            }
            
            res.writeHead(200, headers);
            fs.createReadStream(filePath).pipe(res);
        });
    };
    
    let server;
    if (useHttps) {
        const httpsServer = require('https');
        const sslOptions = {
            key: fs.readFileSync(path.join(__dirname, 'key.pem')),
            cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
        };
        server = httpsServer.createServer(sslOptions, requestHandler);
    } else {
        server = http.createServer(requestHandler);
    }

    server.listen(PORT, '0.0.0.0', () => {
        const protocol = useHttps ? 'https' : 'http';
        console.log('\n======================================================');
        console.log(`   MervyPlayer Server (${protocol.toUpperCase()}) is running successfully!`);
        console.log(`   Recherche YouTube : jusqu'à ${SEARCH_LIMIT} résultats par requête`);
        console.log('======================================================');
        console.log(`Local Access: ${protocol}://localhost:${PORT}`);
        console.log('\nTo connect your iPhone XR:');
        console.log('1. Ensure your iPhone is on the same Wi-Fi network.');
        console.log('2. Open Safari and enter one of these addresses:');
        
        const ips = getLocalIPs();
        ips.forEach(ip => {
            console.log(`   👉 ${protocol}://${ip}:${PORT}`);
        });
        console.log('\nIMPORTANT iOS Safari Warning:');
        if (useHttps) {
            console.log('Safari will show an "Insecure Connection" warning.');
            console.log('Tap "Advanced" -> "Proceed anyway" to allow Service Workers to register!');
        } else {
            console.log('Service Workers (Offline playback) do not work over HTTP in iOS.');
            console.log('Please enable HTTPS to allow offline caching.');
        }
    });
});
