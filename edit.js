/**
 * Pasut Collection — generic editable card list.
 * Reads content from data/<collection>.json (fast, static, same as any other
 * file on GitHub Pages). Only POSTs to Apps Script when the owner saves a
 * change — viewers never trigger a network call to Apps Script at all.
 *
 * Host page provides one <div id="cardMount"
 *   data-collection="gallery"
 *   data-empty="..."
 *   data-fields='[{"key":"caption","label":"..."}]'>
 * </div>
 */
(function () {
  const mount = document.getElementById('cardMount');
  if (!mount) return;
  const collection = mount.dataset.collection;
  const fields = JSON.parse(mount.dataset.fields || '[]');
  const emptyMsg = mount.dataset.empty || 'ยังไม่มีข้อมูล';
  const jsonPath = 'data/' + collection + '.json';

  let items = [];
  let editing = false;

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

  async function callBackend(payload) {
    if (typeof APPS_SCRIPT_URL === 'undefined' || !APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
      window.alert('ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ใน config.js');
      return null;
    }
    const pin = getPin();
    if (!pin) return null;
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ pin: pin, collection: collection }, payload)),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === 'wrong_pin') {
        localStorage.removeItem('pcPin');
        window.alert('รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง');
      } else {
        window.alert('บันทึกไม่สำเร็จ: ' + data.error);
      }
      return null;
    }
    return data;
  }

  function render() {
    mount.innerHTML = '';
    if (!items.length && !editing) {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = emptyMsg;
      mount.appendChild(p);
    } else {
      const grid = document.createElement('div');
      grid.className = 'cardgrid';
      items
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((item, idx, arr) => {
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
          fields.forEach((f, i) => {
            const val = item[f.key];
            if (!val) return;
            const el = document.createElement('div');
            el.className = i === 0 ? 'title' : 'cap';
            el.textContent = val;
            body.appendChild(el);
          });
          card.appendChild(body);

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
            card.appendChild(controls);
          }

          grid.appendChild(card);
        });
      mount.appendChild(grid);
    }

    if (editing) {
      const addBtn = mkBtn('+ เพิ่มรายการ', () => openForm(null));
      addBtn.className = 'btn-add';
      addBtn.style.marginTop = '16px';
      mount.appendChild(addBtn);
    }
  }

  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
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
    const result = await callBackend({ action: 'reorder', order: order });
    if (result) { items = result.items; }
    else { a.order = origA; b.order = origB; } // undo the optimistic swap if the save failed
    render();
  }

  async function doDelete(item) {
    if (!window.confirm('ลบรายการนี้ใช่มั้ย?')) return;
    const result = await callBackend({ action: 'delete', id: item.id });
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
      if (!f.multiline) input.type = 'text';
      input.value = (item && item[f.key]) || '';
      inputs[f.key] = input;
      label.appendChild(input);
      modal.appendChild(label);
    });

    const photoLabel = document.createElement('label');
    photoLabel.textContent = 'รูปภาพ (เว้นว่างได้ถ้าไม่เปลี่ยน)';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    photoLabel.appendChild(fileInput);
    modal.appendChild(photoLabel);

    const actions = document.createElement('div');
    actions.className = 'pc-modal-actions';
    const saveBtn = mkBtn('บันทึก', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'กำลังบันทึก...';
      const payloadFields = {};
      fields.forEach((f) => { payloadFields[f.key] = inputs[f.key].value.trim(); });
      const payload = { action: item ? 'update' : 'add', fields: payloadFields };
      if (item) payload.id = item.id;
      if (fileInput.files[0]) {
        payload.imageBase64 = await fileToBase64(fileInput.files[0]);
        payload.imageName = fileInput.files[0].name;
        payload.imageType = fileInput.files[0].type;
      }
      const result = await callBackend(payload);
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

  // shared edit-mode toggle — one per page, created once
  if (!document.querySelector('.edit-toggle')) {
    const btn = document.createElement('button');
    btn.className = 'edit-toggle';
    btn.type = 'button';
    btn.textContent = 'แก้ไขหน้านี้';
    btn.addEventListener('click', () => {
      if (!editing && !localStorage.getItem('pcPin')) {
        const pin = window.prompt('ใส่รหัสแก้ไขเว็บ');
        if (!pin) return;
        localStorage.setItem('pcPin', pin);
      }
      editing = !editing;
      btn.textContent = editing ? 'เสร็จแล้ว' : 'แก้ไขหน้านี้';
      render();
    });
    document.body.appendChild(btn);
  }

  fetch(jsonPath, { cache: 'no-store' })
    .then((r) => r.json())
    .then((data) => { items = data; render(); })
    .catch(() => { items = []; render(); });
})();
