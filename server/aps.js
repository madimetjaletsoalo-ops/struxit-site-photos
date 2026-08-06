// Autodesk Platform Services (APS) helpers: OAuth (3-legged, confidential
// client) plus the Data Management API calls needed to list hubs/projects,
// create folders, and upload files.
//
// Reference: https://aps.autodesk.com/en/docs/oauth/v2/
//            https://aps.autodesk.com/en/docs/data/v2/

const APS_HOST = 'https://developer.api.autodesk.com';

const CLIENT_ID = process.env.APS_CLIENT_ID;
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET;
const CALLBACK_URL = process.env.APS_CALLBACK_URL;

const SCOPES = 'data:read data:write data:create';

function basicAuthHeader() {
  const raw = `${CLIENT_ID}:${CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

// Step 1: where to send the user to log in and grant consent.
function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: SCOPES,
    state
  });
  return `${APS_HOST}/authentication/v2/authorize?${params.toString()}`;
}

// Step 2: exchange the authorization code (from the callback) for tokens.
async function exchangeCodeForToken(code) {
  const res = await fetch(`${APS_HOST}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK_URL
    })
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${APS_HOST}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES
    })
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function authHeader(accessToken) {
  return { 'Authorization': `Bearer ${accessToken}` };
}

// --- Data Management: browse ---

async function listHubs(accessToken) {
  const res = await fetch(`${APS_HOST}/project/v1/hubs`, { headers: authHeader(accessToken) });
  if (!res.ok) throw new Error(`listHubs failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data;
}

async function listProjects(accessToken, hubId) {
  const res = await fetch(`${APS_HOST}/project/v1/hubs/${hubId}/projects`, { headers: authHeader(accessToken) });
  if (!res.ok) throw new Error(`listProjects failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data;
}

async function getTopFolders(accessToken, hubId, projectId) {
  const res = await fetch(`${APS_HOST}/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`, { headers: authHeader(accessToken) });
  if (!res.ok) throw new Error(`getTopFolders failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data;
}

// --- Data Management: create a folder under an existing folder ---

async function createFolder(accessToken, projectId, parentFolderId, name) {
  const body = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'folders',
      attributes: {
        name,
        extension: { type: 'folders:autodesk.bim360:Folder', version: '1.0' }
      },
      relationships: {
        parent: { data: { type: 'folders', id: parentFolderId } }
      }
    }
  };
  const res = await fetch(`${APS_HOST}/data/v1/projects/${projectId}/folders`, {
    method: 'POST',
    headers: { ...authHeader(accessToken), 'Content-Type': 'application/vnd.api+json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`createFolder failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data; // includes the new folder's id
}

// --- Upload a file into a folder: storage -> S3 -> finalize -> item/version ---

async function createStorage(accessToken, projectId, folderId, fileName) {
  const body = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'objects',
      attributes: { name: fileName },
      relationships: {
        target: { data: { type: 'folders', id: folderId } }
      }
    }
  };
  const res = await fetch(`${APS_HOST}/data/v1/projects/${projectId}/storage`, {
    method: 'POST',
    headers: { ...authHeader(accessToken), 'Content-Type': 'application/vnd.api+json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`createStorage failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()).data;
  const objectId = data.id; // urn:adsk.objects:os.object:bucketKey/objectKey
  const [bucketKey, objectKey] = objectId.replace('urn:adsk.objects:os.object:', '').split('/');
  return { objectId, bucketKey, objectKey };
}

async function uploadBufferToOSS(accessToken, bucketKey, objectKey, buffer) {
  // Request a signed S3 upload URL.
  const signedRes = await fetch(
    `${APS_HOST}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload?parts=1`,
    { headers: authHeader(accessToken) }
  );
  if (!signedRes.ok) throw new Error(`signeds3upload GET failed: ${signedRes.status} ${await signedRes.text()}`);
  const signed = await signedRes.json();
  const uploadUrl = signed.urls[0];
  const uploadKey = signed.uploadKey;

  // Upload the actual bytes to S3.
  const putRes = await fetch(uploadUrl, { method: 'PUT', body: buffer });
  if (!putRes.ok) throw new Error(`S3 PUT failed: ${putRes.status}`);

  // Tell OSS the upload is complete.
  const finalizeRes = await fetch(
    `${APS_HOST}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`,
    {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey })
    }
  );
  if (!finalizeRes.ok) throw new Error(`signeds3upload finalize failed: ${finalizeRes.status} ${await finalizeRes.text()}`);
  return finalizeRes.json();
}

async function createItemWithFirstVersion(accessToken, projectId, folderId, fileName, objectId) {
  const body = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'items',
      attributes: {
        displayName: fileName,
        extension: { type: 'items:autodesk.bim360:File', version: '1.0' }
      },
      relationships: {
        tip: { data: { type: 'versions', id: '1' } },
        parent: { data: { type: 'folders', id: folderId } }
      }
    },
    included: [{
      type: 'versions',
      id: '1',
      attributes: {
        name: fileName,
        extension: { type: 'versions:autodesk.bim360:File', version: '1.0' }
      },
      relationships: {
        storage: { data: { type: 'objects', id: objectId } }
      }
    }]
  };
  const res = await fetch(`${APS_HOST}/data/v1/projects/${projectId}/items`, {
    method: 'POST',
    headers: { ...authHeader(accessToken), 'Content-Type': 'application/vnd.api+json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`createItem failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data;
}

// High-level convenience: upload one file straight into a folder.
async function uploadFileToFolder(accessToken, projectId, folderId, fileName, buffer) {
  const { objectId, bucketKey, objectKey } = await createStorage(accessToken, projectId, folderId, fileName);
  await uploadBufferToOSS(accessToken, bucketKey, objectKey, buffer);
  return createItemWithFirstVersion(accessToken, projectId, folderId, fileName, objectId);
}

module.exports = {
  getAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  listHubs,
  listProjects,
  getTopFolders,
  createFolder,
  uploadFileToFolder
};
