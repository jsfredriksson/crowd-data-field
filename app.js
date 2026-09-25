/* ---------------------------------------------------------------------------
   Crowd Data Field — prototype
   camera -> presence mask -> decaying heat field -> typographic glyph field

   Resolution-independent: the canvas fills the browser window (or letterboxes
   to a locked ratio), and the sensor, heat field and type all follow.
   Type size is expressed against a 1200px reference, so your tuning means the
   same thing on a laptop as it will on an LED wall.

   The sensor is abstracted (see SENSORS). Today: MediaPipe segmentation on a
   webcam. Later: a depth camera, which only has to fill the same `mask` array
   with 0..1 presence. Nothing downstream changes.
--------------------------------------------------------------------------- */

import { ImageSegmenter, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const CDN   = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
const MASK_LONG  = IS_TOUCH ? 192 : 256;   // sensor resolution, long side
const MAX_PIXELS = IS_TOUCH ? 2.2e6 : 6e6; // backing-store cap
const REF = 1200;                          // type-size reference, short side

const out   = document.getElementById("out");
const ctx   = out.getContext("2d", { alpha: false });
const video = document.getElementById("src");
const crop  = document.getElementById("crop");
const cctx  = crop.getContext("2d", { willReadFrequently: true });
const boot  = document.getElementById("boot");

/* ---------- token sets -------------------------------------------------- */
/* weight = relative frequency in the field. Tune to shift the reading. */
const TOKEN_SETS = {
  metabolic: [
    ["VO₂", 34], ["CO₂", 20], ["H+", 20], ["¹³C", 13], ["DLW", 13],
  ],
  metabolic_wide: [
    ["VO₂", 24], ["CO₂", 14], ["H+", 14], ["¹³C", 9], ["DLW", 9],
    ["RER", 6], ["VE", 6], ["bpm", 6], ["mmol", 5], ["kJ", 4], ["W", 3],
  ],
  lactate: [
    ["La⁻", 26], ["H+", 22], ["pH", 16], ["HCO₃⁻", 12],
    ["mmol", 12], ["VO₂", 12],
  ],
  minimal: [ ["VO₂", 100] ],
};

/* ---------- params ------------------------------------------------------ */
const DEFAULTS = {
  facing: "user",
  format: "fill",
  tokenSet: "metabolic",
  fontSize: 20,      // px at REF short side
  leading: 2.6,
  density: 1.6,
  decay: 0.93,
  threshold: 0.06,
  falloff: 0.55,
  minAlpha: 0.14,
  mirror: true,
  showMask: false,
};
const P = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("cdf") || "{}") };

/* ---------- geometry, reallocated on resize ----------------------------- */
const S = { W: 0, H: 0, MW: 0, MH: 0, FW: 0, FH: 0, scale: 1 };
let mask = new Float32Array(1);
let heat = new Float32Array(1);
let blur = new Float32Array(1);

function layout() {
  const winW = Math.max(1, innerWidth), winH = Math.max(1, innerHeight);

  let cssW, cssH;
  if (P.format === "fill") {
    cssW = winW; cssH = winH;
  } else {
    const [a, b] = P.format.split(":").map(Number);
    const r = a / b;
    if (winW / winH > r) { cssH = winH; cssW = winH * r; }
    else                 { cssW = winW; cssH = winW / r; }
  }

  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w = Math.max(2, Math.round(cssW * dpr));
  let h = Math.max(2, Math.round(cssH * dpr));
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.round(w * k); h = Math.round(h * k);
  }

  out.width = w; out.height = h;
  out.style.width = Math.round(cssW) + "px";
  out.style.height = Math.round(cssH) + "px";
  S.W = w; S.H = h;

  // sensor + field follow the canvas aspect so nothing stretches
  const asp = w / h;
  let MW, MH;
  if (asp >= 1) { MW = MASK_LONG; MH = Math.round(MASK_LONG / asp); }
  else          { MH = MASK_LONG; MW = Math.round(MASK_LONG * asp); }
  MW = Math.max(32, MW - (MW % 2));
  MH = Math.max(32, MH - (MH % 2));

  S.MW = MW; S.MH = MH; S.FW = MW >> 1; S.FH = MH >> 1;
  mask = new Float32Array(MW * MH);
  heat = new Float32Array(S.FW * S.FH);
  blur = new Float32Array(S.FW * S.FH);
  crop.width = MW; crop.height = MH;

  S.scale = Math.min(w, h) / REF;
  widthCacheFor = -1;
  sensor?.resize?.();

  const r = document.getElementById("res");
  if (r) r.textContent = w + "×" + h;
}

/* ---------- deterministic per-slot randomness --------------------------- */
/* Tokens must stay put while the crowd moves through them, otherwise the
   whole field strobes. Seeded by grid position, not by frame.              */
function hash2(a, b) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---------- token picking ----------------------------------------------- */
let tokens = [], cumW = [], totalW = 0;
let widthCache = new Map(), widthCacheFor = -1;

function buildTokens() {
  const set = TOKEN_SETS[P.tokenSet] || TOKEN_SETS.metabolic;
  tokens = set.map(t => t[0]);
  cumW = []; totalW = 0;
  for (const [, w] of set) { totalW += w; cumW.push(totalW); }
  widthCacheFor = -1;
}
function pickToken(r) {
  const t = r * totalW;
  for (let i = 0; i < cumW.length; i++) if (t < cumW[i]) return tokens[i];
  return tokens[tokens.length - 1];
}
function tokenWidth(tok, fs) {
  if (widthCacheFor !== fs) { widthCache = new Map(); widthCacheFor = fs; }
  let w = widthCache.get(tok);
  if (w === undefined) { w = ctx.measureText(tok).width; widthCache.set(tok, w); }
  return w;
}

/* ---------- heat field -------------------------------------------------- */
function updateField() {
  const FW = S.FW, FH = S.FH, MW = S.MW, d = P.decay;
  for (let y = 0; y < FH; y++) {
    const r0 = (y * 2) * MW, r1 = (y * 2 + 1) * MW;
    for (let x = 0; x < FW; x++) {
      const x0 = x * 2;
      const v = (mask[r0 + x0] + mask[r0 + x0 + 1] +
                 mask[r1 + x0] + mask[r1 + x0 + 1]) * 0.25;
      const k = y * FW + x;
      heat[k] = v > heat[k] ? v : heat[k] * d;   // rise instantly, fall slowly
    }
  }
  // one cheap box blur -> softer, more dithered silhouette edge
  for (let y = 0; y < FH; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < FH - 1 ? y + 1 : FH - 1;
    const a = ym * FW, b = y * FW, c = yp * FW;
    for (let x = 0; x < FW; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < FW - 1 ? x + 1 : FW - 1;
      blur[b + x] = (
        heat[a + xm] + heat[a + x] + heat[a + xp] +
        heat[b + xm] + heat[b + x] + heat[b + xp] +
        heat[c + xm] + heat[c + x] + heat[c + xp]
      ) / 9;
    }
  }
}
function sampleField(u, v) {                 // u,v in 0..1
  let x = (u * S.FW) | 0, y = (v * S.FH) | 0;
  if (x < 0) x = 0; else if (x >= S.FW) x = S.FW - 1;
  if (y < 0) y = 0; else if (y >= S.FH) y = S.FH - 1;
  return blur[y * S.FW + x];
}

/* ---------- render ------------------------------------------------------ */
let maskCanvas = null;

function render() {
  const W = S.W, H = S.H;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (P.showMask) {
    if (!maskCanvas || maskCanvas.width !== S.FW || maskCanvas.height !== S.FH) {
      maskCanvas = document.createElement("canvas");
      maskCanvas.width = S.FW; maskCanvas.height = S.FH;
    }
    const mc = maskCanvas.getContext("2d");
    const img = mc.createImageData(S.FW, S.FH);
    for (let i = 0; i < S.FW * S.FH; i++) {
      const v = (blur[i] * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    mc.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.35;
    if (P.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(maskCanvas, 0, 0, W, H);
    ctx.restore();
  }

  const fs     = Math.max(5, P.fontSize * S.scale);
  const lead   = fs * P.leading;
  const space  = fs * 0.45;
  const gap    = fs * 1.15;        // advance when a slot stays empty
  const slotW  = fs * 1.3;         // stickiness grid
  // guideline margin: 3% of the format diagonal
  const margin = Math.max(Math.hypot(W, H) * 0.03, 10);

  ctx.font = fs + 'px "Maurten Mono", "MaurtenMono", ui-monospace, Menlo, monospace';
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";

  const rows = Math.max(1, Math.floor((H - margin * 2) / lead));
  const yOff = margin + (H - margin * 2 - rows * lead) / 2 + fs;

  for (let row = 0; row < rows; row++) {
    const y  = yOff + row * lead;
    const sv = (y - fs * 0.34) / H;             // sample at optical centre

    let x = margin;
    while (x < W - margin) {
      const slot = (x / slotW) | 0;
      const cu   = (x + gap * 0.5) / W;
      const h    = sampleField(P.mirror ? 1 - cu : cu, sv);

      if (h <= P.threshold) { x += gap; continue; }

      const r1 = hash2(row, slot);
      const r2 = hash2(row + 9173, slot);
      const r3 = hash2(row + 4421, slot);

      // normalised presence above threshold
      const n = Math.min(1, (h - P.threshold) / (1 - P.threshold));
      // probability a token exists here -> dithered, ragged edge
      const p = Math.min(1, Math.pow(n, 1 + P.falloff * 2) * P.density);

      if (r1 > p) { x += gap; continue; }

      const tok = pickToken(r2);
      const w   = tokenWidth(tok, fs);
      if (x + w > W - margin) break;

      ctx.globalAlpha = Math.min(
        1, P.minAlpha + (1 - P.minAlpha) * n * (0.62 + 0.38 * r3)
      );
      ctx.fillText(tok, x, y);
      x += w + space;
    }
  }
  ctx.globalAlpha = 1;
}

/* ---------- sensors ----------------------------------------------------- */
/* Each sensor fills `mask` (S.MW x S.MH, 0..1) from the cropped camera frame
   in `crop`. Add a depth sensor here — same contract.                      */

function drawCrop() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;
  const target = S.MW / S.MH;
  let sw = vw, sh = vw / target;
  if (sh > vh) { sh = vh; sw = vh * target; }
  cctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, S.MW, S.MH);
  return true;
}

async function mediapipeSensor() {
  const vision = await FilesetResolver.forVisionTasks(CDN);

  // GPU first; some iOS Safari builds refuse the WebGL delegate, and CPU is
  // still fast enough at this mask size. Only give up after both.
  let seg = null, delegate = "GPU";
  for (const d of ["GPU", "CPU"]) {
    try {
      seg = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: d },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      delegate = d;
      break;
    } catch (e) { console.warn(d + " delegate unavailable:", e); }
  }
  if (!seg) throw new Error("segmenter failed on both delegates");

  // The model's category indices differ between builds. Detect by checking the
  // frame border, which on a room-facing camera is overwhelmingly background.
  let borderAvg = 0.5, calibrated = 0;

  const consume = (res) => {
    const m = res?.categoryMask;
    if (!m) return;
    const d = m.getAsUint8Array();
    const mw = m.width, mh = m.height;
    const MW = S.MW, MH = S.MH;
    let border = 0, bn = 0;

    for (let y = 0; y < MH; y++) {
      const sy = mh === MH ? y : ((y * mh / MH) | 0);
      const srow = sy * mw, drow = y * MW;
      const edgeRow = y < 4 || y > MH - 5;
      for (let x = 0; x < MW; x++) {
        const sx = mw === MW ? x : ((x * mw / MW) | 0);
        const v = d[srow + sx] > 0 ? 1 : 0;
        mask[drow + x] = v;
        if (edgeRow || x < 4 || x > MW - 5) { border += v; bn++; }
      }
    }
    if (calibrated < 45 && bn) {
      borderAvg = borderAvg * 0.9 + (border / bn) * 0.1;
      calibrated++;
    }
    if (borderAvg > 0.6) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i];

    m.close?.();
    res.close?.();
  };

  return {
    name: "mediapipe · rgb segmentation · " + delegate.toLowerCase(),
    resize() { calibrated = 0; borderAvg = 0.5; },
    read(ts) {
      if (!drawCrop()) return;
      let done = false;
      const r = seg.segmentForVideo(crop, ts, (res) => { done = true; consume(res); });
      if (!done && r) consume(r);
    },
  };
}

/* Fallback: static-camera background subtraction. No model, no network.
   Rough, but keeps the piece alive offline or if the CDN is blocked.       */
function motionSensor() {
  let bg = null;
  return {
    name: "fallback · background subtraction",
    resize() { bg = null; },
    read() {
      if (!drawCrop()) return;
      const d = cctx.getImageData(0, 0, S.MW, S.MH).data;
      if (!bg || bg.length !== mask.length) bg = new Float32Array(mask.length);
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        const lum = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255;
        const diff = Math.abs(lum - bg[i]);
        mask[i] = diff > 0.09 ? Math.min(1, diff * 5) : 0;
        bg[i] = bg[i] * 0.985 + lum * 0.015;      // slow adaptation
      }
    },
  };
}

/* ---------- camera ------------------------------------------------------ */
let stream = null;

async function openCamera(facing) {
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  const tries = [
    { facingMode: { exact: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    true,
  ];
  let lastErr = null;
  for (const v of tries) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      video.srcObject = stream;
      await video.play();
      boot.classList.add("gone");
      return true;
    } catch (e) { lastErr = e; }
  }
  boot.className = "err";
  boot.textContent =
    "no camera. this page must be served over https (or http://localhost), and " +
    "camera access has to be allowed — " + (lastErr?.message || "unknown error");
  return false;
}

/* ---------- boot -------------------------------------------------------- */
let sensor = null, frames = 0, lastFpsT = performance.now();

async function start() {
  buildTokens();
  bindPanel();
  layout();

  // iOS will not hand over the camera without a user gesture, and a standalone
  // home-screen app gets exactly one chance at it. Gate on an explicit tap.
  const gate = document.getElementById("gate");
  await new Promise((go) => {
    document.getElementById("begin").addEventListener("click", () => {
      gate.classList.add("gone");
      document.body.classList.add("live");   // reveals the controls tab
      go();
    }, { once: true });
  });

  let t = 0;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(layout, 120); });

  boot.classList.remove("gone");
  if (!(await openCamera(P.facing))) return;

  boot.classList.remove("gone");
  boot.textContent = "loading segmentation model…";

  try {
    sensor = await mediapipeSensor();
  } catch (e) {
    console.warn("segmentation unavailable, falling back:", e);
    sensor = motionSensor();
  }
  document.getElementById("sensor").textContent = sensor.name;
  boot.classList.add("gone");
  addEventListener("orientationchange", () => setTimeout(layout, 350));
  requestAnimationFrame(loop);
}

function loop(ts) {
  sensor.read(ts);
  updateField();
  render();

  frames++;
  if (ts - lastFpsT > 500) {
    document.getElementById("fps").textContent =
      Math.round((frames * 1000) / (ts - lastFpsT)) + " fps";
    frames = 0; lastFpsT = ts;
  }
  requestAnimationFrame(loop);
}

/* ---------- panel ------------------------------------------------------- */
const SLIDERS = ["fontSize", "leading", "density", "decay", "threshold", "falloff", "minAlpha"];

function bindPanel() {
  const panel = document.getElementById("panel");
  const save = () => localStorage.setItem("cdf", JSON.stringify(P));

  const sync = () => {
    for (const k of SLIDERS) {
      document.getElementById(k).value = P[k];
      document.getElementById("o_" + k).textContent = P[k];
    }
    document.getElementById("facing").value = P.facing;
    document.getElementById("format").value = P.format;
    document.getElementById("tokenSet").value = P.tokenSet;
    document.getElementById("mirror").checked = P.mirror;
    document.getElementById("showMask").checked = P.showMask;
  };

  for (const k of SLIDERS) {
    document.getElementById(k).addEventListener("input", (e) => {
      P[k] = parseFloat(e.target.value);
      document.getElementById("o_" + k).textContent = P[k];
      save();
    });
  }
  document.getElementById("facing").addEventListener("change", async (e) => {
    P.facing = e.target.value;
    P.mirror = P.facing === "user";       // only a front camera should mirror
    document.getElementById("mirror").checked = P.mirror;
    save();
    if (stream) await openCamera(P.facing);
  });
  document.getElementById("format").addEventListener("change", (e) => {
    P.format = e.target.value; layout(); save();
  });
  document.getElementById("tokenSet").addEventListener("change", (e) => {
    P.tokenSet = e.target.value; buildTokens(); save();
  });
  document.getElementById("mirror").addEventListener("change", e => { P.mirror = e.target.checked; save(); });
  document.getElementById("showMask").addEventListener("change", e => { P.showMask = e.target.checked; save(); });

  const reset = () => {
    const facing = P.facing;                 // keep the camera we are on
    Object.assign(P, DEFAULTS, { facing, mirror: facing === "user" });
    buildTokens(); sync(); layout(); save();
  };
  // --- panel open / close ------------------------------------------------
  // On a phone the panel is a bottom sheet, so it must never be the only way
  // out of itself. The toggle sits above it and flips cogwheel -> cross;
  // tapping the field behind the sheet closes it too.
  const tab = document.getElementById("tab");
  const setPanel = (open) => {
    panel.classList.toggle("hidden", !open);
    tab.classList.toggle("open", open);
  };
  tab.addEventListener("click", (e) => {
    e.stopPropagation();
    setPanel(panel.classList.contains("hidden"));
  });
  document.addEventListener("pointerdown", (e) => {
    if (panel.classList.contains("hidden")) return;
    if (panel.contains(e.target) || tab.contains(e.target)) return;
    setPanel(false);
  });

  document.getElementById("reset").addEventListener("click", reset);
  document.getElementById("shot").addEventListener("click", savePNG);

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === "h") setPanel(panel.classList.contains("hidden"));
    if (e.key === "Escape") setPanel(false);
    if (k === "f") {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.();
    }
    if (k === "s") savePNG();
    if (k === "r") reset();
  });

  sync();
}

function savePNG() {
  const a = document.createElement("a");
  a.download = "crowd-data-field-" + Date.now() + ".png";
  a.href = out.toDataURL("image/png");
  a.click();
}

start();
