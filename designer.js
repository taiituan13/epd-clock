/*
 * Vẽ nội dung cho màn e-paper: chế độ Tự do (ảnh + chữ) và Bảng thông tin
 * (mẫu văn bản + dữ liệu JSON). Kết quả cuối luôn là canvas đúng độ phân giải
 * màn hình, chỉ gồm 3 màu đen / trắng / đỏ.
 */
(function (root) {
  'use strict';

  const BLACK = [0, 0, 0], WHITE = [255, 255, 255], RED = [255, 0, 0];
  const FONT = '"Be Vietnam Pro", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /* ---------------- Lượng tử hoá về 2–3 màu ---------------- */

  // crisp: dành cho chữ/khối màu thuần (Bảng thông tin). Viền mờ của chữ được tính là mực
  // để nét không bị đứt, viền hồng quanh chữ đỏ được tính là đỏ.
  function quantize(src, dst, { red = true, dither = false, threshold = 128, rotate = false, crisp = false }) {
    const w = src.width, h = src.height;
    dst.width = w; dst.height = h;
    const sctx = src.getContext('2d');
    const img = sctx.getImageData(0, 0, w, h);
    const d = img.data;
    const palette = red ? [BLACK, WHITE, RED] : [BLACK, WHITE];
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      // nền trong suốt coi như trắng
      const a = d[i + 3] / 255;
      buf[j] = d[i] * a + 255 * (1 - a);
      buf[j + 1] = d[i + 1] * a + 255 * (1 - a);
      buf[j + 2] = d[i + 2] * a + 255 * (1 - a);
    }
    const shift = threshold - 128;
    const pick = (r, g, b) => {
      if (crisp) {
        if (red && r > 120 && r - Math.max(g, b) > 45) return RED;
        return (0.299 * r + 0.587 * g + 0.114 * b) >= threshold + 40 ? WHITE : BLACK;
      }
      if (!dither) {
        // Ngưỡng cứng: đỏ nếu sắc đỏ rõ, còn lại theo độ sáng
        if (red && r > 150 && g < 110 && b < 110) return RED;
        return (0.299 * r + 0.587 * g + 0.114 * b) >= threshold ? WHITE : BLACK;
      }
      let best = palette[0], bd = Infinity;
      for (const c of palette) {
        const cr = c === WHITE ? 255 + shift : c[0], dist = (r - cr) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (dist < bd) { bd = dist; best = c; }
      }
      return best;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 3;
      const c = pick(buf[j], buf[j + 1], buf[j + 2]);
      if (dither) {
        const er = buf[j] - c[0], eg = buf[j + 1] - c[1], eb = buf[j + 2] - c[2];
        const spread = (dx, dy, f) => {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= w || yy >= h) return;
          const k = (yy * w + xx) * 3;
          buf[k] += er * f; buf[k + 1] += eg * f; buf[k + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
      const i = (rotate ? ((h - 1 - y) * w + (w - 1 - x)) : (y * w + x)) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    // ghi vào canvas đích (img đã được ghi đè tại chỗ)
    const out = new ImageData(d, w, h);
    dst.getContext('2d').putImageData(out, 0, 0);
  }

  /* ---------------- Chế độ Tự do ---------------- */

  function drawFreeform(ctx, w, h, s) {
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, w, h);
    if (s.image) {
      const iw = s.image.width, ih = s.image.height;
      const scale = (s.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * s.zoom;
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(s.image, (w - dw) / 2 + s.offsetX, (h - dh) / 2 + s.offsetY, dw, dh);
    }
    for (const t of s.texts) {
      ctx.font = `${t.bold ? 700 : 400} ${t.size}px ${FONT}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align;
      ctx.textBaseline = 'top';
      String(t.text).split('\n').forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.size * 1.15));
    }
  }

  // Trả về layer chữ nằm dưới điểm (x, y) để kéo thả
  function hitText(ctx, s, x, y) {
    for (let i = s.texts.length - 1; i >= 0; i--) {
      const t = s.texts[i];
      ctx.font = `${t.bold ? 700 : 400} ${t.size}px ${FONT}`;
      const lines = String(t.text).split('\n');
      const width = Math.max(...lines.map(l => ctx.measureText(l).width));
      const left = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
      if (x >= left - 4 && x <= left + width + 4 && y >= t.y - 4 && y <= t.y + lines.length * t.size * 1.15 + 4) return i;
    }
    return -1;
  }

  /* ---------------- Chế độ Bảng thông tin ---------------- */

  const WEEKDAYS = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function builtins() {
    const n = new Date();
    const p = v => String(v).padStart(2, '0');
    return {
      time: `${p(n.getHours())}:${p(n.getMinutes())}`,
      date: `${p(n.getDate())}/${p(n.getMonth() + 1)}`,
      year: n.getFullYear(),
      weekday: WEEKDAYS[n.getDay()],
      weekday_en: WEEKDAYS_EN[n.getDay()],
      date_en: `${MONTHS_EN[n.getMonth()]} ${n.getDate()}`,
    };
  }

  function lookup(data, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
  }

  const FORMATS = {
    num: v => Number(v).toLocaleString('vi-VN'),
    k: v => {
      const x = Number(v);
      if (!isFinite(x)) return v;
      if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace('.0', '') + 'M';
      if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(x >= 1e4 ? 0 : 1).replace('.0', '') + 'k';
      return String(x);
    },
    pct: v => `${Math.round(Number(v))}%`,
    time: v => { const d = new Date(v); return isNaN(d) ? v : d.toTimeString().slice(0, 5); },
    date: v => { const d = new Date(v); return isNaN(d) ? v : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; },
    num_en: v => Number(v).toLocaleString('en-US'),
    // epoch giây → "03:59" / "Wed 07:59"
    hm: v => hhmm(new Date(Number(v) * 1000)),
    dayhm: v => { const d = new Date(Number(v) * 1000); return `${WEEKDAYS_EN[d.getDay()]} ${hhmm(d)}`; },
    upper: v => String(v).toUpperCase(),
    round: v => String(Math.round(Number(v))),
  };

  function fillTemplate(tpl, data) {
    const ctx = Object.assign({ now: builtins() }, data);
    return tpl.replace(/\{\{\s*([\w.$-]+)\s*(?:\|\s*(\w+))?\s*\}\}/g, (_, path, fmt) => {
      const v = lookup(ctx, path);
      if (v === undefined || v === null) return '–';
      return fmt && FORMATS[fmt] ? FORMATS[fmt](v) : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
  }

  function fitFont(ctx, text, weight, size, maxWidth) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${FONT}`; } while (ctx.measureText(text).width > maxWidth && --s > 7);
    return s;
  }

  /*
   * Cú pháp mỗi dòng:
   *   > Tiêu đề        thanh tiêu đề nền đen chữ trắng
   *   # Chữ lớn        chữ đậm cỡ lớn
   *   ## Chữ vừa       chữ đậm cỡ vừa
   *   ---              đường kẻ ngang
   *   [bar:73] Nhãn    thanh tiến độ 0–100
   *   Trái | Phải      2 cột, căn trái và phải
   *   !dòng            tô đỏ (thêm ! ngay sau ký hiệu, ví dụ "#!", ">!")
   *   [icon:claude] …  vẽ icon trước chữ (đặt sau các ký hiệu trên, ví dụ "> [icon:claude] CLAUDE")
   */
  // margin: lề {top, right, bottom, left} (px) để viền máy không che chữ.
  // Nội dung cao hơn vùng còn lại thì thu nhỏ chữ cho vừa.
  function drawDashboard(ctx, w, h, template, data, { red = true, margin = {} } = {}) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    const { top = 0, right = 0, bottom = 0, left = 0 } = margin;
    const iw = Math.max(20, w - left - right), ih = Math.max(20, h - top - bottom);
    const lines = fillTemplate(template, data).split('\n');
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath(); ctx.rect(0, 0, iw, ih); ctx.clip();
    let scale = 1;
    for (let i = 0; i < 4; i++) {
      const used = drawDashboardLines(ctx, iw, ih, lines, red, scale);
      if (used <= ih + 0.5) break;
      scale *= ih / used;
    }
    ctx.restore();
  }

  // Ngôi sao tia của Claude: các tia thon dần, dài ngắn xen kẽ cho giống dấu vẽ tay.
  const SPARK_RAYS = [1, 0.74, 0.94, 0.7, 1, 0.8, 0.9, 0.72, 0.98, 0.78, 0.92, 0.7];
  function drawIcon(ctx, name, cx, cy, r, color) {
    if (name !== 'claude') return;
    ctx.fillStyle = color;
    const base = r * 0.13, tip = r * 0.06;
    SPARK_RAYS.forEach((len, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / SPARK_RAYS.length + (i % 2 ? 0.06 : -0.04);
      const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
      const tx = cx + ux * (r * len - tip), ty = cy + uy * (r * len - tip);
      ctx.beginPath();
      ctx.moveTo(cx + px * base, cy + py * base);
      ctx.lineTo(tx + px * tip, ty + py * tip);
      ctx.arc(tx, ty, tip, a + Math.PI / 2, a - Math.PI / 2, true);
      ctx.lineTo(cx - px * base, cy - py * base);
      ctx.closePath();
      ctx.fill();
    });
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.17, 0, 2 * Math.PI); ctx.fill();
  }

  function drawDashboardLines(ctx, w, h, lines, red, scale) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    const base = Math.max(8, Math.round(h * 0.115 * scale));
    const pad = Math.max(4, Math.round(w * 0.02));
    const ink = isRed => (isRed && red ? '#f00' : '#000');
    let y = 0;

    for (let raw of lines) {
      let kind = 'text';
      let m;
      if (raw.startsWith('>')) { kind = 'header'; raw = raw.slice(1); }
      else if (raw.startsWith('##')) { kind = 'mid'; raw = raw.slice(2); }
      else if (raw.startsWith('#')) { kind = 'big'; raw = raw.slice(1); }
      else if (/^\s*-{3,}\s*$/.test(raw)) kind = 'rule';
      const isRed = raw.startsWith('!');
      if (isRed) raw = raw.slice(1);
      raw = raw.trim();
      let icon = null;
      if ((m = /^\[icon:([\w-]+)\]\s*/.exec(raw))) { icon = m[1]; raw = raw.slice(m[0].length); }
      // Icon màu đỏ (gần cam Claude nhất), khi tắt màu đỏ thì theo màu chữ.
      const iconInk = fallback => (red ? '#f00' : fallback);

      if (kind === 'rule') {
        ctx.fillStyle = '#000';
        ctx.fillRect(pad, y + 2, w - pad * 2, 1);
        y += 5;
        continue;
      }
      if (!raw && kind === 'text') { y += Math.round(base * 0.5); continue; }

      if (kind === 'header') {
        const lh = Math.round(base * 1.5);
        ctx.fillStyle = ink(isRed);
        ctx.fillRect(0, y, w, lh);
        const iconR = icon ? lh * 0.42 : 0, iconW = icon ? Math.round(iconR * 2 + pad * 0.6) : 0;
        if (icon) drawIcon(ctx, icon, pad + iconR, y + lh / 2, iconR, iconInk('#fff'));
        ctx.fillStyle = '#fff';
        const [l, r] = raw.split('|').map(s => s.trim());
        fitFont(ctx, raw.replace('|', '  '), 700, Math.round(base * 1.05), w - pad * 2 - iconW);
        ctx.textAlign = 'left'; ctx.fillText(l, pad + iconW, y + lh / 2 + 1);
        if (r) { ctx.textAlign = 'right'; ctx.fillText(r, w - pad, y + lh / 2 + 1); }
        y += lh + Math.round(base * 0.3);
        continue;
      }

      if ((m = /^\[bar:\s*(-?[\d.]+|–)\s*\]\s*(.*)$/.exec(raw))) {
        const v = Math.max(0, Math.min(100, Number(m[1]) || 0));
        const lh = Math.round(base * 1.35);
        ctx.font = `400 ${base}px ${FONT}`;
        const label = m[2];
        const pctText = `${Math.round(v)}%`;
        const labelW = label ? Math.min(ctx.measureText(label).width + pad, w * 0.45) : 0;
        const pctW = ctx.measureText('100%').width + pad;
        ctx.fillStyle = '#000'; ctx.textAlign = 'left';
        if (label) { fitFont(ctx, label, 600, base, labelW - pad); ctx.fillText(label, pad, y + lh / 2); }
        const bx = pad + labelW, bw = w - pad * 2 - labelW - pctW, bh = Math.round(lh * 0.6), by = y + (lh - bh) / 2;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#fff'; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
        ctx.fillStyle = ink(isRed || v >= 90); ctx.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * v / 100), bh - 4);
        ctx.fillStyle = '#000'; ctx.font = `700 ${base}px ${FONT}`; ctx.textAlign = 'right';
        ctx.fillText(pctText, w - pad, y + lh / 2);
        y += lh;
        continue;
      }

      const size = kind === 'big' ? Math.round(base * 2.1) : kind === 'mid' ? Math.round(base * 1.4) : base;
      const weight = kind === 'text' ? 600 : 700;
      const lh = Math.round(size * 1.3);
      const iconR = icon ? size * 0.55 : 0, iconW = icon ? Math.round(iconR * 2 + pad * 0.6) : 0;
      const cols = raw.split('|').map(s => s.trim());
      let x = pad;
      if (cols.length >= 2) {
        ctx.font = `${weight} ${size}px ${FONT}`;
        const rw = ctx.measureText(cols[1]).width;
        fitFont(ctx, cols[0], weight, size, w - pad * 3 - rw - iconW);
      } else {
        fitFont(ctx, raw, weight, size, w - pad * 2 - iconW);
        if (kind === 'big') x = (w - iconW - ctx.measureText(raw).width) / 2;
      }
      if (icon) drawIcon(ctx, icon, x + iconR, y + lh / 2, iconR, iconInk(ink(isRed)));
      ctx.fillStyle = ink(isRed);
      ctx.textAlign = 'left';
      ctx.fillText(cols[0], x + iconW, y + lh / 2);
      if (cols.length >= 2) {
        ctx.font = `700 ${size}px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText(cols[1], w - pad, y + lh / 2);
      }
      y += lh;
    }
    return y;
  }

  function hashCanvas(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hsh = 2166136261;
    for (let i = 0; i < d.length; i += 4) hsh = Math.imul(hsh ^ (d[i] + d[i + 1] * 3), 16777619);
    return `${canvas.width}x${canvas.height}:${hsh >>> 0}`;
  }

  root.EpdDesigner = { quantize, drawFreeform, hitText, drawDashboard, fillTemplate, hashCanvas, FONT };
})(window);
