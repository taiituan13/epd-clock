/*
 * Giao thức Bluetooth cho đồng hồ mực điện tử (e-paper), tái hiện từ
 * https://tanhoangphuc842002-rgb.github.io/
 *
 * Hỗ trợ 2 dòng chip:
 *  - nRF52  (tên BLE "NRF_EPD...")   service 62750001-..., characteristic 62750002-...
 *  - DA14585 (tên BLE "DLG-CLOCK...") service 1F10 / char 1F1F (lệnh), service 13187b10-... (ảnh)
 */
(function (root) {
  'use strict';

  const NRF52 = {
    SERVICE: '62750001-d828-918d-fb46-b6c11c675aec',
    CHAR: '62750002-d828-918d-fb46-b6c11c675aec',
    APP_VERSION: '62750003-d828-918d-fb46-b6c11c675aec',
    DFU_SERVICE: '0000fe59-0000-1000-8000-00805f9b34fb',
    CMD_INIT: 0x01,
    CMD_SEND_COMMAND: 0x03,
    CMD_SEND_DATA: 0x04,
    CMD_REFRESH: 0x05,
    CMD_SET_TIME: 0x20,
    CMD_SET_WEEK_START: 0x21,
    CMD_WRITE_IMAGE: 0x30,
    CMD_ACTIVATE: 0xa0,
  };
  const DA = {
    RXTX_SERVICE: '00001f10-0000-1000-8000-00805f9b34fb',
    RXTX_CHAR: '00001f1f-0000-1000-8000-00805f9b34fb',
    LEGACY_SERVICE: '13187b10-eba9-a3ba-044e-83d3217d9a38',
    LEGACY_CHAR: '4b646063-6264-f3a7-8941-e65356ea82fe',
    DFU_SERVICE: '0000221f-0000-1000-8000-00805f9b34fb',
  };
  const ALL_SERVICES = [NRF52.SERVICE, NRF52.DFU_SERVICE, DA.RXTX_SERVICE, DA.LEGACY_SERVICE, DA.DFU_SERVICE];

  // Firmware nRF52 có lịch "native": cần cờ 0x40 khi cài giờ để không nhảy mặt.
  const NATIVE_CAL_213 = [141,142,143,144,149,150,151,152,153,154,155,156,159,160,161,162,163,164,165,166,174,175,178,179,180,181,182,185,186,189,190,193,194,197,198,199,200,203,204,205,206,209,210,213,214,217,218,219,220,223,224,227,228,229,232,233,236,237,242,243];
  const NATIVE_CAL_290 = [145,146,147,148,157,158,167,168,170,171,172,173,176,177,183,184,187,188,191,192,195,196,207,208,211,212,215,216,221,222,225,226,230,231,234,235,238,239,244,241,245];
  const OLD_290_VERSIONS = [58,60,61,67,133,134,135,136];

  // Kích thước màn hình theo cấu hình
  const PROFILES = {
    'nrf52_2.13': { proto: 'nrf52', w: 250, h: 128, label: 'nRF52 2.13" 250×128' },
    'nrf52_2.9':  { proto: 'nrf52', w: 296, h: 128, label: 'nRF52 2.9" 296×128' },
    'nrf52_4.2':  { proto: 'nrf52', w: 400, h: 300, label: 'nRF52 4.2" 400×300 BWR' },
    'nrf52_4.2bw':{ proto: 'nrf52', w: 400, h: 300, label: 'nRF52 4.2" 400×300 BW', bwOnly: true },
    'nrf52_7.5':  { proto: 'nrf52', w: 800, h: 480, label: 'nRF52 7.5" 800×480 BWR' },
    'da_212':     { proto: 'da14585', w: 212, h: 104, label: 'DA14585 2.13" 212×104', bwOnly: true },
    'da_250':     { proto: 'da14585', w: 250, h: 128, label: 'DA14585 2.13" 250×128', bwOnly: true },
    'da_296':     { proto: 'da14585', w: 296, h: 128, label: 'DA14585 2.9" 296×128 BWR' },
    'da_400':     { proto: 'da14585', w: 400, h: 300, label: 'DA14585 4.2" 400×300 BWR' },
  };

  const delay = ms => new Promise(r => setTimeout(r, ms));
  // Chờ trước mỗi lần tự kết nối lại (giây); hết mảng thì giữ mức cuối.
  const RETRY_S = [2, 5, 15, 30, 60];
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = s => {
    const clean = s.replace(/[^0-9a-f]/gi, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  };

  class EpdClock extends EventTarget {
    constructor() {
      super();
      this.reset();
      this.device = null;
      this._manual = false;     // người dùng bấm Ngắt → không tự kết nối lại
      this._connecting = false;
      this._retry = 0;
      this._retryTimer = null;
    }

    reset() {
      this.server = null;
      this.protocol = null;     // 'nrf52' | 'da14585'
      this.epdChar = null;      // nRF52 char, hoặc DA14585 char ảnh
      this.rxtxChar = null;     // DA14585 char lệnh
      this.firmware = 0;
      this.modelId = null;
      this.panel = null;        // 0x21 (2.13) | 0x29 (2.9)
      this.displayMode = 1;
      this.weekStartSupported = false;
      this.chunkSize = 128;
      this.daSize = null;
      this.batteryMv = null;
      this.busy = false;
      this._queue = Promise.resolve();
      this._waiters = [];
    }

    get connected() { return !!(this.server && this.server.connected); }

    log(msg, kind = 'info') { this.dispatchEvent(new CustomEvent('log', { detail: { msg, kind } })); }
    changed() { this.dispatchEvent(new Event('change')); }

    /* ---------------- Kết nối ---------------- */

    scanOptions(filter) {
      const optionalServices = ALL_SERVICES.slice();
      if (filter === 'all') return { acceptAllDevices: true, optionalServices };
      if (filter === 'nrf') return { filters: [{ namePrefix: 'NRF_EPD' }], optionalServices };
      if (filter === 'dlg') return { filters: [{ namePrefix: 'DLG-CLOCK' }], optionalServices };
      const names = [{ namePrefix: 'NRF_EPD' }, { namePrefix: 'DLG-CLOCK' }];
      const ios = /iPad|iPhone|iPod|Bluefy/i.test(navigator.userAgent);
      return { filters: ios ? names : optionalServices.map(s => ({ services: [s] })).concat(names), optionalServices };
    }

    async scanAndConnect(filter = 'supported') {
      if (!navigator.bluetooth) {
        throw new Error('Trình duyệt không hỗ trợ Web Bluetooth. Dùng Chrome/Edge trên máy tính hoặc Android. iPhone dùng app Bluefy (Chrome/Safari trên iPhone không có Bluetooth).');
      }
      const device = await navigator.bluetooth.requestDevice(this.scanOptions(filter));
      if (this.device) this.device.removeEventListener('gattserverdisconnected', this._onDisc);
      this.device = device;
      this._onDisc = () => {
        if (this._connecting) return;  // connect() đang chạy sẽ tự báo lỗi
        this.log('Đồng hồ đã ngắt kết nối.', 'warn');
        this.reset();
        this.changed();
        if (!this._manual) this._scheduleReconnect();
      };
      device.addEventListener('gattserverdisconnected', this._onDisc);
      this._stopRetry();
      this._manual = false;
      await this.connect();
    }

    async reconnect() {
      if (!this.device) throw new Error('Chưa chọn thiết bị nào. Hãy bấm Quét.');
      this._stopRetry();
      this._manual = true;
      if (this.device.gatt.connected) this.device.gatt.disconnect();
      this.reset();
      await delay(300);
      this._manual = false;
      await this.connect();
    }

    disconnect() {
      this._manual = true;
      this._stopRetry();
      if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    }

    async connect() {
      this.log(`Đang kết nối ${this.device.name || '(không tên)'}…`);
      this._connecting = true;
      try {
        this.server = await this.device.gatt.connect();
        try {
          await this._connectNrf52();
        } catch (e) {
          this.epdChar = null;
          await this._connectDa14585();
        }
      } finally {
        this._connecting = false;
      }
      this._retry = 0;
      this.changed();
    }

    // Đồng hồ hay tự ngắt (máy ngủ, ra xa, firmware tiết kiệm pin): thử lại, giãn dần tới 60 giây.
    _scheduleReconnect() {
      clearTimeout(this._retryTimer);
      const wait = RETRY_S[Math.min(this._retry, RETRY_S.length - 1)];
      this._retry++;
      if (this._retry <= RETRY_S.length) this.log(`Tự kết nối lại sau ${wait} giây…`);
      this._retryTimer = setTimeout(async () => {
        if (this._manual || this.connected || this._connecting) return;
        try {
          await this.connect();
          this.log('Đã kết nối lại.', 'ok');
        } catch (e) {
          this.reset();
          this.changed();
          if (!this._manual) this._scheduleReconnect();
        }
      }, wait * 1000);
    }

    _stopRetry() {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._retry = 0;
    }

    async _connectNrf52() {
      const svc = await this.server.getPrimaryService(NRF52.SERVICE);
      this.epdChar = await svc.getCharacteristic(NRF52.CHAR);
      try {
        const v = await (await svc.getCharacteristic(NRF52.APP_VERSION)).readValue();
        this.firmware = v.getUint8(0);
      } catch { this.firmware = 0; }
      this.protocol = 'nrf52';
      this.log(`Giao thức nRF52, firmware v${this.firmware}`);
      // Đăng ký listener TRƯỚC khi bật notify: firmware gửi cấu hình ngay lập tức.
      this.epdChar.addEventListener('characteristicvaluechanged', e => this._onNotify(e));
      await this.epdChar.startNotifications();
      await this.write(this.epdChar, [NRF52.CMD_INIT]);
      await delay(80);
    }

    async _connectDa14585() {
      const rx = await this.server.getPrimaryService(DA.RXTX_SERVICE);
      this.rxtxChar = await rx.getCharacteristic(DA.RXTX_CHAR);
      this.protocol = 'da14585';
      this.log('Giao thức DA14585');
      try {
        const legacy = await this.server.getPrimaryService(DA.LEGACY_SERVICE);
        this.epdChar = await legacy.getCharacteristic(DA.LEGACY_CHAR);
        try {
          this.epdChar.addEventListener('characteristicvaluechanged', e => this._onNotify(e));
          await this.epdChar.startNotifications();
          // Firmware mới trả lời FC 04 <w> <h>
          await this.write(this.epdChar, [0xfc, 0x03]);
          await delay(120);
        } catch { this.log('Không bật được notification (firmware cũ).', 'warn'); }
      } catch {
        this.epdChar = this.rxtxChar;
      }
    }

    /* ---------------- Notification ---------------- */

    _onNotify(event) {
      const v = event.target.value;
      const data = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const text = new TextDecoder().decode(data);
      for (const w of this._waiters.slice()) if (w.test(data, text)) { w.done(true); }

      let m;
      if ((m = /^v=(\d{3,5})\s*$/.exec(text))) {
        this.batteryMv = Number(m[1]);
        this.log(`Pin: ${(this.batteryMv / 1000).toFixed(2)} V`);
        return this.changed();
      }
      if ((m = /^mtu=(\d+)/.exec(text))) {
        this.chunkSize = Math.max(18, Math.min(244, Number(m[1]) - 2));
        this.log(`MTU ${m[1]} → gói ảnh ${this.chunkSize} byte`);
        return this.changed();
      }
      if (/^t=\d+\s*$/.test(text)) return this.log('Màn hình đã sẵn sàng (INIT).');
      if (text.startsWith('activation=')) return this.log(`Kích hoạt: ${text.trim()}`);
      if (data[0] === 0xfc && data[1] === 4 && this.protocol === 'da14585' && data.length >= 5) {
        const w = (data[2] << 8) | data[3];
        const h = data.length >= 6 ? (data[4] << 8) | data[5] : data[4];
        this.daSize = { w, h };
        this.log(`DA14585 báo màn hình ${w}×${h}`);
        return this.changed();
      }
      if (data[0] === 0x21 && data.length === 3) {
        return this.log(`Ngày đầu tuần: ${data[2] === 0 ? 'Chủ Nhật' : 'Thứ 2'} (trạng thái ${data[1]})`);
      }
      // Gói cấu hình nRF52: byte 7 = model, 11 = mode hiện tại, 12 = đầu tuần, 13 = panel
      if (this.protocol === 'nrf52' && data.length >= 8 && data.length <= 64 && [1, 2, 3, 4, 5, 7].includes(data[7])) {
        this.modelId = data[7];
        if (data.length > 11) this.displayMode = data[11];
        this.weekStartSupported = data.length > 12;
        this.panel = (this.modelId === 2 && data.length > 13 && [0x21, 0x29].includes(data[13])) ? data[13] : null;
        if (this.modelId === 2 && this.panel === null &&
            ((this.firmware >= 30 && this.firmware <= 39) || OLD_290_VERSIONS.includes(this.firmware))) this.panel = 0x29;
        this.log(`Model ${this.modelId}${this.panel ? `, panel 0x${this.panel.toString(16)}` : ''}, mode hiện tại ${this.displayMode}`);
        return this.changed();
      }
      this.log(`← ${text.trim() && /^[\x20-\x7e\s]+$/.test(text) ? text.trim() : hex(data)}`, 'rx');
    }

    _waitFor(test, timeout) {
      return new Promise(resolve => {
        const w = { test, done: ok => { clearTimeout(w.timer); this._waiters = this._waiters.filter(x => x !== w); resolve(ok); } };
        w.timer = setTimeout(() => w.done(false), timeout);
        this._waiters.push(w);
      });
    }

    /* ---------------- Ghi (tuần tự hoá) ---------------- */

    write(characteristic, bytes) {
      const packet = Uint8Array.from(bytes);
      const job = this._queue.then(() => {
        if (!characteristic || !this.connected) throw new Error('Chưa kết nối Bluetooth.');
        // Bluefy (iPhone) có thể chỉ có writeValue cũ
        const writeFn = characteristic.writeValueWithResponse || characteristic.writeValue;
        return writeFn.call(characteristic, packet);
      });
      this._queue = job.catch(() => {});
      return job;
    }
    sendEpd(bytes) { return this.write(this.epdChar, bytes); }
    sendRxtx(bytes) { return this.write(this.rxtxChar, bytes); }
    async sendRawHex(hexStr, target = 'epd') {
      const bytes = fromHex(hexStr);
      if (!bytes.length) throw new Error('Chuỗi hex rỗng.');
      await (target === 'rxtx' ? this.sendRxtx(bytes) : this.sendEpd(bytes));
      this.log(`→ ${hex(bytes)}`, 'tx');
    }

    /* ---------------- Giờ & chế độ ---------------- */

    _nativeCalendar() {
      return (NATIVE_CAL_213.includes(this.firmware) && this.panel === 0x21) ||
             (NATIVE_CAL_290.includes(this.firmware) && this.panel === 0x29);
    }

    async _nrf52SetTime(mode) {
      const ts = Math.floor(Date.now() / 1000);
      const tz = Math.round(-new Date().getTimezoneOffset() / 60);
      await this.sendEpd([NRF52.CMD_SET_TIME, (ts >>> 24) & 0xff, (ts >>> 16) & 0xff, (ts >>> 8) & 0xff, ts & 0xff, tz & 0xff, mode & 0xff]);
    }

    async setWeekStart(weekStart) {
      if (this.protocol !== 'nrf52' || !this.weekStartSupported) return;
      await this.sendEpd([NRF52.CMD_SET_WEEK_START, weekStart ? 1 : 0]);
      await delay(100);
    }

    /** Đồng bộ giờ từ máy tính/điện thoại sang đồng hồ. */
    async syncTime({ hourOffset = 0, weekStart = 1 } = {}) {
      if (this.protocol === 'nrf52') {
        await this.setWeekStart(weekStart);
        const keep = this._nativeCalendar() &&
          (this.panel === 0x21 ? [1, 7, 9] : [1, 5, 9]).includes(this.displayMode);
        await this._nrf52SetTime(this.displayMode | (keep ? 0x40 : 0));
      } else if (this.protocol === 'da14585') {
        // Firmware DA14585 tính theo UTC+8 nên cộng thêm 1 giờ (như page gốc).
        let unix = Math.round(Date.now() / 1000) + 3600 * hourOffset - new Date().getTimezoneOffset() * 60;
        const d = new Date((unix + new Date().getTimezoneOffset() * 60) * 1000);
        unix += 3600;
        const h = (n, b) => n.toString(16).padStart(b * 2, '0');
        await this.sendRxtx(fromHex('dd' + h(unix, 4) + h(d.getFullYear(), 2) + h(d.getMonth() + 1, 1) + h(d.getDate(), 1) + h(d.getDay() || 7, 1)));
        await this.sendRxtx([0xe2]);
      } else throw new Error('Chưa kết nối.');
      this.log(`Đã cài giờ: ${new Date().toLocaleString('vi-VN')}`, 'ok');
    }

    /**
     * mode: 1 = Lịch, 2 = Đồng hồ (bấm lặp lại để đổi mặt trên nRF52).
     * Với nRF52 có thể truyền số mode tuỳ ý (mặt đồng hồ khác tuỳ firmware).
     */
    async setMode(mode, { weekStart = 1 } = {}) {
      if (this.protocol === 'nrf52') {
        await this.setWeekStart(weekStart);
        await this._nrf52SetTime(mode);
        this.displayMode = mode & 0x3f;
      } else if (this.protocol === 'da14585') {
        if (mode === 0) await this.sendRxtx([0xe1, 0x00]);
        else {
          await this.sendRxtx([0xe1, mode === 2 ? 0x02 : 0x01]);
          await delay(300);
          await this.sendRxtx([0xe2]);
        }
        await delay(600);
      } else throw new Error('Chưa kết nối.');
      this.log(`Đã gửi lệnh chuyển chế độ ${mode}`, 'ok');
    }

    /** Cấu hình màn phù hợp với thiết bị đang kết nối (null nếu chưa biết). */
    detectedProfile() {
      if (this.protocol === 'nrf52') {
        if (this.modelId === 7) return 'nrf52_7.5';
        if (this.modelId === 3) return 'nrf52_4.2';
        if (this.modelId === 4) return 'nrf52_4.2bw';
        if (this.panel === 0x21 || this.modelId === 1) return 'nrf52_2.13';
        if (this.panel === 0x29) return 'nrf52_2.9';
      }
      if (this.protocol === 'da14585') {
        const s = this.daSize;
        if (!s) return 'da_212';
        const key = Object.keys(PROFILES).find(k => PROFILES[k].proto === 'da14585' && PROFILES[k].w === s.w && PROFILES[k].h === s.h);
        return key || null;
      }
      return null;
    }

    /* ---------------- Gửi ảnh ---------------- */

    /**
     * canvas phải đúng kích thước profile và chỉ chứa 3 màu tuyệt đối:
     * đen (0,0,0), trắng (255,255,255), đỏ (255,0,0).
     */
    async uploadImage(canvas, profileKey, onProgress = () => {}) {
      const p = PROFILES[profileKey];
      if (!p) throw new Error('Chưa chọn kích thước màn hình.');
      if (canvas.width !== p.w || canvas.height !== p.h) throw new Error('Kích thước canvas không khớp màn hình.');
      if (p.proto !== this.protocol) throw new Error(`Cấu hình ${p.label} không khớp thiết bị (${this.protocol || 'chưa kết nối'}).`);
      if (this.busy) throw new Error('Đang bận, hãy chờ thao tác trước hoàn tất.');
      this.busy = true; this.changed();
      try {
        if (p.proto === 'nrf52') await this._uploadNrf52(canvas, profileKey, onProgress);
        else await this._uploadDa14585(canvas, profileKey, onProgress);
        onProgress(100, 'Hoàn tất!');
        this.log('Đã gửi ảnh lên đồng hồ.', 'ok');
      } finally {
        this.busy = false; this.changed();
      }
    }

    async _uploadNrf52(canvas, key, progress) {
      const is290 = key === 'nrf52_2.9';
      const is213 = key === 'nrf52_2.13';
      const rowMajor = key === 'nrf52_4.2' || key === 'nrf52_4.2bw' || key === 'nrf52_7.5';
      // Màn 2.13" ba màu có máy báo model khác 2: vẫn ghi lớp đỏ, nếu không RAM đỏ giữ rác → hạt đỏ khắp màn
      const hasRed = key === 'nrf52_4.2' || key === 'nrf52_7.5' || is290 || is213;
      const stopClock = is290 || (is213 && this.modelId === 2);

      this.log(`Gửi ${hasRed ? '2 lớp (đen + đỏ)' : '1 lớp (đen)'} · model ${this.modelId}, panel ${this.panel === null ? '?' : '0x' + this.panel.toString(16)}`);
      progress(0, 'Đang khởi tạo màn hình…');
      if (stopClock) { await this._nrf52SetTime(0); await delay(150); }
      if (is290) {
        const ready = this._waitFor((d, t) => /^t=\d+\s*$/.test(t), 45000);
        await this.sendEpd([NRF52.CMD_INIT]);
        if (!await ready) throw new Error('Màn 2.9" chưa sẵn sàng. Hãy kết nối lại rồi thử lại.');
      } else {
        await this.sendEpd([NRF52.CMD_INIT]);
        await delay(100);
      }

      const pack = rowMajor ? packRowMajor : packColumnMajor;
      const black = pack(canvas, hasRed ? 'bwr-black' : 'bw');
      await this._nrf52Plane(black, true, 0, hasRed ? 48 : 95, progress);
      if (hasRed) {
        // Lớp đỏ của nRF52: 0 = đỏ, 1 = không đỏ → đảo bit.
        const red = pack(canvas, 'red').map(b => b ^ 0xff);
        await this._nrf52Plane(red, false, 48, 95, progress);
      }
      progress(97, 'Đang refresh màn hình…');
      if (is290) await this._nrf52SetTime(3);
      await this.sendEpd([NRF52.CMD_REFRESH]);
      if (stopClock) {
        for (let s = 32; s > 0; s--) { progress(97, `Màn hình đang refresh… ${s}s`); await delay(1000); }
      }
      this.displayMode = 0;
    }

    async _nrf52Plane(data, blackPlane, from, to, progress) {
      const size = this.chunkSize;
      const total = Math.ceil(data.length / size);
      for (let off = 0, i = 0; off < data.length; off += size, i++) {
        const begin = off === 0 ? 0x00 : 0xf0;
        const plane = blackPlane ? 0x0f : 0x00;
        await this.sendEpd([NRF52.CMD_WRITE_IMAGE, begin | plane, ...data.slice(off, off + size)]);
        progress(from + ((i + 1) / total) * (to - from), `Lớp ${blackPlane ? 'đen' : 'đỏ'}: ${i + 1}/${total}`);
        await delay(8);
      }
    }

    async _uploadDa14585(canvas, key, progress) {
      const w = canvas.width, h = canvas.height;
      if (key !== 'da_400') {
        // Báo kích thước cho firmware mới (firmware cũ bỏ qua lệnh 0x8F).
        await this.sendEpd([0x8f, (w >> 8) & 0xff, w & 0xff, (h >> 8) & 0xff, h & 0xff]);
        await delay(50);
      }
      const planes = key === 'da_296'
        ? [[packColumnMajor(canvas, 'bwr-black'), 0xff], [packColumnMajor(canvas, 'red'), 0x00]]
        : (key === 'da_212' || key === 'da_250')
          ? [[packColumnMajor(canvas, 'bw'), 0xff]]
          : [[packRowMajor(canvas, 'bwr-black'), 0xff], [packRowMajor(canvas, 'red'), 0x00]];
      const step = 16; // 4 byte header + 16 byte dữ liệu = 20 byte (ATT mặc định)
      const totalPackets = planes.reduce((n, [d]) => n + Math.ceil(d.length / step), 0);
      let sent = 0;
      for (const [data, code] of planes) {
        const cmd = (data.length * 2 === 7000 || data.length * 2 === 18000) ? 0x04 : 0x03;
        for (let off = 0; off < data.length; off += step) {
          await this.sendEpd([cmd, code, (off >> 8) & 0xff, off & 0xff, ...data.slice(off, off + step)]);
          sent++;
          progress((sent / totalPackets) * 95, `Đang gửi ${sent}/${totalPackets} gói`);
        }
      }
      await delay(300);
      await this.sendEpd([w === 280 || h === 180 ? 0xaa : 0x01]);
    }
  }

  /* ---------------- Đóng gói pixel → byte ---------------- */

  // bit = 1 nghĩa là "trắng" (hoặc "đỏ" với type 'red')
  function pixelBit(d, i, type) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const isRed = r > 160 && r > g && r > b;
    if (type === 'red') return r > 0 && g === 0 && b === 0 ? 1 : 0;
    if (type === 'bwr-black' && isRed) return 1;
    return r > 0 && g > 0 && b > 0 ? 1 : 0;
  }

  // Theo hàng, 8 pixel ngang / byte (màn 4.2", 7.5")
  function packRowMajor(canvas, type) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const out = []; let byte = 0, n = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      byte = (byte << 1) | pixelBit(d, (y * canvas.width + x) * 4, type);
      if (++n === 8) { out.push(byte); byte = 0; n = 0; }
    }
    return out;
  }

  // Theo cột, từ cột phải sang trái (màn 2.13", 2.9")
  function packColumnMajor(canvas, type) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const out = []; let byte = 0, n = 0;
    for (let x = canvas.width - 1; x >= 0; x--) for (let y = 0; y < canvas.height; y++) {
      byte = (byte << 1) | pixelBit(d, (y * canvas.width + x) * 4, type);
      if (++n === 8) { out.push(byte); byte = 0; n = 0; }
    }
    return out;
  }

  root.EpdClock = EpdClock;
  root.EPD_PROFILES = PROFILES;
})(window);
