/* Nối giao diện với EpdClock (ble.js) và EpdDesigner (designer.js). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const clock = new EpdClock();
  const D = EpdDesigner;
  const PROFILES = EPD_PROFILES;

  /* ---------------- Mẫu bảng thông tin ---------------- */
  const PRESETS = {
    claude_en: {
      name: 'Claude (English)',
      template:
`> [icon:claude] CLAUDE | {{now.weekday_en}} {{now.date_en}}
Messages | {{claude.today.messages|num_en}}
Output tokens | {{claude.today.output_tokens|k}}
[bar:{{claude_limits.five_hour.percent}}] 5h · {{claude_limits.five_hour.resets_at|hm}}
[bar:{{claude_limits.seven_day.percent}}] Week · {{claude_limits.seven_day.resets_at|dayhm}}
!{{note}}`,
    },
    claude: {
      name: 'Claude Code hôm nay',
      template:
`> [icon:claude] CLAUDE | {{now.weekday}} {{now.date}}
Tin nhắn | {{claude.today.messages|num}}
Token ra | {{claude.today.output_tokens|k}}
[bar:{{claude_limits.five_hour.percent}}] 5 giờ · {{claude_limits.five_hour.resets}}
[bar:{{claude_limits.seven_day.percent}}] 7 ngày · {{claude_limits.seven_day.resets}}
!{{note}}`,
    },
    todo: {
      name: 'Việc cần làm',
      template:
`> VIỆC HÔM NAY | {{now.date}}
{{todo.0}}
{{todo.1}}
{{todo.2}}
---
!{{note}}`,
    },
    big: {
      name: 'Số lớn + ghi chú',
      template:
`## {{title}}
# {{claude.today.output_tokens|k}}
Cập nhật {{now.time}} · {{now.weekday}}`,
    },
    custom: { name: 'Tự viết…', template: '' },
  };
  const SAMPLE_JSON = {
    title: 'Token ra hôm nay',
    note: 'Uống nước nhé!',
    todo: ['☐ Gửi báo cáo', '☐ Review PR', '☐ Đi chợ'],
    claude: {
      today: { messages: 128, output_tokens: 245300, sessions: 6 },
      window5h: { output_tokens: 61000, budget: 150000, percent: 41 },
    },
    claude_limits: {
      five_hour: { percent: 37, resets: '01:40', resets_at: 1792900000 },
      seven_day: { percent: 62, resets: 'T3 09:00', resets_at: 1793000000 },
    },
  };

  /* ---------------- Trạng thái ---------------- */
  const state = {
    tab: 'dash',
    profile: 'nrf52_2.13',
    data: SAMPLE_JSON,
    free: {
      background: '#ffffff', image: null, fit: 'cover', zoom: 1, offsetX: 0, offsetY: 0,
      texts: [{ text: 'Xin chào!', x: 12, y: 14, size: 34, color: '#000000', bold: true, align: 'left' },
              { text: 'Đồng hồ của tôi', x: 12, y: 60, size: 18, color: '#ff0000', bold: false, align: 'left' }],
      selected: 0,
    },
    lastUploadedHash: null,
    autoTimer: null,
  };
  const work = document.createElement('canvas');
  const preview = $('preview');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('epd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('epd.' + k, JSON.stringify(v)); } catch { /* bỏ qua */ } },
  };

  /* ---------------- Log ---------------- */
  function log(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = kind;
    el.textContent = `${new Date().toLocaleTimeString('vi-VN')}  ${msg}`;
    $('log').appendChild(el);
    $('log').scrollTop = $('log').scrollHeight;
  }
  clock.addEventListener('log', e => log(e.detail.msg, e.detail.kind));

  async function guard(fn) {
    try { await fn(); } catch (e) { log(e.message || String(e), 'error'); }
  }

  /* ---------------- Kết nối ---------------- */
  function refreshDeviceInfo() {
    const on = clock.connected;
    $('status-pill').textContent = on ? `Đã kết nối · ${clock.protocol === 'nrf52' ? 'nRF52' : 'DA14585'}` : 'Chưa kết nối';
    $('status-pill').classList.toggle('on', on);
    $('i-name').textContent = clock.device?.name || '–';
    $('i-proto').textContent = clock.protocol || '–';
    $('i-fw').textContent = clock.firmware ? `v${clock.firmware}` : '–';
    const prof = clock.detectedProfile();
    $('i-panel').textContent = prof ? PROFILES[prof].label : (on ? 'chưa rõ — chọn tay' : '–');
    $('i-mode').textContent = on ? String(clock.displayMode) : '–';
    $('i-batt').textContent = clock.batteryMv ? `${(clock.batteryMv / 1000).toFixed(2)} V` : '–';
    document.querySelectorAll('.da-only').forEach(el => { el.hidden = clock.protocol !== 'da14585'; });
    for (const id of ['btn-time', 'btn-clock', 'btn-calendar', 'btn-mode-num', 'btn-raw', 'btn-upload', 'btn-disconnect'])
      $(id).disabled = !on || clock.busy;
    $('btn-reconnect').disabled = !clock.device || clock.busy;
    if (prof && prof !== state.profile) setProfile(prof);
  }
  clock.addEventListener('change', refreshDeviceInfo);

  if (!navigator.bluetooth) {
    $('bt-warning').hidden = false;
    $('bt-warning').textContent = 'Trình duyệt này không có Web Bluetooth. Mở trang bằng Chrome/Edge trên máy tính hoặc Android. Trên iPhone, Chrome và Safari đều không có Bluetooth: cài app Bluefy rồi mở trang này trong Bluefy.';
  }

  $('btn-scan').onclick = () => guard(() => clock.scanAndConnect($('scan-filter').value));
  $('btn-reconnect').onclick = () => guard(() => clock.reconnect());
  $('btn-disconnect').onclick = () => clock.disconnect();
  $('btn-clear-log').onclick = () => { $('log').innerHTML = ''; };

  const weekStart = () => Number($('week-start').value);
  $('btn-time').onclick = () => guard(() => clock.syncTime({ hourOffset: Number($('hour-offset').value) || 0, weekStart: weekStart() }));
  $('btn-clock').onclick = () => guard(() => clock.setMode(2, { weekStart: weekStart() }));
  $('btn-calendar').onclick = () => guard(() => clock.setMode(1, { weekStart: weekStart() }));
  $('btn-mode-num').onclick = () => guard(() => clock.setMode(Number($('mode-num').value) & 0x7f, { weekStart: weekStart() }));
  $('btn-raw').onclick = () => guard(() => clock.sendRawHex($('raw-hex').value, $('raw-target').value));

  /* ---------------- Kích thước màn ---------------- */
  for (const [k, p] of Object.entries(PROFILES)) $('profile').add(new Option(p.label, k));
  function setProfile(k) {
    state.profile = k;
    $('profile').value = k;
    const p = PROFILES[k];
    $('opt-red').disabled = !!p.bwOnly;
    store.set('profile', k);
    render();
  }
  $('profile').onchange = () => setProfile($('profile').value);

  /* ---------------- Render ---------------- */
  function render() {
    const p = PROFILES[state.profile];
    work.width = p.w; work.height = p.h;
    const ctx = work.getContext('2d');
    const useRed = $('opt-red').checked && !p.bwOnly;
    if (state.tab === 'dash') {
      const m = Math.max(0, Number($('dash-margin').value) || 0);
      const mb = Math.max(0, Number($('dash-margin-bottom').value) || 0);
      // Xoay 180° đảo cạnh trên/dưới, nên lề dưới phải vẽ ở phía trên trước khi xoay.
      const margin = $('opt-rotate').checked
        ? { top: mb, right: m, bottom: m, left: m }
        : { top: m, right: m, bottom: mb, left: m };
      D.drawDashboard(ctx, p.w, p.h, $('dash-template').value, state.data, { red: useRed, margin });
    }
    else D.drawFreeform(ctx, p.w, p.h, state.free);
    D.quantize(work, preview, {
      red: useRed,
      dither: $('opt-dither').checked,
      threshold: Number($('opt-threshold').value),
      rotate: $('opt-rotate').checked,
      crisp: state.tab === 'dash' && !$('opt-dither').checked,
    });
  }
  ['opt-red', 'opt-dither', 'opt-rotate', 'opt-threshold'].forEach(id => $(id).addEventListener('input', render));
  ['dash-margin', 'dash-margin-bottom'].forEach(id => {
    $(id).value = store.get(id, $(id).value);
    $(id).addEventListener('input', () => { store.set(id, $(id).value); render(); });
  });

  /* ---------------- Tabs ---------------- */
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== state.tab; });
    if (state.tab === 'free') $('opt-dither').checked = !!state.free.image;
    else $('opt-dither').checked = false;
    render();
  });

  /* ---------------- Bảng thông tin ---------------- */
  for (const [k, p] of Object.entries(PRESETS)) $('dash-preset').add(new Option(p.name, k));
  $('dash-preset').onchange = () => {
    const p = PRESETS[$('dash-preset').value];
    if (p.template) $('dash-template').value = p.template;
    store.set('template', $('dash-template').value);
    render();
  };
  $('dash-template').value = store.get('template', PRESETS.claude_en.template);
  $('dash-template').addEventListener('input', () => { store.set('template', $('dash-template').value); $('dash-preset').value = 'custom'; render(); });

  $('dash-source').onchange = () => {
    const paste = $('dash-source').value === 'paste';
    $('dash-url-row').hidden = paste;
    $('dash-json').hidden = !paste;
    store.set('source', $('dash-source').value);
  };
  $('dash-json').value = store.get('json', JSON.stringify(SAMPLE_JSON, null, 2));
  $('dash-json').addEventListener('input', () => {
    store.set('json', $('dash-json').value);
    try { state.data = JSON.parse($('dash-json').value); render(); } catch { /* đang gõ dở */ }
  });
  $('dash-url').value = store.get('url', 'data.json');
  $('dash-url').addEventListener('change', () => store.set('url', $('dash-url').value));

  async function loadData() {
    if ($('dash-source').value === 'paste') {
      state.data = JSON.parse($('dash-json').value);
      return;
    }
    const res = await fetch($('dash-url').value, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Không lấy được dữ liệu (HTTP ${res.status}).`);
    state.data = await res.json();
    log(`Đã lấy dữ liệu từ ${$('dash-url').value}`, 'ok');
  }
  $('btn-fetch').onclick = () => guard(async () => { await loadData(); render(); });

  // Tự động: lấy dữ liệu → vẽ → chỉ gửi khi ảnh thay đổi (tiết kiệm pin, tránh refresh thừa)
  async function autoTick() {
    try {
      await loadData();
      render();
      const h = D.hashCanvas(preview);
      if (!clock.connected) { $('auto-status').textContent = 'Chờ kết nối đồng hồ…'; return; }
      if (clock.busy) return;
      if (h === state.lastUploadedHash) { $('auto-status').textContent = `Không đổi · ${new Date().toLocaleTimeString('vi-VN')}`; return; }
      await upload();
      $('auto-status').textContent = `Đã gửi lúc ${new Date().toLocaleTimeString('vi-VN')}`;
    } catch (e) { log(`Tự động: ${e.message}`, 'error'); }
  }
  function setAuto() {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
    $('auto-status').textContent = '';
    if (!$('auto-on').checked) return;
    const min = Math.max(5, Number($('auto-min').value) || 30);
    $('auto-min').value = min;
    state.autoTimer = setInterval(autoTick, min * 60000);
    $('auto-status').textContent = `Bật · mỗi ${min} phút (giữ tab này mở)`;
    autoTick();
  }
  $('auto-on').onchange = setAuto;
  $('auto-min').onchange = setAuto;

  /* ---------------- Tự do ---------------- */
  const F = state.free;
  $('free-bg').onchange = () => { F.background = $('free-bg').value; render(); };
  $('free-fit').onchange = () => { F.fit = $('free-fit').value; render(); };
  $('free-zoom').oninput = () => { F.zoom = Number($('free-zoom').value); render(); };
  $('free-image').onchange = () => {
    const file = $('free-image').files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { F.image = img; F.offsetX = F.offsetY = 0; $('opt-dither').checked = true; render(); };
    img.src = URL.createObjectURL(file);
  };
  $('free-clear-image').onclick = () => { F.image = null; $('free-image').value = ''; $('opt-dither').checked = false; render(); };
  $('free-add-text').onclick = () => {
    F.texts.push({ text: 'Chữ mới', x: 10, y: 10, size: 20, color: '#000000', bold: false, align: 'left' });
    F.selected = F.texts.length - 1;
    renderTextLayers(); render();
  };

  function renderTextLayers() {
    const box = $('free-texts');
    box.innerHTML = '';
    F.texts.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'text-layer' + (i === F.selected ? ' selected' : '');
      el.innerHTML = `
        <textarea rows="1" aria-label="Nội dung chữ"></textarea>
        <div class="row">
          <label class="inline">Cỡ <input type="number" data-k="size" min="6" max="200"></label>
          <label class="inline">Màu <select data-k="color"><option value="#000000">Đen</option><option value="#ff0000">Đỏ</option><option value="#ffffff">Trắng</option></select></label>
          <label class="inline">Căn <select data-k="align"><option value="left">Trái</option><option value="center">Giữa</option><option value="right">Phải</option></select></label>
          <label class="inline"><input type="checkbox" data-k="bold"> Đậm</label>
          <label class="inline">X <input type="number" data-k="x"></label>
          <label class="inline">Y <input type="number" data-k="y"></label>
          <button class="ghost" data-del>Xoá</button>
        </div>`;
      const ta = el.querySelector('textarea');
      ta.value = t.text;
      ta.oninput = () => { t.text = ta.value; render(); };
      el.querySelectorAll('[data-k]').forEach(inp => {
        const k = inp.dataset.k;
        if (inp.type === 'checkbox') inp.checked = t[k]; else inp.value = t[k];
        inp.oninput = () => { t[k] = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value); render(); };
      });
      el.querySelector('[data-del]').onclick = () => { F.texts.splice(i, 1); F.selected = -1; renderTextLayers(); render(); };
      el.onfocusin = () => { if (F.selected !== i) { F.selected = i; box.querySelectorAll('.text-layer').forEach((n, j) => n.classList.toggle('selected', j === i)); } };
      box.appendChild(el);
    });
  }

  // Kéo chữ (hoặc ảnh nếu không trúng chữ) trên khung xem trước
  let drag = null;
  function canvasPoint(e) {
    const r = preview.getBoundingClientRect();
    let x = (e.clientX - r.left) * preview.width / r.width;
    let y = (e.clientY - r.top) * preview.height / r.height;
    if ($('opt-rotate').checked) { x = preview.width - x; y = preview.height - y; }
    return { x, y };
  }
  preview.addEventListener('pointerdown', e => {
    if (state.tab !== 'free') return;
    const pt = canvasPoint(e);
    const i = D.hitText(work.getContext('2d'), F, pt.x, pt.y);
    if (i >= 0) { F.selected = i; renderTextLayers(); drag = { kind: 'text', i, sx: pt.x, sy: pt.y, ox: F.texts[i].x, oy: F.texts[i].y }; }
    else if (F.image) drag = { kind: 'image', sx: pt.x, sy: pt.y, ox: F.offsetX, oy: F.offsetY };
    if (drag) preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = canvasPoint(e);
    const dx = Math.round(pt.x - drag.sx), dy = Math.round(pt.y - drag.sy);
    if (drag.kind === 'text') { F.texts[drag.i].x = drag.ox + dx; F.texts[drag.i].y = drag.oy + dy; }
    else { F.offsetX = drag.ox + dx; F.offsetY = drag.oy + dy; }
    render();
  });
  preview.addEventListener('pointerup', () => { if (drag && drag.kind === 'text') renderTextLayers(); drag = null; });

  /* ---------------- Gửi ảnh ---------------- */
  async function upload() {
    render();
    const hash = D.hashCanvas(preview);
    await clock.uploadImage(preview, state.profile, (pct, msg) => {
      $('upload-progress').value = pct;
      if (msg) $('upload-status').textContent = msg;
    });
    state.lastUploadedHash = hash;
  }
  $('btn-upload').onclick = () => guard(upload);
  $('btn-download').onclick = () => {
    const a = document.createElement('a');
    a.download = `epd-${state.profile}.png`;
    a.href = preview.toDataURL('image/png');
    a.click();
  };

  /* ---------------- Khởi động ---------------- */
  // Trên page public (GitHub Pages) không có server.py nên mặc định dùng JSON dán tay.
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  $('dash-source').value = store.get('source', isLocal ? 'url' : 'paste');
  $('dash-source').onchange();
  $('dash-preset').value = Object.keys(PRESETS).find(k => k !== 'custom' && PRESETS[k].template === $('dash-template').value) || 'custom';
  renderTextLayers();
  setProfile(store.get('profile', 'nrf52_2.13'));
  refreshDeviceInfo();
  if ($('dash-source').value === 'url') guard(async () => { await loadData(); render(); });
  else { try { state.data = JSON.parse($('dash-json').value); } catch { /* giữ dữ liệu mẫu */ } render(); }
  log('Sẵn sàng. Bấm “Quét & kết nối” để chọn đồng hồ.');
  if (!isLocal) log('Bản public: số liệu Claude chỉ có ở bản chạy trên máy (python3 server.py). Ở đây sửa JSON trong ô “Dán JSON”.');
})();
