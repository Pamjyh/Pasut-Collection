/**
 * Pasut Collection — write-only backend.
 *
 * Viewers never call this script: gallery.html / media.html / orders.html read
 * their content straight from the static data/*.json files on GitHub Pages
 * (fast, no round trip). This script only runs when the owner saves an edit —
 * it updates data/<collection>.json directly on GitHub via the Contents API,
 * and uploads any new photo into the repo (uploads/<uuid>.<ext>) the same way.
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
  'extra_gallery', 'extra_media', 'extra_orders',
  'content_index', 'content_personal', 'content_teaching', 'content_pa',
  'content_daan1', 'content_daan2', 'content_daan3',
  'pa_tiles', 'pa_floors', 'pa_stats', 'pa_funnel',
  'daan1_indicators', 'daan1_showcase', 'daan2_indicators', 'daan3_indicators',
  'teaching_loads'
];

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
    // TEMPORARY DEBUG — lengths only, never the actual values — remove once
    // the pin-mismatch report is resolved (see chat)
    return jsonOut({
      ok: false,
      error: 'wrong_pin',
      debugStoredLen: pin ? pin.length : 0,
      debugStoredEmpty: !pin,
      debugSubmittedLen: body.pin ? body.pin.length : 0,
    });
  }
  CacheService.getScriptCache().remove('pin_fail');

  if (body.action === 'ping') {
    // lets the client confirm a pin the moment it's typed (see edit.js
    // ensureEditToggle), instead of only discovering a bad pin on the first
    // real save — no collection involved, so it's checked before that gate
    return jsonOut({ ok: true });
  }

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
      if (body.imageBase64) item.url = uploadImage(body.imageBase64, body.imageName, body.imageType);
      items.push(item);
    } else if (body.action === 'update') {
      let item = items.filter(function (x) { return x.id === body.id; })[0];
      if (!item) {
        // only content_* collections use stable, client-chosen ids seeded
        // into an empty collection ([]) rather than server-generated ones, so
        // only there does a missing id mean "create it". For every other
        // collection (gallery/media/orders/site/extra_*) the item must
        // already exist — a missing id there is a real conflict (e.g. it was
        // deleted from another tab) and must be reported, not silently
        // resurrected with a partial, image-less record.
        if (!body.id || collection.indexOf('content_') !== 0) {
          return jsonOut({ ok: false, error: 'not_found' });
        }
        item = { id: body.id, order: Date.now() };
        items.push(item);
      }
      Object.assign(item, body.fields || {});
      if (body.imageBase64) item.url = uploadImage(body.imageBase64, body.imageName, body.imageType);
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
      // rewrite .order to match the new sequence — without this, the array
      // is rearranged but every item keeps its old .order number, so the
      // client's own render() (which sorts by .order) silently snaps the
      // list right back to the original order on the very next render
      items.forEach(function (x, i) { x.order = (i + 1) * 1000; });
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

// Stores the photo in the repo itself (uploads/<uuid>.<ext>) instead of
// Google Drive: a Drive "uc?export=view" link loads fine via direct
// navigation but fails to render when embedded as a cross-origin <img> (Drive
// blocks/redirects it — confirmed live: naturalWidth stayed 0 despite the
// <img> reporting complete). Serving it from the same GitHub Pages origin as
// every other image on the site sidesteps that entirely.
function uploadImage(base64Data, filename, mimeType) {
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('image_too_large');
  const ext = (filename && filename.lastIndexOf('.') !== -1) ? filename.slice(filename.lastIndexOf('.')) : guessExt(mimeType);
  const path = 'uploads/' + Utilities.getUuid() + ext;
  const payload = {
    message: 'Upload ' + path + ' via Pasut Collection edit',
    content: Utilities.base64Encode(bytes),
    branch: GITHUB_BRANCH,
  };
  const res = UrlFetchApp.fetch(githubContentsUrl(path), {
    method: 'put',
    headers: Object.assign(githubHeaders(), { 'Content-Type': 'application/json' }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('github_upload_failed: ' + res.getContentText());
  return path;
}

function guessExt(mimeType) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  return map[mimeType] || '.jpg';
}
