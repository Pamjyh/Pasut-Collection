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
 *      GITHUB_TOKEN = a GitHub Personal Access Token with "repo" scope
 *      EDIT_PIN     = any PIN/password you choose (e.g. 4-8 digits)
 * 3. Deploy -> New deployment -> type "Web app"
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the resulting /exec URL into config.js as APPS_SCRIPT_URL.
 */

const GITHUB_OWNER = 'Pamjyh';
const GITHUB_REPO = 'Pasut-Collection';
const GITHUB_BRANCH = 'main';
const ALLOWED_COLLECTIONS = ['gallery', 'media', 'orders'];
const DRIVE_FOLDER_NAME = 'Pasut Collection Uploads';

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_request' });
  }

  const pin = PropertiesService.getScriptProperties().getProperty('EDIT_PIN');
  if (!pin || body.pin !== pin) {
    return jsonOut({ ok: false, error: 'wrong_pin' });
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
      items = body.order.map(function (id) { return byId[id]; }).filter(Boolean);
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
