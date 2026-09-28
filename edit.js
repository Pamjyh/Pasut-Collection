/**
 * Pasut Collection — shared self-editing runtime, loaded on every page.
 *
 * Viewers never call Apps Script: every page reads its content straight from
 * static data/<collection>.json files (fast, same as any other GitHub Pages
 * file). Apps Script is only called when the owner is in edit mode and saves
 * a change — it writes the updated JSON back to GitHub.
 *
 * One shared "editing" flag drives every editable region on the page (brand
 * name, a card list like gallery/media/orders, and/or a free "extra content"
 * block section) so a single "แก้ไขหน้านี้" button turns all of them on
 * at once, rather than each region needing its own toggle.
 *
 * Host page hooks (all optional — a page uses whichever it has):
 *   .brand > [data-field="name"]                     editable site name
 *   <div id="cardMount" data-collection="..." data-fields='[...]' data-empty="...">
 *   <div id="extraBlocks" data-collection="extra_...">   free text/image blocks
 */
(function () {
  let editing = false;
  const rerenderers = [];

  function onToggle(fn) {
    rerenderers.push(fn);
  }

  function ensureEditToggle() {
    if (document.querySelector('.edit-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'edit-toggle';
    btn.type = 'button';
    btn.textContent = 'แก้ไขหน้านี้';
    btn.addEventListener('click', async () => {
      // guards the await below: without this, clicking again while a ping
      // is still in flight skips straight past the (already-satisfied)
      // pcPin check and flips editing on with a pin that was never actually
      // confirmed — or, worse, one just proven wrong by that in-flight ping
      if (btn.disabled) return;
      if (!editing && !localStorage.getItem('pcPin')) {
        const pin = window.prompt('ใส่รหัสแก้ไขเว็บ');
        if (!pin) return;
        localStorage.setItem('pcPin', pin);
        // confirm it's actually correct right away, instead of silently
        // entering edit mode and only finding out on the first real save
        btn.disabled = true;
        const check = await callBackend('site', { action: 'ping' });
        btn.disabled = false;
        if (!check) return; // callBackend already alerted + cleared pcPin
      }
      editing = !editing;
      btn.textContent = editing ? 'เสร็จแล้ว' : 'แก้ไขหน้านี้';
      rerenderers.forEach((fn) => fn());
    });
    document.body.appendChild(btn);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function getPin() {
    let pin = localStorage.getItem('pcPin');
    if (!pin) {
      pin = window.prompt('ใส่รหัสแก้ไขเว็บ');
      if (pin) localStorage.setItem('pcPin', pin);
    }
    return pin;
  }

  // requests targeting the same collection must not race: two saves firing
  // close together (easy now that many independent fields can each debounce
  // their own autosave on one page) would both read the same GitHub file sha
  // and the second write to land loses to a 409, so queue them per collection
  // instead of letting fetches overlap
  const pendingByCollection = {};

  function callBackend(collection, payload) {
    const prior = pendingByCollection[collection] || Promise.resolve();
    const run = prior.catch(() => {}).then(() => callBackendNow(collection, payload));
    pendingByCollection[collection] = run;
    return run;
  }

  async function callBackendNow(collection, payload) {
    if (typeof APPS_SCRIPT_URL === 'undefined' || !APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
      window.alert('ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ใน config.js');
      return null;
    }
    const pin = getPin();
    if (!pin) return null;
    let data;
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ pin: pin, collection: collection }, payload)),
      });
      data = await res.json();
    } catch (err) {
      // a thrown fetch/parse error here was propagating as an unhandled
      // promise rejection with nothing shown on screen — every caller just
      // does `await callBackend(...)` with no try/catch of its own, so a
      // network hiccup looked exactly like "nothing happened" with no
      // indication anything was even attempted
      window.alert('เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง (' + (err && err.message ? err.message : err) + ')');
      return null;
    }
    if (!data.ok) {
      if (data.error === 'wrong_pin') {
        localStorage.removeItem('pcPin');
        // TEMPORARY DEBUG — surfaces the length-only fields Code.gs sends
        // alongside wrong_pin (see apps-script/Code.gs) so the owner can read
        // them straight off the alert with no DevTools needed — remove both
        // sides together once the pin-mismatch report is resolved
        const dbg = (data.debugStoredLen !== undefined)
          ? '\n(ตรวจสอบ: รหัสที่ตั้งไว้ ' + (data.debugStoredEmpty ? 'ไม่มีค่าเลย' : 'ยาว ' + data.debugStoredLen + ' ตัวอักษร')
            + ' / รหัสที่พิมพ์ยาว ' + data.debugSubmittedLen + ' ตัวอักษร)'
          : '';
        window.alert('รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง' + dbg);
      } else if (data.error === 'locked_out') {
        window.alert('ใส่รหัสผิดหลายครั้งเกินไป รออีก 5 นาทีแล้วลองใหม่');
      } else {
        window.alert('บันทึกไม่สำเร็จ: ' + data.error);
      }
      return null;
    }
    return data;
  }

  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- brand / site name (every page) ---------- */
  function mountBrand() {
    const el = document.querySelector('.brand [data-field="name"]');
    if (!el) return;
    const collection = 'site';
    let doc = { id: 'brand', name: el.textContent.trim() };
    let userIsEditing = false;

    // the editable span sits inside <a class="brand" href="index.html">;
    // without this, clicking it to place a cursor navigates away first
    const link = el.closest('a');
    if (link) {
      link.addEventListener('click', (e) => { if (editing) e.preventDefault(); });
    }

    function refresh() {
      el.contentEditable = editing ? 'true' : 'false';
    }
    onToggle(refresh);
    refresh();

    el.addEventListener('focus', () => { userIsEditing = true; });
    el.addEventListener('blur', () => { userIsEditing = false; });
    // Enter would make the browser insert a child <div>, and el.textContent
    // silently concatenates that with no separator on save — block it rather
    // than let the saved name get two words merged together
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    let saveTimer = null;
    el.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const result = await callBackend(collection, { action: 'update', id: doc.id, fields: { name: el.textContent.trim() } });
        if (!result) return;
        const updated = result.items.filter((x) => x.id === doc.id)[0];
        if (updated) doc = updated;
      }, 700);
    });

    fetch('data/site.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((items) => {
        const found = items.filter((x) => x.id === 'brand')[0];
        // don't clobber text the owner is actively typing when this resolves
        if (found && !userIsEditing) { doc = found; el.textContent = found.name; }
      })
      .catch(() => {});
  }

  /* ---------- editable item lists: cards (gallery/media/orders), and the
     structured "ตัวชี้วัด"/stat/funnel/floor/load sections in pa/daan1-3/
     teaching, all sharing one add/edit/delete/reorder engine. data-render on
     the mount picks how each item is drawn; data-photo="none" hides the
     photo upload UI entirely for renderModes that have no image ---------- */
  const RENDERERS = {
    cards(item) {
      const card = document.createElement('div');
      card.className = 'gcard';
      const photo = document.createElement('div');
      photo.className = 'photo';
      if (item.url) {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.caption || item.title || '';
        photo.appendChild(img);
      }
      card.appendChild(photo);
      const body = document.createElement('div');
      body.className = 'body';
      if (item.title) { const t = document.createElement('div'); t.className = 'title'; t.textContent = item.title; body.appendChild(t); }
      ['caption', 'description', 'date'].forEach((k) => {
        if (item[k] && k !== 'title') { const c = document.createElement('div'); c.className = 'cap'; c.textContent = item[k]; body.appendChild(c); }
      });
      card.appendChild(body);
      return card;
    },
    indicator(item) {
      const sub = document.createElement('div');
      sub.className = item.url ? 'sub with-image' : 'sub';
      const left = document.createElement('div');
      if (item.tag) { const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = item.tag; left.appendChild(tag); }
      const h3 = document.createElement('h3'); h3.textContent = item.title || ''; left.appendChild(h3);
      const p = document.createElement('p'); p.textContent = item.desc || ''; left.appendChild(p);
      sub.appendChild(left);
      if (item.url) {
        const figure = document.createElement('figure');
        const img = document.createElement('img'); img.src = item.url; img.alt = item.title || '';
        figure.appendChild(img);
        if (item.caption) { const cap = document.createElement('figcaption'); cap.textContent = item.caption; figure.appendChild(cap); }
        sub.appendChild(figure);
      }
      return sub;
    },
    tile(item) {
      const a = document.createElement('a');
      a.className = 'tile' + (item.colorClass ? ' ' + item.colorClass : '');
      a.href = item.href || '#';
      // whole card is a link; block navigation while editing the same way
      // mountBrand() does for its own <a> — clicking anywhere on the card
      // (not just the small edit-controls bar) shouldn't navigate away
      a.addEventListener('click', (e) => { if (editing) e.preventDefault(); });
      const band = document.createElement('div'); band.className = 'icon-band'; band.setAttribute('aria-hidden', 'true'); band.textContent = item.icon || '';
      const body = document.createElement('div'); body.className = 'body';
      const h3 = document.createElement('h3'); h3.textContent = item.title || ''; body.appendChild(h3);
      const p = document.createElement('p'); p.textContent = item.desc || ''; body.appendChild(p);
      const go = document.createElement('div'); go.className = 'go'; go.textContent = item.count || ''; body.appendChild(go);
      a.append(band, body);
      return a;
    },
    'floor-bar'(item) {
      const floor = document.createElement('div'); floor.className = 'floor';
      const range = document.createElement('div'); range.className = 'range num'; range.textContent = item.range || ''; floor.appendChild(range);
      const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = item.desc || ''; floor.appendChild(desc);
      const bar = document.createElement('div'); bar.className = 'bar';
      const i = document.createElement('i'); i.style.width = (Number(item.percent) || 0) + '%'; bar.appendChild(i);
      floor.appendChild(bar);
      return floor;
    },
    'stat-compare'(item) {
      const card = document.createElement('div'); card.className = 'stat-card';
      const label = document.createElement('div'); label.className = 'label'; label.textContent = item.label || ''; card.appendChild(label);
      const move = document.createElement('div'); move.className = 'stat-move';
      const from = document.createElement('span'); from.className = 'from num'; from.textContent = (item.before ?? 0) + (item.unit || '');
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
      const to = document.createElement('span'); to.className = 'to num'; to.textContent = (item.after ?? 0) + (item.unit || '');
      move.append(from, arrow, to);
      card.appendChild(move);
      return card;
    },
    'funnel-row'(item) {
      const row = document.createElement('div'); row.className = 'funnel-row';
      const fl = document.createElement('div'); fl.className = 'fl'; fl.textContent = item.label || ''; row.appendChild(fl);
      const track = document.createElement('div'); track.className = 'funnel-track';
      const i = document.createElement('i'); i.style.width = (Number(item.percent) || 0) + '%'; track.appendChild(i);
      row.appendChild(track);
      const fn = document.createElement('div'); fn.className = 'fn num'; fn.textContent = item.countText || ''; row.appendChild(fn);
      return row;
    },
    'load-card'(item) {
      const card = document.createElement('div'); card.className = 'loadcard';
      const term = document.createElement('div'); term.className = 'term'; term.textContent = item.term || ''; card.appendChild(term);
      const total = document.createElement('div'); total.className = 'total num';
      total.append(String(item.totalHours || 0) + ' ');
      const small = document.createElement('small'); small.style.cssText = 'font-size:15px;color:var(--ink-muted);font-weight:400;'; small.textContent = 'ชม./สัปดาห์';
      total.appendChild(small);
      card.appendChild(total);
      const ul = document.createElement('ul');
      (item.subjects || '').split('\n').forEach((line) => { line = line.trim(); if (line) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); } });
      card.appendChild(ul);
      return card;
    },
  };
  const WRAPPER_CLASS = { cards: 'cardgrid', tile: 'tilegrid', indicator: 'subs', 'floor-bar': 'floors', 'stat-compare': 'stat-grid', 'funnel-row': 'funnel', 'load-card': 'loadgrid' };

  function mountEditableList(mount) {
    const collection = mount.dataset.collection;
    const fields = JSON.parse(mount.dataset.fields || '[]');
    const emptyMsg = mount.dataset.empty || 'ยังไม่มีข้อมูล';
    const addLabel = mount.dataset.addLabel || '+ เพิ่มรายการ';
    const renderMode = mount.dataset.render || 'cards';
    const photoMode = mount.dataset.photo || 'optional'; // 'optional' | 'none'
    const renderItem = RENDERERS[renderMode] || RENDERERS.cards;
    const jsonPath = 'data/' + collection + '.json';
    let items = [];

    function render() {
      mount.innerHTML = '';
      if (!items.length && !editing) {
        const p = document.createElement('p');
        p.className = 'empty-note';
        p.textContent = emptyMsg;
        mount.appendChild(p);
      } else {
        const wrapperClass = WRAPPER_CLASS[renderMode];
        const grid = wrapperClass ? document.createElement('div') : mount;
        if (wrapperClass) grid.className = wrapperClass;
        items
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .forEach((item, idx, arr) => {
            const card = renderItem(item);

            if (editing) {
              const controls = document.createElement('div');
              controls.className = 'edit-controls';
              const up = mkBtn('↑', () => move(idx, -1, arr));
              up.disabled = idx === 0;
              const down = mkBtn('↓', () => move(idx, 1, arr));
              down.disabled = idx === arr.length - 1;
              const editBtn = mkBtn('แก้ไข', () => openForm(item));
              const delBtn = mkBtn('ลบ', () => doDelete(item));
              delBtn.classList.add('btn-del');
              controls.append(up, down, editBtn, delBtn);
              // tile items are <a href>: without this, clicking a control
              // button still triggers the surrounding link's navigation
              controls.addEventListener('click', (e) => e.preventDefault());
              card.appendChild(controls);
            }

            grid.appendChild(card);
          });
        if (wrapperClass) mount.appendChild(grid);
      }

      if (editing) {
        const addBtn = mkBtn(addLabel, () => openForm(null));
        addBtn.className = 'btn-add';
        addBtn.style.marginTop = '16px';
        mount.appendChild(addBtn);
      }
    }

    async function move(idx, dir, arr) {
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      const a = arr[idx], b = arr[j];
      const origA = a.order, origB = b.order;
      a.order = origB;
      b.order = origA;
      render();
      const order = items.slice().sort((x, y) => (x.order || 0) - (y.order || 0)).map((x) => x.id);
      const result = await callBackend(collection, { action: 'reorder', order: order });
      if (result) { items = result.items; }
      else { a.order = origA; b.order = origB; }
      render();
    }

    async function doDelete(item) {
      if (!window.confirm('ลบรายการนี้ใช่มั้ย?')) return;
      const result = await callBackend(collection, { action: 'delete', id: item.id });
      if (result) { items = result.items; render(); }
    }

    function openForm(item) {
      const overlay = document.createElement('div');
      overlay.className = 'pc-modal-overlay';
      const modal = document.createElement('div');
      modal.className = 'pc-modal';
      modal.innerHTML = '<h3>' + (item ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่') + '</h3>';

      const inputs = {};
      fields.forEach((f) => {
        const label = document.createElement('label');
        label.textContent = f.label;
        const input = document.createElement(f.multiline ? 'textarea' : 'input');
        if (!f.multiline) input.type = f.type === 'number' ? 'number' : 'text';
        input.value = (item && item[f.key] != null) ? item[f.key] : '';
        inputs[f.key] = input;
        label.appendChild(input);
        modal.appendChild(label);
      });

      let fileInput = null;
      if (photoMode !== 'none') {
        const photoLabel = document.createElement('label');
        photoLabel.textContent = 'รูปภาพ (เว้นว่างได้ถ้าไม่เปลี่ยน)';
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        photoLabel.appendChild(fileInput);
        modal.appendChild(photoLabel);
      }

      const actions = document.createElement('div');
      actions.className = 'pc-modal-actions';
      const saveBtn = mkBtn('บันทึก', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'กำลังบันทึก...';
        const payloadFields = {};
        fields.forEach((f) => {
          if (f.type === 'number') {
            let n = parseFloat(inputs[f.key].value) || 0;
            if (f.min != null) n = Math.max(f.min, n);
            if (f.max != null) n = Math.min(f.max, n);
            payloadFields[f.key] = n;
          } else {
            payloadFields[f.key] = inputs[f.key].value.trim();
          }
        });
        const payload = { action: item ? 'update' : 'add', fields: payloadFields };
        if (item) payload.id = item.id;
        if (fileInput && fileInput.files[0]) {
          payload.imageBase64 = await fileToBase64(fileInput.files[0]);
          payload.imageName = fileInput.files[0].name;
          payload.imageType = fileInput.files[0].type;
        }
        const result = await callBackend(collection, payload);
        if (result) { items = result.items; render(); overlay.remove(); }
        else { saveBtn.disabled = false; saveBtn.textContent = 'บันทึก'; }
      });
      saveBtn.className = 'btn-add';
      const cancelBtn = mkBtn('ยกเลิก', () => overlay.remove());
      actions.append(saveBtn, cancelBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }

    onToggle(render);
    fetch(jsonPath, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { items = data; render(); })
      .catch(() => { items = []; render(); });
  }

  /* ---------- free text/image blocks (every page, appended section) ---------- */
  function mountBlocks(mount) {
    const collection = mount.dataset.collection;
    const jsonPath = 'data/' + collection + '.json';
    const section = mount.closest('section');
    let items = [];

    function render() {
      mount.innerHTML = '';
      // hide the whole "เนื้อหาเพิ่มเติม" section when there's nothing to show
      // and the owner isn't editing, instead of leaving an empty heading visible
      if (section) section.style.display = (!items.length && !editing) ? 'none' : '';
      const sorted = items.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      sorted.forEach((item, idx, arr) => {
        const block = document.createElement('div');
        block.className = item.kind === 'image' ? 'gcard' : 'summary-card';
        block.style.marginBottom = '14px';

        if (item.kind === 'image') {
          const photo = document.createElement('div');
          photo.className = 'photo';
          if (item.url) {
            const img = document.createElement('img');
            img.src = item.url;
            img.alt = item.text || '';
            photo.appendChild(img);
          }
          block.appendChild(photo);
          if (item.text) {
            const body = document.createElement('div');
            body.className = 'body';
            const cap = document.createElement('div');
            cap.className = 'cap';
            cap.textContent = item.text;
            body.appendChild(cap);
            block.appendChild(body);
          }
        } else {
          const p = document.createElement('p');
          p.style.whiteSpace = 'pre-line';
          p.style.margin = '0';
          p.textContent = item.text || '';
          block.appendChild(p);
        }

        if (editing) {
          const controls = document.createElement('div');
          controls.className = 'edit-controls';
          controls.style.marginTop = '10px';
          const up = mkBtn('↑', () => move(idx, -1, arr));
          up.disabled = idx === 0;
          const down = mkBtn('↓', () => move(idx, 1, arr));
          down.disabled = idx === arr.length - 1;
          const editBtn = mkBtn('แก้ไข', () => openForm(item));
          const delBtn = mkBtn('ลบ', () => doDelete(item));
          delBtn.classList.add('btn-del');
          controls.append(up, down, editBtn, delBtn);
          block.appendChild(controls);
        }
        mount.appendChild(block);
      });

      if (editing) {
        const addRow = document.createElement('div');
        addRow.style.display = 'flex';
        addRow.style.gap = '10px';
        addRow.style.flexWrap = 'wrap';
        const addText = mkBtn('+ เพิ่มข้อความ', () => openForm(null, 'text'));
        addText.className = 'btn-add';
        const addImage = mkBtn('+ เพิ่มรูปภาพ', () => openForm(null, 'image'));
        addImage.className = 'btn-add';
        addRow.append(addText, addImage);
        mount.appendChild(addRow);
      }
    }

    async function move(idx, dir, arr) {
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      const a = arr[idx], b = arr[j];
      const origA = a.order, origB = b.order;
      a.order = origB;
      b.order = origA;
      render();
      const order = items.slice().sort((x, y) => (x.order || 0) - (y.order || 0)).map((x) => x.id);
      const result = await callBackend(collection, { action: 'reorder', order: order });
      if (result) { items = result.items; }
      else { a.order = origA; b.order = origB; }
      render();
    }

    async function doDelete(item) {
      if (!window.confirm('ลบเนื้อหานี้ใช่มั้ย?')) return;
      const result = await callBackend(collection, { action: 'delete', id: item.id });
      if (result) { items = result.items; render(); }
    }

    function openForm(item, kind) {
      const isImage = item ? item.kind === 'image' : kind === 'image';
      const overlay = document.createElement('div');
      overlay.className = 'pc-modal-overlay';
      const modal = document.createElement('div');
      modal.className = 'pc-modal';
      modal.innerHTML = '<h3>' + (item ? 'แก้ไขเนื้อหา' : isImage ? 'เพิ่มรูปภาพ' : 'เพิ่มข้อความ') + '</h3>';

      const textLabel = document.createElement('label');
      textLabel.textContent = isImage ? 'คำบรรยายภาพ (ไม่บังคับ)' : 'ข้อความ';
      const textInput = document.createElement('textarea');
      textInput.value = (item && item.text) || '';
      textLabel.appendChild(textInput);
      modal.appendChild(textLabel);

      let fileInput = null;
      if (isImage) {
        const photoLabel = document.createElement('label');
        photoLabel.textContent = 'รูปภาพ (เว้นว่างได้ถ้าไม่เปลี่ยน)';
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        photoLabel.appendChild(fileInput);
        modal.appendChild(photoLabel);
      }

      const actions = document.createElement('div');
      actions.className = 'pc-modal-actions';
      const saveBtn = mkBtn('บันทึก', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'กำลังบันทึก...';
        const payload = {
          action: item ? 'update' : 'add',
          fields: { text: textInput.value.trim(), kind: isImage ? 'image' : 'text' },
        };
        if (item) payload.id = item.id;
        if (fileInput && fileInput.files[0]) {
          payload.imageBase64 = await fileToBase64(fileInput.files[0]);
          payload.imageName = fileInput.files[0].name;
          payload.imageType = fileInput.files[0].type;
        }
        const result = await callBackend(collection, payload);
        if (result) { items = result.items; render(); overlay.remove(); }
        else { saveBtn.disabled = false; saveBtn.textContent = 'บันทึก'; }
      });
      saveBtn.className = 'btn-add';
      const cancelBtn = mkBtn('ยกเลิก', () => overlay.remove());
      actions.append(saveBtn, cancelBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }

    onToggle(render);
    fetch(jsonPath, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { items = data; render(); })
      .catch(() => { items = []; render(); });
  }

  /* ---------- fixed-layout content fields (headings/paragraphs/photos baked into each page) ---------- */
  function mountContentFields() {
    const collection = document.body.dataset.contentCollection;
    if (!collection) return;
    const textEls = Array.prototype.slice.call(document.querySelectorAll('[data-edit]'));
    const imgEls = Array.prototype.slice.call(document.querySelectorAll('[data-edit-img]'));
    if (!textEls.length && !imgEls.length) return;

    const jsonPath = 'data/' + collection + '.json';
    const saved = {};
    const userIsEditingIds = {};
    const saveTimers = {};

    function applySaved() {
      textEls.forEach((el) => {
        const id = el.dataset.edit;
        const item = saved[id];
        if (item && item.text != null && !userIsEditingIds[id]) el.textContent = item.text;
      });
      imgEls.forEach((el) => {
        const item = saved[el.dataset.editImg];
        if (item && item.url) el.src = item.url;
      });
    }

    function ensureImageOverlay(el) {
      const parent = el.parentElement;
      if (!parent) return;
      let btn = parent.querySelector(':scope > .img-edit-btn');
      if (editing) {
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        if (!btn) {
          btn = mkBtn('เปลี่ยนรูป', () => triggerUpload(el));
          btn.className = 'img-edit-btn';
          parent.appendChild(btn);
        }
      } else if (btn) {
        btn.remove();
      }
    }

    async function triggerUpload(el) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const id = el.dataset.editImg;
        const imageBase64 = await fileToBase64(file);
        const result = await callBackend(collection, {
          action: 'update',
          id: id,
          fields: {},
          imageBase64: imageBase64,
          imageName: file.name,
          imageType: file.type,
        });
        if (!result) return;
        const item = result.items.filter((x) => x.id === id)[0];
        if (item) { saved[id] = item; if (item.url) el.src = item.url; }
      });
      input.click();
    }

    function refresh() {
      textEls.forEach((el) => { el.contentEditable = editing ? 'true' : 'false'; });
      imgEls.forEach(ensureImageOverlay);
    }
    onToggle(refresh);
    refresh();

    textEls.forEach((el) => {
      const id = el.dataset.edit;
      // same reasoning as mountBrand(): block Enter so a multi-child DOM
      // split never gets silently joined into one run-on line on save
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      el.addEventListener('focus', () => { userIsEditingIds[id] = true; });
      el.addEventListener('blur', () => { userIsEditingIds[id] = false; });
      el.addEventListener('input', () => {
        clearTimeout(saveTimers[id]);
        saveTimers[id] = setTimeout(async () => {
          const result = await callBackend(collection, { action: 'update', id: id, fields: { text: el.textContent.trim() } });
          if (!result) return;
          const updated = result.items.filter((x) => x.id === id)[0];
          if (updated) saved[id] = updated;
        }, 700);
      });
    });

    fetch(jsonPath, { cache: 'no-store' })
      .then((r) => r.json())
      .then((items) => {
        items.forEach((it) => { saved[it.id] = it; });
        applySaved();
      })
      .catch(() => {});
  }

  ensureEditToggle();
  mountBrand();
  mountContentFields();
  // every editable item list on the page (gallery/media/orders' single
  // #cardMount, plus however many structured sections pa/daan1-3/teaching
  // now have — tiles, indicators, floors, stats, funnel, load cards) shares
  // this one mount call; #extraBlocks is handled separately by mountBlocks
  document.querySelectorAll('[data-collection]').forEach((mount) => {
    if (mount.id === 'extraBlocks') return;
    mountEditableList(mount);
  });
  const extraMount = document.getElementById('extraBlocks');
  if (extraMount) mountBlocks(extraMount);
})();
