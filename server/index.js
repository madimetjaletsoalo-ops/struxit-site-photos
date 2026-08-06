require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const aps = require('./aps');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(cookieSession({
  name: 'session',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  maxAge: 24 * 60 * 60 * 1000
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- OAuth ----

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(aps.getAuthorizeUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!state || state !== req.session.oauthState) {
    return res.status(400).send('State mismatch — please try logging in again.');
  }
  try {
    const tokens = await aps.exchangeCodeForToken(code);
    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token;
    req.session.expiresAt = Date.now() + tokens.expires_in * 1000;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Login failed: ' + err.message);
  }
});

app.get('/auth/status', (req, res) => {
  res.json({ loggedIn: !!req.session.accessToken });
});

// Refreshes the token if it's expired, and returns a valid access token
// for use by the route handlers below.
async function getValidToken(req) {
  if (!req.session.accessToken) throw new Error('Not logged in');
  if (Date.now() > req.session.expiresAt - 30000) {
    const tokens = await aps.refreshAccessToken(req.session.refreshToken);
    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token;
    req.session.expiresAt = Date.now() + tokens.expires_in * 1000;
  }
  return req.session.accessToken;
}

// ---- Browse: hubs / projects / folders ----

app.get('/api/hubs', async (req, res) => {
  try {
    const token = await getValidToken(req);
    res.json(await aps.listHubs(token));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hubs/:hubId/projects', async (req, res) => {
  try {
    const token = await getValidToken(req);
    res.json(await aps.listProjects(token, req.params.hubId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hubs/:hubId/projects/:projectId/topfolders', async (req, res) => {
  try {
    const token = await getValidToken(req);
    res.json(await aps.getTopFolders(token, req.params.hubId, req.params.projectId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Create a folder (e.g. one per site, or one per site/date) ----

app.post('/api/projects/:projectId/folders', async (req, res) => {
  try {
    const token = await getValidToken(req);
    const { parentFolderId, name } = req.body;
    res.json(await aps.createFolder(token, req.params.projectId, parentFolderId, name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Upload a single photo into a folder ----

app.post('/api/projects/:projectId/folders/:folderId/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await getValidToken(req);
    const { originalname, buffer } = req.file;
    res.json(await aps.uploadFileToFolder(token, req.params.projectId, req.params.folderId, originalname, buffer));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Persisted site polygons (Supabase-backed store) ----
// See server/db.js. The frontend only ever talks to these two endpoints,
// so the storage engine can be swapped without touching public/index.html.

const { readSites, writeSites } = require('./db');

app.get('/api/sites', async (req, res) => {
  try {
    res.json(await readSites());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sites', async (req, res) => {
  try {
    const sites = Array.isArray(req.body) ? req.body : (req.body && req.body.sites);
    if (!Array.isArray(sites)) return res.status(400).json({ error: 'Expected a JSON array of sites' });
    await writeSites(sites);
    res.json({ ok: true, count: sites.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`STRUXIT Site Photos server running on http://localhost:${port}`));
