/**
 * Pasut Collection — write-only backend.
 *
 * Viewers never call this script: gallery.html / media.html / orders.html read
 * their content straight from the static data/*.json files on GitHub Pages
 * (fast, no round trip). This script only runs when the owner saves an edit —
 * it updates data/<collection>.json directly on GitHub via the Contents API,
 * and uploads any new photo to Google Drive.
 *
 * SETUP (one time):
 * 1. script.google.com -> New project -> paste this file in as Code.gs
 * 2. Project Settings (gear icon) -> Script Properties -> add two properties:
 *      GITHUB_TOKEN = a fine-grained GitHub token, scoped to just this repo,
 *                     with Contents: Read and write (see README.md)
 *      EDIT_PIN     = a PIN/password you choose — this is the ONLY gate on
 *                     write access since the deploy URL below is public
 *                     (it ships inside config.js), so make it long, not a
 *                     short numeric PIN
 * 3. Deploy -> New deployment -> type "Web app"
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the resulting /exec URL into config.js as APPS_SCRIPT_URL.
 */

const GITHUB_OWNER = 'Pamjyh';
const GITHUB_REPO = 'Pasut-Collection';
const GITHUB_BRANCH = 'main';
const ALLOWED_COLLECTIONS = [
  'gallery', 'media', 'orders', 'site',
  'extra_index', 'extra_personal', 'extra_teaching', 'extra_pa',
  'extra_daan1', 'extra_daan2', 'extra_daan3',
  'extra_gallery', 'extra_media', 'extra_orders'
];
const DRIVE_FOLDER_NAME = 'Pasut Collection Uploads';

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_request' });
  }

  if (tooManyPinFailures()) {
    return jsonOut({ ok: false, error: 'locked_out' });
  }

  const pin = PropertiesService.getScriptProperties().getProperty('EDIT_PIN');
  if (!pin || body.pin !== pin) {
    recordPinFailure();
    return jsonOut({ ok: false, error: 'wrong_pin' });
  }
  CacheService.getScriptCache().remove('pin_fail');

  const collection = body.collection;
  if (ALLOWED_COLLECTIONS.indexOf(collection) === -1) {
    return jsonOut({ ok: false, error: 'bad_collection' });
  }

  try {
    const path = 'data/' + collection + '.json';
    const file = githubGetFile(path);
    let items = file.content;

    if (body.action === 'add') {
      const item = Object.assign({ id: Utilities.getUuid(), order: Date.now() }, body.fields || {});
      if (body.imageBase64) item.url = driveUpload(body.imageBase64, body.imageName, body.imageType);
      items.push(item);
    } else if (body.action === 'update') {
      const item = items.filter(function (x) { return x.id === body.id; })[0];
      if (!item) return jsonOut({ ok: false, error: 'not_found' });
      Object.assign(item, body.fields || {});
      if (body.imageBase64) item.url = driveUpload(body.imageBase64, body.imageName, body.imageType);
    } else if (body.action === 'delete') {
      items = items.filter(function (x) { return x.id !== body.id; });
    } else if (body.action === 'reorder') {
      const byId = {};
      items.forEach(function (x) { byId[x.id] = x; });
      const ordered = body.order.map(function (id) { return byId[id]; }).filter(Boolean);
      const seen = {};
      ordered.forEach(function (x) { seen[x.id] = true; });
      // keep any item the client didn't know about (added elsewhere since its last fetch)
      // instead of silently dropping it
      const missing = items.filter(function (x) { return !seen[x.id]; });
      items = ordered.concat(missing);
    } else {
      return jsonOut({ ok: false, error: 'bad_action' });
    }

    githubPutFile(path, items, file.sha);
    return jsonOut({ ok: true, items: items });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// The deploy URL is public (it ships inside config.js), so the PIN is the only
// gate — lock out after repeated wrong guesses instead of allowing unlimited attempts.
function tooManyPinFailures() {
  return Number(CacheService.getScriptCache().get('pin_fail') || 0) >= 8;
}
function recordPinFailure() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('pin_fail') || 0);
  cache.put('pin_fail', String(n + 1), 300); // 5-minute lockout window
}

function githubHeaders() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  return {
    Authorization: 'token ' + token,
    Accept: 'application/vnd.github+json',
  };
}

function githubContentsUrl(path) {
  return 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
}

function githubGetFile(path) {
  const res = UrlFetchApp.fetch(githubContentsUrl(path) + '?ref=' + GITHUB_BRANCH, {
    headers: githubHeaders(),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (!data.content) throw new Error('github_get_failed: ' + res.getContentText());
  const bytes = Utilities.base64Decode(data.content.replace(/\n/g, ''));
  const text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  return { content: JSON.parse(text), sha: data.sha };
}

function githubPutFile(path, itemsArray, sha) {
  const jsonText = JSON.stringify(itemsArray, null, 2);
  const b64 = Utilities.base64Encode(jsonText, Utilities.Charset.UTF_8);
  const payload = {
    message: 'Update ' + path + ' via Pasut Collection edit',
    content: b64,
    sha: sha,
    branch: GITHUB_BRANCH,
  };
  const res = UrlFetchApp.fetch(githubContentsUrl(path), {
    method: 'put',
    headers: Object.assign(githubHeaders(), { 'Content-Type': 'application/json' }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('github_put_failed: ' + res.getContentText());
}

function driveUpload(base64Data, filename, mimeType) {
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('image_too_large');
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', filename || 'photo.jpg');
  const folder = getOrCreateFolder(DRIVE_FOLDER_NAME);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

function getOrCreateFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
