/* ============================================================
   SnapBox — interactive face filters
   ------------------------------------------------------------
   Draws the mirrored camera frame into a canvas and adds funny
   overlays on top of it — one overlay per person in frame. Face
   positions come from MediaPipe's Face Landmarker; when it cannot
   load (offline, blocked CDN, old browser) the same filters render
   at a fixed position so the feature keeps working.

   Public API: window.SnapBoxFilters = { FILTERS, create }
   ============================================================ */
(function () {
  'use strict';

  const TASKS_VISION_VERSION = '0.10.14';
  const VISION_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
  const VISION_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const FILTERS = [
    { id: 'none', label: 'Original', emoji: '' },
    { id: 'thug', label: 'Thug Life', emoji: '🕶️' },
    { id: 'mlg', label: 'MLG', emoji: '💯' },
    { id: 'shades', label: 'Pixel Shades', emoji: '😎' },
    { id: 'boss', label: 'Thug Boss', emoji: '🧢' },
    { id: 'bling', label: 'Bling', emoji: '💰' },
    { id: 'joint', label: 'Joint', emoji: '🚬' },
    { id: 'big', label: 'Big Eyes + Mouth', emoji: '👀' },
    { id: 'faceswap', label: 'Face Swap', emoji: '🎭' },
    { id: 'cheeky', label: 'Cheeky Grin', emoji: '😏' },
    { id: 'unibrow', label: 'Unibrow', emoji: '🤨' },
    { id: 'cat', label: 'Cat', emoji: '🐱' },
    { id: 'bunny', label: 'Bunny', emoji: '🐰' },
    { id: 'hearts', label: 'Hearts', emoji: '💖' },
    { id: 'makeup', label: 'Makeup', emoji: '💄' },
    { id: 'squish', label: 'Squish', emoji: '🥞' },
    { id: 'melt', label: 'Meltdown', emoji: '🫠' },
    { id: 'jelly', label: 'Jelly', emoji: '🪼' },
    { id: 'clown', label: 'Clown', emoji: '🤡' },
    { id: 'dog', label: 'Snap Dog', emoji: '🐶' },
    { id: 'classic', label: 'Shades', emoji: '🕶️' }
  ];

  const DETECT_INTERVAL_MS = 80;  // landmark pass ~12x/s; smoothing keeps up
  const FACE_GRACE_MS = 700;      // keep a face briefly when detection blinks
  const SMOOTHING = 0.4;          // lower = smoother, higher = snappier
  // Groups share one frame, so the landmarker tracks several faces and every
  // face gets its own smoothing, skin sample and expression state.
  const MAX_FACES = 8;

  // Art props, one transparent PNG per prop (cut from the downloaded sheets).
  // A filter places a prop on the matching landmark instead of pasting a whole
  // sticker block, so a cap lands on the head and a chain on the neck even
  // though the sheet drew them in its own layout. The crop inside each file is
  // derived from its alpha channel at load time, so re-trimming a file is fine.
  const ART = {
    shades: { src: 'assets/prop-shades.png' },
    joint: { src: 'assets/prop-joint.png' },
    cap: { src: 'assets/prop-cap.png' },
    chainBoss: { src: 'assets/prop-chain-boss.png' },
    chainBling: { src: 'assets/prop-chain-bling.png' },
    blunt: { src: 'assets/prop-blunt.png' }
  };

  function loadProp(prop) {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, w, h).data;
        let x0 = w;
        let y0 = h;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] > 16) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < x0 || y1 < y0) return;  // fully transparent file
        prop.canvas = canvas;
        prop.x = x0;
        prop.y = y0;
        prop.w = x1 - x0 + 1;
        prop.h = y1 - y0 + 1;
      } catch (err) {
        // No canvas access: the filters use their drawn fallbacks.
      }
    };
    img.src = prop.src;
  }
  Object.keys(ART).forEach((key) => loadProp(ART[key]));

  // MediaPipe face-oval landmarks: the outer contour of the face, in order.
  // Used to paint the face exactly on its own silhouette instead of pasting an
  // ellipse over it.
  const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
    127, 162, 21, 54, 103, 67, 109
  ];

  // MediaPipe lip contours, in order around the mouth: outer edge first, then
  // the inner edge that bounds the actual opening. Lipstick is painted from
  // these, so it follows the real lips instead of a generic mouth shape.
  const LIP_OUTER = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
    375, 321, 405, 314, 17, 84, 181, 91, 146
  ];
  const LIP_INNER = [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
    324, 318, 402, 317, 14, 87, 178, 88, 95
  ];

  // Face Landmarker landmark indices.
  const LM = {
    nose: 1,
    lipTop: 13,
    lipBottom: 14,
    mouthL: 61,
    mouthR: 291,
    cheekA: 205,
    cheekB: 425,
    chin: 152,
    eyeA1: 33,
    eyeA2: 133,
    eyeB1: 362,
    eyeB2: 263
  };

  const ZERO_EXPR = { smile: 0, jawOpen: 0 };

  function create(options) {
    const video = options && options.video;
    const canvas = options && options.canvas;
    if (!video || !canvas) {
      throw new Error('SnapBoxFilters.create needs a video and a canvas');
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('SnapBoxFilters could not get a 2D canvas context');

    // Reused scratch surface for soft, feathered warps. Fixed size avoids
    // allocating (and clearing) a new canvas for every patch on every frame.
    const warpCanvas = document.createElement('canvas');
    warpCanvas.width = 1024;
    warpCanvas.height = 1024;
    const warpCtx = warpCanvas.getContext('2d');
    // Tiny scratch surface used to read the guest's own skin tone out of the
    // frame, so the painted face matches the person instead of one fixed tone.
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 6;
    sampleCanvas.height = 6;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    const DEFAULT_SKIN = { r: 232, g: 185, b: 143 };
    const fallbackSkin = { tone: null, at: 0 };
    let activeFilter = 'none';
    let landmarker = null;
    let trackerState = 'idle'; // idle | loading | ready | unavailable
    let rafId = 0;
    let lastDetectAt = 0;
    let lastVideoTime = -1;
    // One track per person in frame: the last detected box, the smoothed box the
    // overlay follows, the expression weights and this face's own skin sample.
    let tracks = [];
    let drawWarningShown = false;

    // ---------- geometry ----------
    function coverRect(width, height, surfaceW, surfaceH) {
      const scale = Math.max(surfaceW / width, surfaceH / height);
      const w = width * scale;
      const h = height * scale;
      return { x: (surfaceW - w) / 2, y: (surfaceH - h) / 2, w, h };
    }

    // A tracked point is in source (unmirrored) normalized space; the frame is
    // drawn mirrored, so x is flipped here. Both preview and capture go through
    // this, which keeps previews and saved photos identical.
    function toScreen(rect, point) {
      return {
        x: rect.x + (1 - point.x) * rect.w,
        y: rect.y + point.y * rect.h
      };
    }

    function toSource(rect, surfaceW, surfaceH, px, py) {
      return {
        x: 1 - (px * surfaceW - rect.x) / rect.w,
        y: (py * surfaceH - rect.y) / rect.h
      };
    }

    // Deterministic 0..1 hash. The drawn props use it for hair and edge
    // variation so they stay put from frame to frame instead of shimmering.
    function hash01(n) {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    function midpoint(a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    // Head tilt on screen, normalized to [-90°, 90°]: the mirrored eye pair can
    // come out in either order, and an unnormalized angle would flip overlays.
    function headTilt(rect, box) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return angle;
    }

    function skinColor(tone, factor, lighten) {
      const channel = (c) => {
        const v = Math.max(0, Math.min(255, c * factor));
        return Math.round(v + (255 - v) * (lighten || 0));
      };
      return `rgb(${channel(tone.r)}, ${channel(tone.g)}, ${channel(tone.b)})`;
    }

    // Reads small patches of skin from the raw frame — both cheeks and the
    // forehead — and averages them. The tracked points are already in source
    // (unmirrored) space, so they can be used directly on the video. Patches
    // that are clearly not skin (hair, background, blown highlights) are
    // skipped. Re-sampled a few times per second.
    function sampleSkinTone(box, now, skin) {
      const cache = skin || fallbackSkin;
      if (cache.tone && now - cache.at < 400) return cache.tone;
      cache.at = now;
      if (!sampleCtx || !video.videoWidth || !video.videoHeight) return cache.tone || DEFAULT_SKIN;

      const faceH = Math.abs(box.bottom - box.top) || 0.3;
      const forehead = {
        x: (box.eyeA.x + box.eyeB.x) / 2,
        y: (box.eyeA.y + box.eyeB.y) / 2 - faceH * 0.22
      };
      const spots = [box.cheekA, box.cheekB, forehead];
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (const spot of spots) {
        if (!spot) continue;
        const sx = Math.max(0, Math.min(video.videoWidth - 6, spot.x * video.videoWidth - 3));
        const sy = Math.max(0, Math.min(video.videoHeight - 6, spot.y * video.videoHeight - 3));
        try {
          sampleCtx.drawImage(video, sx, sy, 6, 6, 0, 0, 6, 6);
          const data = sampleCtx.getImageData(0, 0, 6, 6).data;
          let pr = 0;
          let pg = 0;
          let pb = 0;
          for (let i = 0; i < data.length; i += 4) {
            pr += data[i];
            pg += data[i + 1];
            pb += data[i + 2];
          }
          const count = data.length / 4;
          const tone = { r: pr / count, g: pg / count, b: pb / count };
          const luma = 0.299 * tone.r + 0.587 * tone.g + 0.114 * tone.b;
          if (luma > 40 && luma < 245) {
            r += tone.r;
            g += tone.g;
            b += tone.b;
            hits++;
          }
        } catch (err) {
          // Sampling is cosmetic only — a fixed tone is good enough.
        }
      }

      if (hits) cache.tone = { r: r / hits, g: g / hits, b: b / hits };
      return cache.tone || DEFAULT_SKIN;
    }

    function frameFromLandmarks(points) {
      let left = 1;
      let right = 0;
      let top = 1;
      let bottom = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x < left) left = p.x;
        if (p.x > right) right = p.x;
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }
      const fallbackPoint = (x, y) => ({ x: left + (right - left) * x, y: top + (bottom - top) * y });
      const pick = (i, x, y) => (points[i] ? { x: points[i].x, y: points[i].y } : fallbackPoint(x, y));
      const lipTop = pick(LM.lipTop, 0.5, 0.64);
      const lipBottom = pick(LM.lipBottom, 0.5, 0.68);
      const mouth = midpoint(lipTop, lipBottom);
      const mouthL = pick(LM.mouthL, 0.4, 0.66);
      const mouthR = pick(LM.mouthR, 0.6, 0.66);
      // With a smile the corners sit above the mouth centre. This geometric
      // estimate keeps the smile reaction alive if blendshapes are unavailable.
      const faceH = Math.max(0.001, bottom - top);
      const lift = (mouth.y - (mouthL.y + mouthR.y) / 2) / faceH;
      const smileGeom = Math.max(0, Math.min(1, (lift - 0.004) * 22));

      return {
        left,
        right,
        top,
        bottom,
        eyeA: points[LM.eyeA1] && points[LM.eyeA2] ? midpoint(points[LM.eyeA1], points[LM.eyeA2]) : fallbackPoint(0.32, 0.4),
        eyeB: points[LM.eyeB1] && points[LM.eyeB2] ? midpoint(points[LM.eyeB1], points[LM.eyeB2]) : fallbackPoint(0.68, 0.4),
        nose: pick(LM.nose, 0.5, 0.52),
        mouth,
        mouthL,
        mouthR,
        lipTop,
        lipBottom,
        lipsOuter: LIP_OUTER.every((i) => points[i])
          ? LIP_OUTER.map((i) => ({ x: points[i].x, y: points[i].y }))
          : null,
        lipsInner: LIP_INNER.every((i) => points[i])
          ? LIP_INNER.map((i) => ({ x: points[i].x, y: points[i].y }))
          : null,
        cheekA: pick(LM.cheekA, 0.3, 0.55),
        cheekB: pick(LM.cheekB, 0.7, 0.55),
        chin: pick(LM.chin, 0.5, 0.98),
        oval: FACE_OVAL.every((i) => points[i])
          ? FACE_OVAL.map((i) => ({ x: points[i].x, y: points[i].y }))
          : null,
        smileGeom
      };
    }

    // No tracker: place a steady face box in the middle of the *visible* frame,
    // then convert it into source coordinates so overlays land where the user
    // sees them at any crop or aspect ratio.
    function fallbackFrame(rect, surfaceW, surfaceH) {
      const bob = Math.sin(performance.now() / 850) * 0.008;
      const centerX = 0.5;
      const centerY = 0.47 + bob;
      const halfW = 0.23;
      const halfH = 0.26;
      const center = toSource(rect, surfaceW, surfaceH, centerX, centerY);
      const corner = toSource(rect, surfaceW, surfaceH, centerX - halfW, centerY - halfH);
      const opposite = toSource(rect, surfaceW, surfaceH, centerX + halfW, centerY + halfH);
      return {
        left: Math.min(corner.x, opposite.x),
        right: Math.max(corner.x, opposite.x),
        top: Math.min(corner.y, opposite.y),
        bottom: Math.max(corner.y, opposite.y),
        eyeA: toSource(rect, surfaceW, surfaceH, centerX - 0.085, centerY - 0.065),
        eyeB: toSource(rect, surfaceW, surfaceH, centerX + 0.085, centerY - 0.065),
        nose: toSource(rect, surfaceW, surfaceH, centerX, centerY + 0.04),
        mouth: toSource(rect, surfaceW, surfaceH, centerX, centerY + 0.12),
        mouthL: toSource(rect, surfaceW, surfaceH, centerX - 0.09, centerY + 0.12),
        mouthR: toSource(rect, surfaceW, surfaceH, centerX + 0.09, centerY + 0.12),
        lipTop: toSource(rect, surfaceW, surfaceH, centerX, centerY + 0.11),
        lipBottom: toSource(rect, surfaceW, surfaceH, centerX, centerY + 0.13),
        // Rough lip loops so the makeup filter still paints lips before the
        // landmarker has loaded.
        lipsOuter: Array.from({ length: 20 }, (_, i) => {
          const a = (i / 20) * Math.PI * 2;
          return toSource(
            rect, surfaceW, surfaceH,
            centerX + Math.cos(a) * 0.095,
            centerY + 0.12 + Math.sin(a) * 0.022
          );
        }),
        lipsInner: Array.from({ length: 20 }, (_, i) => {
          const a = (i / 20) * Math.PI * 2;
          return toSource(
            rect, surfaceW, surfaceH,
            centerX + Math.cos(a) * 0.062,
            centerY + 0.12 + Math.sin(a) * 0.005
          );
        }),
        cheekA: toSource(rect, surfaceW, surfaceH, centerX - 0.13, centerY + 0.05),
        cheekB: toSource(rect, surfaceW, surfaceH, centerX + 0.13, centerY + 0.05),
        chin: toSource(rect, surfaceW, surfaceH, centerX, centerY + 0.23),
        oval: Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return toSource(
            rect, surfaceW, surfaceH,
            centerX + Math.cos(a) * halfW,
            centerY + Math.sin(a) * halfH * 1.02
          );
        }),
        smileGeom: 0
      };
    }

    function smooth(prev, next) {
      const lerp = (a, b) => a + (b - a) * SMOOTHING;
      const point = (a, b) => ({ x: lerp(a.x, b.x), y: lerp(a.y, b.y) });
      return {
        left: lerp(prev.left, next.left),
        right: lerp(prev.right, next.right),
        top: lerp(prev.top, next.top),
        bottom: lerp(prev.bottom, next.bottom),
        eyeA: point(prev.eyeA, next.eyeA),
        eyeB: point(prev.eyeB, next.eyeB),
        nose: point(prev.nose, next.nose),
        mouth: point(prev.mouth, next.mouth),
        mouthL: point(prev.mouthL, next.mouthL),
        mouthR: point(prev.mouthR, next.mouthR),
        lipTop: prev.lipTop && next.lipTop ? point(prev.lipTop, next.lipTop) : (next.lipTop || prev.lipTop),
        lipBottom: prev.lipBottom && next.lipBottom ? point(prev.lipBottom, next.lipBottom) : (next.lipBottom || prev.lipBottom),
        // Lip loops are smoothed like the face oval, otherwise the lipstick
        // would jump at detection rate.
        lipsOuter: next.lipsOuter && prev.lipsOuter && prev.lipsOuter.length === next.lipsOuter.length
          ? next.lipsOuter.map((p, i) => point(prev.lipsOuter[i], p))
          : (next.lipsOuter || prev.lipsOuter || null),
        lipsInner: next.lipsInner && prev.lipsInner && prev.lipsInner.length === next.lipsInner.length
          ? next.lipsInner.map((p, i) => point(prev.lipsInner[i], p))
          : (next.lipsInner || prev.lipsInner || null),
        cheekA: point(prev.cheekA, next.cheekA),
        cheekB: point(prev.cheekB, next.cheekB),
        chin: point(prev.chin, next.chin),
        // The face outline is smoothed as well, otherwise the painted face mask
        // would shimmer at detection rate.
        oval: next.oval && prev.oval && prev.oval.length === next.oval.length
          ? next.oval.map((p, i) => point(prev.oval[i], p))
          : (next.oval || prev.oval || null),
        smileGeom: next.smileGeom || 0
      };
    }

    function readExpression(categories, box) {
      const scores = Object.create(null);
      (categories || []).forEach((entry) => {
        if (entry && entry.categoryName) scores[entry.categoryName] = entry.score || 0;
      });
      const hasBlendshapes = !!(categories && categories.length);
      let smile = 0;
      let jawOpen = 0;
      if (hasBlendshapes) {
        const smileL = scores.mouthSmileLeft || 0;
        const smileR = scores.mouthSmileRight || 0;
        const cheekL = scores.cheekSquintLeft || 0;
        const cheekR = scores.cheekSquintRight || 0;
        smile = Math.min(1, (smileL + smileR) / 2 + (cheekL + cheekR) * 0.12);
        jawOpen = Math.min(1, scores.jawOpen || 0);
      }
      // Landmark geometry is the fallback when blendshapes are missing, and
      // also catches smiles that the blendshape model underestimates.
      const geom = box && box.smileGeom ? box.smileGeom : 0;
      smile = Math.max(smile, geom * (hasBlendshapes ? 0.65 : 0.9));
      return { smile: Math.min(1, smile), jawOpen };
    }

    function smoothExpression(prev, next) {
      const lerp = (a, b) => a + (b - a) * SMOOTHING;
      return {
        smile: lerp(prev.smile, next.smile),
        jawOpen: lerp(prev.jawOpen, next.jawOpen)
      };
    }

    function trackCenter(box) {
      return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    }

    function newTrack(box, expr, now) {
      return {
        tracked: box,
        trackedExpr: expr,
        face: box,
        expr: { ...expr },
        lastSeen: now,
        skin: { tone: null, at: 0 }
      };
    }

    // Detection returns unordered faces, so each one is handed to the track whose
    // last centre is closest. Without this the smoothed boxes would swap owners
    // between frames and the overlays would slide between people.
    function claimTrack(box) {
      const center = trackCenter(box);
      const width = Math.abs(box.right - box.left);
      const gate = Math.max(0.1, Math.min(0.3, width * 0.9));
      let best = null;
      let bestDist = Infinity;
      for (const track of tracks) {
        if (track.claimed) continue;
        const prev = trackCenter(track.tracked);
        const dist = Math.hypot(prev.x - center.x, prev.y - center.y);
        if (dist < bestDist && dist <= gate) {
          best = track;
          bestDist = dist;
        }
      }
      if (best) best.claimed = true;
      return best;
    }

    // Points and expression weights are interpolated every frame, so easing
    // between detections keeps the overlay glued to each face instead of
    // stepping. Everyone in frame is resolved together; only when nobody is
    // detected does the fixed fallback face come back.
    function resolveFaces(rect, surfaceW, surfaceH, now) {
      tracks = tracks.filter((track) => now - track.lastSeen < FACE_GRACE_MS);
      // A face that cannot be matched to a track starts a new one while the old
      // one is still in its grace window; keep only the freshest few so a crowded
      // frame cannot pile up overlays.
      if (tracks.length > MAX_FACES) {
        tracks.sort((a, b) => b.lastSeen - a.lastSeen);
        tracks.length = MAX_FACES;
      }
      if (!tracks.length) {
        return [{ box: fallbackFrame(rect, surfaceW, surfaceH), expr: ZERO_EXPR, skin: fallbackSkin }];
      }
      return tracks.map((track) => {
        track.face = smooth(track.face, track.tracked);
        track.expr = smoothExpression(track.expr, track.trackedExpr);
        return { box: track.face, expr: track.expr, skin: track.skin };
      });
    }

    // ---------- drawing primitives ----------
    function drawMirroredVideo(target, rect) {
      target.save();
      target.translate(rect.x + rect.w, rect.y);
      target.scale(-1, 1);
      target.drawImage(video, 0, 0, rect.w, rect.h);
      target.restore();
    }

    // Copies a feathered elliptical patch of the frame back onto the target,
    // transformed by `applyTransform` around the patch centre. The feathered rim
    // is what keeps warps from showing a hard seam.
    function warpPatch(target, rect, center, radiusX, radiusY, applyTransform) {
      const rx = Math.max(2, radiusX);
      const ry = Math.max(2, radiusY);
      const pw = rx * 2;
      const ph = ry * 2;
      const w = Math.min(1024, Math.ceil(pw));
      const h = Math.min(1024, Math.ceil(ph));
      if (!warpCtx || !w || !h) return;
      const px = center.x - rx;
      const py = center.y - ry;

      warpCtx.save();
      warpCtx.beginPath();
      warpCtx.rect(0, 0, w, h);
      warpCtx.clip();
      warpCtx.clearRect(0, 0, w, h);
      // Transform about the patch centre, then draw the mirrored feed into it.
      warpCtx.translate(w / 2, h / 2);
      applyTransform(warpCtx);
      warpCtx.translate(-w / 2, -h / 2);
      warpCtx.translate(-px, -py);
      drawMirroredVideo(warpCtx, rect);
      warpCtx.restore();

      // Fade the rim so the warp melts into the untouched frame.
      warpCtx.save();
      warpCtx.globalCompositeOperation = 'destination-in';
      warpCtx.translate(w / 2, h / 2);
      warpCtx.scale(1, h / w);
      const feather = warpCtx.createRadialGradient(0, 0, w * 0.34, 0, 0, w * 0.5);
      feather.addColorStop(0, 'rgba(0,0,0,1)');
      feather.addColorStop(0.5, 'rgba(0,0,0,1)');
      feather.addColorStop(1, 'rgba(0,0,0,0)');
      warpCtx.fillStyle = feather;
      warpCtx.fillRect(-w / 2, -w / 2, w, w);
      warpCtx.restore();

      target.drawImage(warpCanvas, 0, 0, w, h, px, py, pw, ph);
    }

    // Scales a feathered patch about its centre.
    function softWarp(target, rect, center, radiusX, radiusY, scaleX, scaleY) {
      if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) return;
      warpPatch(target, rect, center, radiusX, radiusY, (ctx) => ctx.scale(scaleX, scaleY));
    }

    function roundedRect(target, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      target.beginPath();
      target.moveTo(x + radius, y);
      target.lineTo(x + w - radius, y);
      target.quadraticCurveTo(x + w, y, x + w, y + radius);
      target.lineTo(x + w, y + h - radius);
      target.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      target.lineTo(x + radius, y + h);
      target.quadraticCurveTo(x, y + h, x, y + h - radius);
      target.lineTo(x, y + radius);
      target.quadraticCurveTo(x, y, x + radius, y);
      target.closePath();
    }

    // ---------- filters ----------
    function drawEar(target, x, y, w, h, dir) {
      target.save();
      target.translate(x, y);
      target.rotate(dir * 0.2);
      target.fillStyle = '#7a4b26';
      target.beginPath();
      target.ellipse(dir * w * 0.26, -h * 0.3, w * 0.44, h * 0.52, dir * 0.24, 0, Math.PI * 2);
      target.fill();
      target.fillStyle = '#a86b3f';
      target.beginPath();
      target.ellipse(dir * w * 0.24, -h * 0.26, w * 0.2, h * 0.33, dir * 0.22, 0, Math.PI * 2);
      target.fill();
      target.restore();
    }

    function drawNose(target, x, y, w, h) {
      target.save();
      target.fillStyle = '#1b1b1b';
      target.beginPath();
      target.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      target.fill();

      target.fillStyle = 'rgba(255, 255, 255, 0.35)';
      target.beginPath();
      target.ellipse(x - w * 0.16, y - h * 0.16, w * 0.13, h * 0.1, -0.4, 0, Math.PI * 2);
      target.fill();

      target.strokeStyle = 'rgba(20, 20, 20, 0.75)';
      target.lineWidth = Math.max(1, w * 0.06);
      target.beginPath();
      target.moveTo(x, y + h * 0.35);
      target.lineTo(x, y + h * 0.8);
      target.stroke();
      target.restore();
    }

    function drawDog(target, rect, box) {
      const faceW = Math.abs(box.right - box.left) * rect.w;
      const faceH = Math.abs(box.bottom - box.top) * rect.h;
      const top = Math.min(box.top, box.bottom);
      const leftCorner = toScreen(rect, { x: Math.min(box.left, box.right), y: top });
      const rightCorner = toScreen(rect, { x: Math.max(box.left, box.right), y: top });
      const earW = Math.max(26, faceW * 0.44);
      const earH = Math.max(28, faceH * 0.5);

      drawEar(target, leftCorner.x, leftCorner.y - faceH * 0.03, earW, earH, -1);
      drawEar(target, rightCorner.x, rightCorner.y - faceH * 0.03, earW, earH, 1);

      const nose = toScreen(rect, box.nose);
      drawNose(target, nose.x, nose.y, Math.max(18, faceW * 0.26), Math.max(12, faceW * 0.17));
    }

    // ---------- cute filters ----------
    // A soft heart, used by the hearts filter and its cheek blush.
    function drawHeart(target, x, y, size, angle, color, alpha) {
      if (!(size > 0)) return;
      target.save();
      target.translate(x, y);
      target.rotate(angle || 0);
      target.globalAlpha = Math.max(0, Math.min(1, alpha == null ? 1 : alpha));
      target.fillStyle = color || '#ff4d88';
      target.beginPath();
      target.moveTo(0, size * 0.85);
      target.bezierCurveTo(-size * 1.15, -size * 0.05, -size * 0.62, -size * 0.95, 0, -size * 0.35);
      target.bezierCurveTo(size * 0.62, -size * 0.95, size * 1.15, -size * 0.05, 0, size * 0.85);
      target.closePath();
      target.fill();
      target.restore();
    }

    // Soft face blush, shared by the makeup and animal filters.
    function drawBlush(target, rect, box, faceW, rgb, alpha) {
      for (const key of ['cheekA', 'cheekB']) {
        const cheek = toScreen(rect, box[key]);
        const radius = Math.max(10, faceW * 0.15);
        const blush = target.createRadialGradient(
          cheek.x, cheek.y, radius * 0.1,
          cheek.x, cheek.y, radius
        );
        blush.addColorStop(0, `rgba(${rgb}, ${alpha})`);
        blush.addColorStop(0.65, `rgba(${rgb}, ${(alpha * 0.45).toFixed(3)})`);
        blush.addColorStop(1, `rgba(${rgb}, 0)`);
        target.fillStyle = blush;
        target.beginPath();
        target.arc(cheek.x, cheek.y, radius, 0, Math.PI * 2);
        target.fill();
      }
    }

    // Pointed cat ear: base at (x, y), tip straight up, `lean` tilts it out.
    function drawPointedEar(target, x, y, w, h, lean) {
      target.save();
      target.translate(x, y);
      target.rotate(lean);
      target.fillStyle = '#4a3a45';
      target.beginPath();
      target.moveTo(-w * 0.5, h * 0.15);
      target.quadraticCurveTo(-w * 0.34, -h * 0.5, -w * 0.06, -h * 0.72);
      target.quadraticCurveTo(w * 0.22, -h * 0.55, w * 0.5, h * 0.15);
      target.quadraticCurveTo(0, h * 0.36, -w * 0.5, h * 0.15);
      target.closePath();
      target.fill();
      target.fillStyle = '#ffa9c4';
      target.beginPath();
      target.moveTo(-w * 0.28, h * 0.06);
      target.quadraticCurveTo(-w * 0.16, -h * 0.32, -w * 0.03, -h * 0.46);
      target.quadraticCurveTo(w * 0.12, -h * 0.33, w * 0.28, h * 0.06);
      target.quadraticCurveTo(0, h * 0.2, -w * 0.28, h * 0.06);
      target.fill();
      target.restore();
    }

    // Long bunny ear growing out of (x, y).
    function drawLongEar(target, x, y, w, h, lean) {
      target.save();
      target.translate(x, y);
      target.rotate(lean);
      target.fillStyle = '#f4ecef';
      target.strokeStyle = 'rgba(92, 62, 78, 0.35)';
      target.lineWidth = Math.max(1.2, w * 0.06);
      target.beginPath();
      target.ellipse(0, -h * 0.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      target.fill();
      target.stroke();
      target.fillStyle = '#ffb0c8';
      target.beginPath();
      target.ellipse(0, -h * 0.48, w * 0.26, h * 0.36, 0, 0, Math.PI * 2);
      target.fill();
      target.restore();
    }

    // Pink animal nose with the little "w" mouth and whiskers, shared by the
    // cat and bunny filters.
    function drawAnimalFace(target, rect, box, faceW, faceH, noseColor) {
      const nose = toScreen(rect, box.nose);
      const angle = headTilt(rect, box);
      const noseW = Math.max(10, faceW * 0.11);
      const noseH = Math.max(7, faceH * 0.045);

      target.save();
      target.translate(nose.x, nose.y + faceH * 0.01);
      target.rotate(angle);

      target.fillStyle = noseColor;
      target.beginPath();
      target.moveTo(-noseW * 0.5, -noseH * 0.25);
      target.quadraticCurveTo(0, -noseH * 0.55, noseW * 0.5, -noseH * 0.25);
      target.quadraticCurveTo(noseW * 0.16, noseH * 0.6, 0, noseH * 0.6);
      target.quadraticCurveTo(-noseW * 0.16, noseH * 0.6, -noseW * 0.5, -noseH * 0.25);
      target.closePath();
      target.fill();

      target.strokeStyle = 'rgba(58, 36, 44, 0.85)';
      target.lineWidth = Math.max(1.4, faceW * 0.008);
      target.lineCap = 'round';
      target.beginPath();
      target.moveTo(0, noseH * 0.5);
      target.quadraticCurveTo(-noseW * 0.12, noseH * 1.25, -noseW * 0.6, noseH * 0.85);
      target.moveTo(0, noseH * 0.5);
      target.quadraticCurveTo(noseW * 0.12, noseH * 1.25, noseW * 0.6, noseH * 0.85);
      target.stroke();

      target.strokeStyle = 'rgba(255, 255, 255, 0.88)';
      target.lineWidth = Math.max(1.5, faceW * 0.007);
      for (const side of [-1, 1]) {
        for (let i = -1; i <= 1; i++) {
          target.beginPath();
          target.moveTo(side * noseW * 0.75, noseH * (0.7 + i * 0.55));
          target.quadraticCurveTo(
            side * faceW * 0.16, noseH * (0.5 + i * 0.7),
            side * faceW * 0.3, noseH * (0.2 + i * 0.85)
          );
          target.stroke();
        }
      }
      target.restore();
    }

    // Cat ears, pink nose, whiskers and rosy cheeks.
    function drawCat(target, rect, box, faceW, faceH) {
      const angle = headTilt(rect, box);
      const top = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: Math.min(box.top, box.bottom)
      });
      const earW = Math.max(28, faceW * 0.4);
      const earH = Math.max(30, faceH * 0.36);

      target.save();
      target.translate(top.x, top.y + faceH * 0.04);
      target.rotate(angle);
      drawPointedEar(target, -faceW * 0.34, 0, earW, earH, -0.24);
      drawPointedEar(target, faceW * 0.34, 0, earW, earH, 0.24);
      target.restore();

      drawBlush(target, rect, box, faceW, '255, 120, 160', 0.32);
      drawAnimalFace(target, rect, box, faceW, faceH, '#ff8fb1');
    }

    // Tall bunny ears with a gentle sway, pink nose, whiskers, two front teeth.
    function drawBunny(target, rect, box, faceW, faceH, now) {
      const angle = headTilt(rect, box);
      const top = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: Math.min(box.top, box.bottom)
      });
      const sway = Math.sin((now || 0) / 620) * 0.05;
      const earW = Math.max(22, faceW * 0.28);
      const earH = Math.max(48, faceH * 0.62);

      target.save();
      target.translate(top.x, top.y + faceH * 0.03);
      target.rotate(angle);
      drawLongEar(target, -faceW * 0.15, 0, earW, earH, -0.16 + sway);
      drawLongEar(target, faceW * 0.15, 0, earW, earH, 0.16 + sway);
      target.restore();

      drawBlush(target, rect, box, faceW, '255, 130, 170', 0.28);

      const nose = toScreen(rect, box.nose);
      target.save();
      target.translate(nose.x, nose.y + faceH * 0.06);
      target.rotate(angle);
      target.fillStyle = 'rgba(255, 255, 255, 0.92)';
      const toothW = Math.max(4, faceW * 0.032);
      const toothH = Math.max(5, faceH * 0.028);
      roundedRect(target, -toothW, 0, toothW * 0.9, toothH, 2);
      target.fill();
      roundedRect(target, toothW * 0.1, 0, toothW * 0.9, toothH, 2);
      target.fill();
      target.restore();

      drawAnimalFace(target, rect, box, faceW, faceH, '#ff9fbe');
    }

    // A cloud of hearts rising around the face, plus heart-shaped cheek blush.
    function drawHearts(target, rect, box, faceW, faceH, now) {
      const t = (now || 0) / 1000;
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2
      });
      const colors = ['#ff2f74', '#ff6fa5', '#ff9dc0'];

      for (let i = 0; i < 10; i++) {
        const phase = (t * 0.16 + i / 10) % 1;
        const spread = (hash01(i * 7 + 3) - 0.5) * 1.5;
        const x = center.x + spread * faceW * 0.85 + Math.sin(t * 1.3 + i) * faceW * 0.025;
        const y = center.y + faceH * 0.62 - phase * faceH * 1.55;
        const size = faceW * (0.03 + 0.035 * hash01(i * 5 + 1))
          * (0.75 + 0.35 * Math.sin(Math.PI * phase));
        drawHeart(
          target, x, y, size,
          Math.sin(t * 2 + i) * 0.28,
          colors[i % 3],
          Math.sin(Math.PI * phase) * 0.9
        );
      }

      for (const key of ['cheekA', 'cheekB']) {
        const cheek = toScreen(rect, box[key]);
        drawHeart(target, cheek.x, cheek.y, Math.max(6, faceW * 0.055), 0, '#ff7aa8', 0.35);
      }
    }

    // Eyeliner, lashes and plum eye shadow, one pass per eye. The wing and the
    // lashes go on the outer corner, whichever side of the face that is.
    function drawEyeMakeup(target, rect, box, faceW, faceH) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const angle = headTilt(rect, box);
      const centerX = (a.x + b.x) / 2;

      for (const eye of [a, b]) {
        const outer = eye.x < centerX ? -1 : 1;
        target.save();
        target.translate(eye.x, eye.y - faceH * 0.045);
        target.rotate(angle);

        const shadow = target.createRadialGradient(0, 0, 1, 0, 0, faceW * 0.14);
        shadow.addColorStop(0, 'rgba(150, 70, 160, 0.55)');
        shadow.addColorStop(0.6, 'rgba(120, 50, 140, 0.26)');
        shadow.addColorStop(1, 'rgba(120, 50, 140, 0)');
        target.fillStyle = shadow;
        target.beginPath();
        target.ellipse(0, 0, faceW * 0.14, faceH * 0.08, 0, 0, Math.PI * 2);
        target.fill();

        target.strokeStyle = '#1c1116';
        target.lineWidth = Math.max(1.2, faceW * 0.006);
        target.lineCap = 'round';
        target.beginPath();
        target.moveTo(-faceW * 0.085, faceH * 0.005);
        target.quadraticCurveTo(0, -faceH * 0.03, faceW * 0.082, -faceH * 0.004);
        target.stroke();

        // Wing on the outer corner.
        target.beginPath();
        target.moveTo(outer * faceW * 0.082, -faceH * 0.004);
        target.lineTo(outer * faceW * 0.108, -faceH * 0.036);
        target.stroke();

        // Lashes fanning up from the outer half of the lid.
        for (let i = 0; i < 3; i++) {
          const x = outer * (faceW * 0.028 + i * faceW * 0.02);
          target.beginPath();
          target.moveTo(x, -faceH * 0.018);
          target.lineTo(x + outer * faceW * 0.014, -faceH * 0.045 - i * faceH * 0.004);
          target.stroke();
        }
        target.restore();
      }
    }

    // Berry lipstick with a gloss, painted around the tracked mouth line.
    // Berry lipstick painted on the tracked lip contour, so it follows the real
    // lip shape, the head tilt and a smile or open mouth. The outer contour is
    // filled even-odd against the inner one, which leaves the mouth opening
    // unpainted instead of covering it with paint.
    function drawLipstick(target, rect, box, faceW, faceH) {
      if (!box.lipsOuter || box.lipsOuter.length < 6) return;
      const outer = box.lipsOuter.map((p) => toScreen(rect, p));
      const inner = box.lipsInner && box.lipsInner.length >= 6
        ? box.lipsInner.map((p) => toScreen(rect, p))
        : null;

      let top = Infinity;
      let bottom = -Infinity;
      for (const p of outer) {
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }
      const lipHeight = Math.max(2, bottom - top);

      const l = toScreen(rect, box.mouthL);
      const r = toScreen(rect, box.mouthR);
      const mouthW = Math.max(4, Math.hypot(r.x - l.x, r.y - l.y));
      let angle = Math.atan2(r.y - l.y, r.x - l.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;

      const traceLoop = (points) => {
        points.forEach((p, i) => (i === 0 ? target.moveTo(p.x, p.y) : target.lineTo(p.x, p.y)));
        target.closePath();
      };

      const paint = target.createLinearGradient(0, top, 0, bottom);
      paint.addColorStop(0, '#d81b52');
      paint.addColorStop(0.55, '#b60f3c');
      paint.addColorStop(1, '#7c0726');

      target.save();
      target.beginPath();
      traceLoop(outer);
      if (inner) traceLoop(inner);
      target.fillStyle = paint;
      target.fill('evenodd');

      // The lip line and the gloss stay inside the painted lips.
      target.beginPath();
      traceLoop(outer);
      if (inner) traceLoop(inner);
      target.clip('evenodd');

      if (inner) {
        target.strokeStyle = 'rgba(72, 0, 22, 0.5)';
        target.lineWidth = Math.max(1, lipHeight * 0.08);
        target.beginPath();
        traceLoop(inner);
        target.stroke();
      }

      // Gloss on the fullest part of the lower lip.
      let bottomPoint = outer[0];
      for (const p of outer) {
        if (p.y > bottomPoint.y) bottomPoint = p;
      }
      target.save();
      target.translate(bottomPoint.x, bottomPoint.y - lipHeight * 0.26);
      target.rotate(angle);
      target.fillStyle = 'rgba(255, 255, 255, 0.22)';
      target.beginPath();
      target.ellipse(0, 0, mouthW * 0.26, lipHeight * 0.17, 0, 0, Math.PI * 2);
      target.fill();
      target.restore();

      target.restore();
    }


    // Rosy cheeks, plum eyes with liner and lashes, berry lips.
    function drawMakeup(target, rect, box, faceW, faceH) {
      drawBlush(target, rect, box, faceW, '226, 84, 120', 0.4);
      drawEyeMakeup(target, rect, box, faceW, faceH);
      drawLipstick(target, rect, box, faceW, faceH);
    }


    // The face outline in screen space: the tracked face contour when there is
    // one, otherwise a plain oval. Painting on THIS instead of on an ellipse is
    // what stops the "egg pasted in front of the face" look.
    function faceOutline(rect, box) {
      if (box.oval && box.oval.length >= 6) return box.oval.map((p) => toScreen(rect, p));
      const a = toScreen(rect, { x: Math.min(box.left, box.right), y: Math.min(box.top, box.bottom) });
      const b = toScreen(rect, { x: Math.max(box.left, box.right), y: Math.max(box.top, box.bottom) });
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.max(16, (b.x - a.x) * 0.53);
      const ry = Math.max(16, (b.y - a.y) * 0.55);
      return Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2;
        return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
      });
    }

    function traceShape(target, points) {
      target.beginPath();
      points.forEach((p, i) => (i === 0 ? target.moveTo(p.x, p.y) : target.lineTo(p.x, p.y)));
      target.closePath();
    }

    // Flattens the face into the guest's own skin tone, following the face
    // contour. Returns the outline so warps can be clipped to it.
    function paintFace(target, rect, box, faceW, faceH, now, skin) {
      const outline = faceOutline(rect, box);
      const tone = sampleSkinTone(box, now, skin);
      let top = Infinity;
      let bottom = -Infinity;
      for (const p of outline) {
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }

      target.save();
      traceShape(target, outline);
      // Nearly flat fill in the sampled tone: a strong light-to-dark gradient
      // over a plain ellipse is exactly what made it look like an egg.
      const shade = target.createLinearGradient(0, top, 0, bottom);
      shade.addColorStop(0, skinColor(tone, 1, 0.02));
      shade.addColorStop(0.55, skinColor(tone, 1, 0));
      shade.addColorStop(1, skinColor(tone, 0.97, 0));
      target.fillStyle = shade;
      // Soft edge, so the painted face melts into the real one instead of
      // drawing a hard mask line.
      const canFilter = 'filter' in target;
      if (canFilter) target.filter = `blur(${Math.max(2, faceW * 0.012).toFixed(1)}px)`;
      target.fill();
      if (canFilter) target.filter = 'none';
      target.restore();
      return outline;
    }

    // Stretches the real mouth about its centre.
    function stretchMouth(target, rect, box, radiusX, radiusY, scaleX, scaleY) {
      const mouth = toScreen(rect, box.mouth);
      softWarp(target, rect, mouth, radiusX, radiusY, scaleX, scaleY);
    }

    // "Annoying orange", but in the guest's own skin: the face is flattened to
    // its own colour and only the real eyes and mouth are magnified on it.
    function drawBigEyes(target, rect, box, expr, faceW, faceH, now, skin) {
      const outline = paintFace(target, rect, box, faceW, faceH, now, skin);

      // Everything below is clipped to the face, so no warp can spill past the
      // head.
      target.save();
      traceShape(target, outline);
      target.clip();

      // The eyes keep their magnification; the window around each eye is what is
      // bigger, so the eye sits in a wide magnifier instead of filling it edge
      // to edge.
      for (const key of ['eyeA', 'eyeB']) {
        const eye = toScreen(rect, box[key]);
        softWarp(
          target, rect, eye,
          Math.max(16, faceW * 0.28), Math.max(14, faceH * 0.2),
          2.6, 2.6
        );
      }

      stretchMouth(
        target, rect, box,
        faceW * 0.7, faceH * 0.2,
        3.2, 2.4 + 0.5 * Math.min(1, expr.jawOpen || 0)
      );

      target.restore();
    }

    // Reaction filter: it wakes up when the person smiles. The mouth is stretched
    // exactly like in Big Eyes + Mouth, the eyebrows get a lift and a gentle
    // arch, and the nose shrinks a little.
    function drawCheeky(target, rect, box, expr, faceW, faceH) {
      const smile = Math.max(0, Math.min(1, (expr.smile - 0.1) / 0.7));

      // Mouth: same stretch and window as the Big Eyes + Mouth filter.
      stretchMouth(
        target, rect, box,
        faceW * 0.7, faceH * 0.2,
        3.2, 2.4 + 0.5 * Math.min(1, expr.jawOpen || 0)
      );

      // Nose: a little smaller. The window is deliberately tiny: a shrinking
      // window samples a LARGER slice of the frame, and a wide one reached down
      // to the mouth — that is why the mouth showed up inside it.
      const nose = toScreen(rect, box.nose);
      const noseScale = 0.88 - 0.12 * smile;
      softWarp(
        target, rect, nose,
        Math.max(10, faceW * 0.12), Math.max(8, faceH * 0.045),
        noseScale, noseScale
      );

      // Eyebrows: one small patch per brow, lifted and tilted only slightly. An
      // angled patch as wide as the whole forehead twisted the face around the
      // eyes — this stays inside the brow band, so it reads as a cheeky arch.
      const brows = [toScreen(rect, box.eyeA), toScreen(rect, box.eyeB)].sort((a, b) => a.x - b.x);
      brows.forEach((eye, i) => {
        warpPatch(
          target, rect,
          { x: eye.x, y: eye.y - faceH * 0.1 },
          Math.max(14, faceW * 0.2), Math.max(9, faceH * 0.09),
          (ctx) => {
            ctx.rotate((i === 0 ? -1 : 1) * (0.05 + 0.17 * smile));
            ctx.scale(1, 1 + 0.45 * smile);
          }
        );
      });
    }

    // Paints a bushy unibrow across both brows. It is an added prop, so it is
    // drawn on top of the skin and follows the head tilt. The band is a proper
    // arched brow: one soft arch over each eye, thickest where the two meet,
    // with individual hairs over it so the edge reads as hair, not paint.
    function drawUnibrow(target, rect, box, expr, faceW, faceH) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const angle = headTilt(rect, box);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2 - faceH * 0.115;
      const halfW = Math.max(faceW * 0.3, Math.abs(b.x - a.x) * 0.62 + faceW * 0.13);
      const thick = Math.max(6, faceH * 0.055);

      target.save();
      target.translate(centerX, centerY);
      target.rotate(angle);

      // The solid band: an arched top over each eye, a fuller bottom edge, and
      // tapered points at the outer ends.
      target.beginPath();
      target.moveTo(-halfW, thick * 0.15);
      target.bezierCurveTo(-halfW * 0.82, -thick * 0.72, -halfW * 0.3, -thick * 0.95, -halfW * 0.1, -thick * 0.62);
      target.bezierCurveTo(-halfW * 0.02, -thick * 0.52, halfW * 0.02, -thick * 0.52, halfW * 0.1, -thick * 0.62);
      target.bezierCurveTo(halfW * 0.3, -thick * 0.95, halfW * 0.82, -thick * 0.72, halfW, thick * 0.15);
      target.bezierCurveTo(halfW * 0.78, thick * 0.92, halfW * 0.32, thick * 1.02, 0, thick * 0.88);
      target.bezierCurveTo(-halfW * 0.32, thick * 1.02, -halfW * 0.78, thick * 0.92, -halfW, thick * 0.15);
      target.closePath();

      const hair = target.createLinearGradient(0, -thick, 0, thick);
      hair.addColorStop(0, '#3a2a1d');
      hair.addColorStop(0.45, '#241811');
      hair.addColorStop(1, '#0e0906');
      target.fillStyle = hair;
      target.fill();

      // Rough patches along the lower edge so the silhouette is not a stamped
      // shape: soft nicks of darker hair, kept inside the band with a clip.
      target.save();
      target.clip();
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const x = -halfW * 0.85 + halfW * 1.7 * t;
        const r = hash01(i + 3);
        target.fillStyle = 'rgba(8, 5, 3, ' + (0.18 + r * 0.3).toFixed(3) + ')';
        target.beginPath();
        target.ellipse(
          x, thick * (0.5 + r * 0.45),
          halfW * (0.05 + r * 0.05), thick * (0.2 + r * 0.24),
          0, 0, Math.PI * 2
        );
        target.fill();
      }
      target.restore();

      // Individual hairs rising out of the band. Length, lean and colour come
      // from a seeded hash, so the brow is detailed but does not shimmer.
      const strands = 34;
      target.lineCap = 'round';
      for (let i = 0; i < strands; i++) {
        const t = (i + 0.5) / strands;
        const x = -halfW * 0.94 + halfW * 1.88 * t;
        // Fullest over the middle, shorter strands toward the tapered ends.
        const fullness = 0.35 + 0.65 * Math.sin(Math.PI * t);
        const r1 = hash01(i * 3 + 1);
        const r2 = hash01(i * 5 + 7);
        const dir = hash01(i * 7 + 11) > 0.22 ? -1 : 1;
        const len = thick * (0.45 + r1 * 0.85) * fullness;
        const lean = (r2 - 0.5) * 0.9 + (t - 0.5) * 0.5;
        const rootY = thick * (0.75 - r1 * 1.5);
        target.beginPath();
        target.moveTo(x, rootY);
        target.quadraticCurveTo(
          x + lean * len * 0.5, rootY + dir * len * 0.6,
          x + lean * len, rootY + dir * len
        );
        target.strokeStyle = r2 > 0.72
          ? 'rgba(92, 68, 46, ' + (0.3 + r1 * 0.35).toFixed(3) + ')'
          : 'rgba(14, 9, 6, ' + (0.55 + r1 * 0.4).toFixed(3) + ')';
        target.lineWidth = Math.max(0.8, thick * (0.07 + r1 * 0.09));
        target.stroke();
      }

      // A few long strays poking past the ends, the way a real monobrow does.
      target.strokeStyle = 'rgba(18, 12, 8, 0.7)';
      target.lineWidth = Math.max(1, thick * 0.08);
      for (let i = 0; i < 5; i++) {
        const r1 = hash01(i * 11 + 5);
        const side = i % 2 === 0 ? -1 : 1;
        const x = side * halfW * (0.72 + r1 * 0.24);
        target.beginPath();
        target.moveTo(x, thick * 0.2);
        target.lineTo(x + side * thick * (0.5 + r1 * 0.8), -thick * (0.9 + r1 * 0.8));
        target.stroke();
      }

      target.restore();

      drawBlackTeeth(target, rect, box, expr, faceH);
    }

    // Blacked-out teeth that appear while the guest smiles with their mouth
    // open. They hang from the tracked upper lip and fill part of the actual
    // opening, so they sit inside the mouth rather than floating over the lips,
    // and they stay hidden whenever the lips are together.
    function drawBlackTeeth(target, rect, box, expr, faceH) {
      const smile = Math.max(0, Math.min(1, (expr.smile - 0.16) / 0.45));
      if (smile < 0.05 || !box.lipTop || !box.lipBottom) return;

      const upper = toScreen(rect, box.lipTop);
      const lower = toScreen(rect, box.lipBottom);
      // How far the lips are apart, as a share of the face height.
      const openPx = Math.hypot(lower.x - upper.x, lower.y - upper.y);
      const openRatio = openPx / Math.max(1, faceH);
      const open = Math.max(0, Math.min(1, (openRatio - 0.02) / 0.1));
      // Closed mouth: the lips meet, so there is no opening to paint on.
      if (open < 0.08) return;

      const l = toScreen(rect, box.mouthL);
      const r = toScreen(rect, box.mouthR);
      const mouthW = Math.max(1, Math.hypot(r.x - l.x, r.y - l.y));
      let angle = Math.atan2(r.y - l.y, r.x - l.x);
      // Keep the local "down" pointing down the screen on mirrored faces.
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      const halfMouth = mouthW / 2;
      // A tooth can never be taller than the opening it sits in.
      const toothH = Math.max(2, Math.min(openPx * 0.8, mouthW * 0.2));

      // Local x runs along the mouth line: -1 is one corner, +1 the other.
      const teeth = [
        { x: -0.34, w: 0.13, h: 1, tilt: -0.14, drop: 0.05, round: 0.2 },
        { x: 0.28, w: 0.09, h: 0.72, tilt: 0.2, drop: 0.22, round: 0.35 }
      ];
      // A small opening only shows the snaggle tooth; a wide grin shows both.
      const count = open > 0.5 ? 2 : 1;

      target.save();
      target.translate(upper.x, upper.y);
      target.rotate(angle);
      target.globalAlpha = Math.min(1, 0.3 + 0.7 * open);

      for (let i = 0; i < count; i++) {
        const tooth = teeth[i];
        const w = Math.max(3, mouthW * tooth.w);
        const h = Math.max(2, toothH * tooth.h);
        target.save();
        target.translate(halfMouth * tooth.x, tooth.drop * toothH);
        target.rotate(tooth.tilt);

        roundedRect(target, -w / 2, -h * 0.08, w, h, w * tooth.round);
        const fill = target.createLinearGradient(0, -h * 0.08, 0, h * 0.92);
        fill.addColorStop(0, '#2a1f16');
        fill.addColorStop(0.35, '#120c09');
        fill.addColorStop(1, '#030202');
        target.fillStyle = fill;
        target.fill();
        target.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        target.lineWidth = Math.max(1, w * 0.06);
        target.stroke();

        // A small gloss along the top so it reads as a tooth, not a hole.
        target.beginPath();
        target.ellipse(-w * 0.16, h * 0.06, w * 0.24, h * 0.1, -0.3, 0, Math.PI * 2);
        target.fillStyle = 'rgba(255, 255, 255, 0.16)';
        target.fill();
        target.restore();
      }

      target.restore();
    }

    function drawSquish(target, rect, box, faceW, faceH) {
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2
      });
      softWarp(target, rect, center, faceW * 0.7, faceH * 0.65, 1.55, 0.62);
    }

    function drawMelt(target, rect, box, faceW, faceH) {
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: box.top + (box.bottom - box.top) * 0.72
      });
      softWarp(target, rect, center, faceW * 0.58, faceH * 0.48, 0.95, 1.65);
    }

    function drawJelly(target, rect, box, faceW, faceH, now) {
      const t = now / 1000;
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2
      });
      const sx = 1 + Math.sin(t * 3.1) * 0.16;
      const sy = 1 + Math.sin(t * 2.3 + 1.2) * 0.16;
      softWarp(target, rect, center, faceW * 0.72, faceH * 0.68, sx, sy);
    }

    // Painted white greasepaint that follows the face contour. The real eyes and
    // mouth are warped back on top of it afterwards, so the make-up reads as
    // paint with a face still behind it instead of a mask.
    function paintWhiteFace(target, rect, box, faceW) {
      const outline = faceOutline(rect, box);
      let top = Infinity;
      let bottom = -Infinity;
      for (const p of outline) {
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }

      target.save();
      traceShape(target, outline);
      const shade = target.createLinearGradient(0, top, 0, bottom);
      shade.addColorStop(0, '#fdf9f2');
      shade.addColorStop(0.62, '#f6f0e6');
      shade.addColorStop(1, '#e3d9ca');
      target.fillStyle = shade;
      // A little of the guest's own skin stays visible, so it looks like paint.
      target.globalAlpha = 0.95;
      const canFilter = 'filter' in target;
      if (canFilter) target.filter = `blur(${Math.max(2, faceW * 0.014).toFixed(1)}px)`;
      target.fill();
      if (canFilter) target.filter = 'none';
      target.restore();
      return outline;
    }

    // The big painted grin: a thick red smile around the real mouth, with curled
    // corners, lip creases and a gloss along the lower lip.
    function drawClownSmile(target, rect, box, expr, faceW, faceH) {
      const smile = Math.max(0, Math.min(1, (expr.smile - 0.05) / 0.6));
      const m = toScreen(rect, box.mouth);
      const l = toScreen(rect, box.mouthL);
      const r = toScreen(rect, box.mouthR);
      const mouthW = Math.max(1, Math.hypot(r.x - l.x, r.y - l.y));
      let angle = Math.atan2(r.y - l.y, r.x - l.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;

      const halfW = Math.max(faceW * 0.22, mouthW * 0.95) * (0.92 + 0.14 * smile);
      const depth = Math.max(faceH * 0.075, halfW * 0.5) * (0.85 + 0.25 * smile);
      const lip = Math.max(5, faceH * 0.072);
      // Point on the painted smile curve, so creases and gloss follow it.
      const onCurve = (t) => ({
        x: halfW * (2 * t - 1),
        y: (1 - t) * (1 - t) * (-depth * 0.16)
          + 2 * (1 - t) * t * (depth * 1.15)
          + t * t * (-depth * 0.16)
      });

      target.save();
      target.translate(m.x, m.y);
      target.rotate(angle);
      target.lineCap = 'round';
      target.lineJoin = 'round';

      const paint = target.createLinearGradient(0, -depth * 0.2, 0, depth);
      paint.addColorStop(0, '#e8203c');
      paint.addColorStop(0.55, '#c40024');
      paint.addColorStop(1, '#7d0016');
      target.strokeStyle = paint;
      target.lineWidth = lip;
      target.beginPath();
      target.moveTo(-halfW, -depth * 0.16);
      target.quadraticCurveTo(0, depth * 1.15, halfW, -depth * 0.16);
      target.stroke();

      // Corner curls, the little upturn a painted clown mouth always has.
      for (const side of [-1, 1]) {
        target.beginPath();
        target.moveTo(side * halfW, -depth * 0.16);
        target.quadraticCurveTo(
          side * halfW * 1.12, -depth * 0.5,
          side * halfW * 0.95, -depth * 0.78
        );
        target.stroke();
      }

      // An inner crease keeps the smile from becoming one thick red rope.
      target.strokeStyle = 'rgba(94, 0, 18, 0.5)';
      target.lineWidth = Math.max(1.5, faceH * 0.016);
      target.beginPath();
      target.moveTo(-halfW * 0.95, -depth * 0.02);
      target.quadraticCurveTo(0, depth * 0.97, halfW * 0.95, -depth * 0.02);
      target.stroke();

      // Short lip creases across the lower lip.
      target.strokeStyle = 'rgba(112, 0, 20, 0.45)';
      target.lineWidth = Math.max(1, faceH * 0.008);
      for (let i = 1; i <= 6; i++) {
        const p = onCurve(i / 7);
        target.beginPath();
        target.moveTo(p.x, p.y - lip * 0.26);
        target.lineTo(p.x + lip * 0.1, p.y + lip * 0.26);
        target.stroke();
      }

      // Gloss along the lower lip.
      target.strokeStyle = 'rgba(255, 255, 255, 0.26)';
      target.lineWidth = Math.max(1.5, lip * 0.16);
      target.beginPath();
      for (let i = 0; i <= 12; i++) {
        const p = onCurve(0.2 + (i / 12) * 0.4);
        if (i === 0) target.moveTo(p.x, p.y + lip * 0.24);
        else target.lineTo(p.x, p.y + lip * 0.24);
      }
      target.stroke();

      target.restore();
    }

    // Glossy red clown nose with a shadow underneath so it sits on the face.
    function drawClownNose(target, rect, box, faceW, faceH, now) {
      const nose = toScreen(rect, box.nose);
      const bob = Math.sin((now || 0) / 320) * faceH * 0.005;
      const noseR = Math.max(10, faceW * 0.115);
      const cy = nose.y + bob;

      const shadow = target.createRadialGradient(
        nose.x, cy + noseR * 0.85, noseR * 0.15,
        nose.x, cy + noseR * 0.85, noseR * 1.15
      );
      shadow.addColorStop(0, 'rgba(60, 0, 10, 0.28)');
      shadow.addColorStop(1, 'rgba(60, 0, 10, 0)');
      target.fillStyle = shadow;
      target.beginPath();
      target.arc(nose.x, cy + noseR * 0.85, noseR * 1.15, 0, Math.PI * 2);
      target.fill();

      const ball = target.createRadialGradient(
        nose.x - noseR * 0.34, cy - noseR * 0.4, noseR * 0.08,
        nose.x, cy, noseR
      );
      ball.addColorStop(0, '#ff8d8d');
      ball.addColorStop(0.42, '#ff2233');
      ball.addColorStop(0.85, '#c00018');
      ball.addColorStop(1, '#7d000e');
      target.fillStyle = ball;
      target.beginPath();
      target.arc(nose.x, cy, noseR, 0, Math.PI * 2);
      target.fill();
      target.strokeStyle = 'rgba(110, 0, 14, 0.35)';
      target.lineWidth = Math.max(1, noseR * 0.06);
      target.stroke();

      target.fillStyle = 'rgba(255, 255, 255, 0.5)';
      target.beginPath();
      target.ellipse(
        nose.x - noseR * 0.32, cy - noseR * 0.36,
        noseR * 0.26, noseR * 0.16, -0.5, 0, Math.PI * 2
      );
      target.fill();
    }

    // Blue eye shadow plus high painted arches, drawn after the eye warps so the
    // make-up stays crisp over the returned eyes.
    function drawClownEyes(target, rect, box, faceW, faceH) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const angle = headTilt(rect, box);
      const eyeSpan = Math.max(faceW * 0.12, Math.hypot(b.x - a.x, b.y - a.y));
      const shadowW = Math.max(10, eyeSpan * 0.42);
      const shadowH = Math.max(6, faceH * 0.055);

      for (const eye of [a, b]) {
        target.save();
        target.translate(eye.x, eye.y - shadowH * 0.45);
        target.rotate(angle);
        const shadow = target.createRadialGradient(0, 0, shadowW * 0.08, 0, 0, shadowW);
        shadow.addColorStop(0, 'rgba(62, 106, 194, 0.6)');
        shadow.addColorStop(0.68, 'rgba(62, 106, 194, 0.3)');
        shadow.addColorStop(1, 'rgba(62, 106, 194, 0)');
        target.fillStyle = shadow;
        target.beginPath();
        target.ellipse(0, 0, shadowW, shadowH * 1.3, 0, 0, Math.PI * 2);
        target.fill();
        target.restore();
      }

      const browW = Math.max(14, eyeSpan * 0.64);
      const browH = Math.max(3, faceH * 0.017);
      target.save();
      target.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const eye = i === 0 ? a : b;
        const dir = i === 0 ? -1 : 1;
        target.save();
        target.translate(eye.x, eye.y - faceH * 0.1);
        target.rotate(angle + dir * 0.12);
        target.strokeStyle = '#231712';
        target.lineWidth = browH;
        target.beginPath();
        target.moveTo(-browW / 2, browH * 0.6);
        target.quadraticCurveTo(0, -browH * 0.9, browW / 2, browH * 0.2);
        target.stroke();
        target.restore();
      }
      target.restore();
    }

    // Rosy painted cheeks.
    function drawClownCheeks(target, rect, box, faceW) {
      for (const key of ['cheekA', 'cheekB']) {
        const cheek = toScreen(rect, box[key]);
        const cheekR = Math.max(12, faceW * 0.14);
        const blush = target.createRadialGradient(
          cheek.x, cheek.y, cheekR * 0.1,
          cheek.x, cheek.y, cheekR
        );
        blush.addColorStop(0, 'rgba(255, 86, 120, 0.55)');
        blush.addColorStop(0.62, 'rgba(255, 86, 120, 0.25)');
        blush.addColorStop(1, 'rgba(255, 86, 120, 0)');
        target.fillStyle = blush;
        target.beginPath();
        target.arc(cheek.x, cheek.y, cheekR, 0, Math.PI * 2);
        target.fill();
      }
    }

    // Full clown face: white greasepaint, a big painted grin, blue eye shadow,
    // high painted arches, rosy cheeks and a glossy red nose.
    function drawClown(target, rect, box, expr, faceW, faceH, now) {
      const outline = paintWhiteFace(target, rect, box, faceW);

      // Everything painted on the face is clipped to the face contour.
      target.save();
      traceShape(target, outline);
      target.clip();

      // Bring the real eyes and mouth back through the paint, slightly enlarged,
      // so the guest still has a face under the make-up.
      for (const key of ['eyeA', 'eyeB']) {
        const eye = toScreen(rect, box[key]);
        softWarp(
          target, rect, eye,
          Math.max(10, faceW * 0.18), Math.max(8, faceH * 0.12),
          1.45, 1.4
        );
      }
      stretchMouth(
        target, rect, box,
        faceW * 0.55, faceH * 0.16,
        1.42, 1.15 + 0.3 * Math.min(1, expr.jawOpen || 0)
      );

      drawClownSmile(target, rect, box, expr, faceW, faceH);
      target.restore();

      drawClownCheeks(target, rect, box, faceW);
      drawClownEyes(target, rect, box, faceW, faceH);
      drawClownNose(target, rect, box, faceW, faceH, now);
    }

    function drawMustache(target, x, y, w, h, angle) {
      target.save();
      target.translate(x, y);
      target.rotate(angle || 0);
      target.fillStyle = '#2b1a10';
      target.beginPath();
      target.moveTo(0, -h * 0.25);
      target.bezierCurveTo(-w * 0.18, -h * 0.8, -w * 0.52, -h * 0.6, -w * 0.52, 0);
      target.bezierCurveTo(-w * 0.52, h * 0.5, -w * 0.16, h * 0.55, 0, h * 0.15);
      target.bezierCurveTo(w * 0.16, h * 0.55, w * 0.52, h * 0.5, w * 0.52, 0);
      target.bezierCurveTo(w * 0.52, -h * 0.6, w * 0.18, -h * 0.8, 0, -h * 0.25);
      target.closePath();
      target.fill();
      target.restore();
    }

    function drawClassic(target, rect, box) {
      const faceW = Math.abs(box.right - box.left) * rect.w;
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const span = Math.max(faceW * 0.2, Math.hypot(b.x - a.x, b.y - a.y));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const lensR = Math.max(15, faceW * 0.15);
      const frame = Math.max(3, lensR * 0.24);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;

      target.save();
      target.translate(centerX, centerY);
      target.rotate(angle);

      // giant lenses
      target.fillStyle = 'rgba(18, 18, 18, 0.92)';
      roundedRect(target, -span / 2 - lensR, -lensR * 0.8, lensR * 2, lensR * 1.6, lensR * 0.55);
      target.fill();
      roundedRect(target, span / 2 - lensR, -lensR * 0.8, lensR * 2, lensR * 1.6, lensR * 0.55);
      target.fill();

      // frames + bridge
      target.strokeStyle = '#080808';
      target.lineWidth = frame;
      roundedRect(target, -span / 2 - lensR, -lensR * 0.8, lensR * 2, lensR * 1.6, lensR * 0.55);
      target.stroke();
      roundedRect(target, span / 2 - lensR, -lensR * 0.8, lensR * 2, lensR * 1.6, lensR * 0.55);
      target.stroke();
      target.beginPath();
      target.moveTo(-span / 2 + lensR * 0.9, -lensR * 0.1);
      target.lineTo(span / 2 - lensR * 0.9, -lensR * 0.1);
      target.stroke();

      // temples
      target.beginPath();
      target.moveTo(-span / 2 - lensR * 0.92, -lensR * 0.2);
      target.lineTo(-span / 2 - lensR * 1.5, -lensR * 0.65);
      target.moveTo(span / 2 + lensR * 0.92, -lensR * 0.2);
      target.lineTo(span / 2 + lensR * 1.5, -lensR * 0.65);
      target.stroke();
      target.restore();

      // mustache under the nose
      const nose = toScreen(rect, box.nose);
      drawMustache(target, nose.x, nose.y + faceW * 0.11, Math.max(30, faceW * 0.52), Math.max(10, faceW * 0.13), angle);
    }

    // 8-bit "deal with it" shades on a hard pixel grid. Shared by the Thug Life
    // and MLG filters, which differ only in palette.
    function drawPixelShades(target, rect, box, faceW, faceH, palette) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const angle = headTilt(rect, box);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2 - faceH * 0.01;
      const u = Math.max(2, faceW * 0.026); // one block of the pixel art

      target.save();
      target.translate(centerX, centerY);
      target.rotate(angle);
      const block = (x0, y0, x1, y1, color) => {
        target.fillStyle = color;
        target.fillRect(
          Math.min(x0, x1) * u, Math.min(y0, y1) * u,
          Math.abs(x1 - x0) * u, Math.abs(y1 - y0) * u
        );
      };

      for (const side of [-1, 1]) {
        const outer = side * 12;
        const inner = side * 2;
        const inset = outer - side;
        // stepped pixel silhouette: wide middle, one block narrower top/bottom
        block(outer, -1, inner, 1, palette.lens);
        block(inset, -2, inner, -1, palette.edge);
        block(inset, 1, inner, 2, palette.edge);
        // temple arm
        block(outer, -1, outer + side * 2, 0, palette.edge);
        // glare pixel
        block(side * 10, -1, side * 8, 0, palette.glint);
      }
      // bridge between the lenses
      block(-2, -1, 2, 1, palette.edge);
      target.restore();
    }

    // A four-pointed twinkle, the sparkle every MLG montage is made of.
    function drawSparkle(target, x, y, size, color, alpha) {
      if (size <= 0) return;
      target.save();
      target.globalAlpha = Math.max(0, Math.min(1, alpha));
      target.translate(x, y);
      target.fillStyle = color;
      target.beginPath();
      target.moveTo(0, -size);
      target.quadraticCurveTo(size * 0.14, -size * 0.14, size, 0);
      target.quadraticCurveTo(size * 0.14, size * 0.14, 0, size);
      target.quadraticCurveTo(-size * 0.14, size * 0.14, -size, 0);
      target.quadraticCurveTo(-size * 0.14, -size * 0.14, 0, -size);
      target.closePath();
      target.fill();
      target.restore();
    }

    function drawIlluminati(target, x, y, size, angle) {
      target.save();
      target.translate(x, y);
      target.rotate(angle);

      const halo = target.createRadialGradient(0, 0, size * 0.2, 0, 0, size * 1.6);
      halo.addColorStop(0, 'rgba(255, 216, 60, 0.5)');
      halo.addColorStop(1, 'rgba(255, 216, 60, 0)');
      target.fillStyle = halo;
      target.beginPath();
      target.arc(0, 0, size * 1.6, 0, Math.PI * 2);
      target.fill();

      target.beginPath();
      target.moveTo(0, -size);
      target.lineTo(size * 0.92, size * 0.72);
      target.lineTo(-size * 0.92, size * 0.72);
      target.closePath();
      const gold = target.createLinearGradient(0, -size, 0, size);
      gold.addColorStop(0, '#fff6b0');
      gold.addColorStop(0.5, '#ffd400');
      gold.addColorStop(1, '#a8790a');
      target.fillStyle = gold;
      target.fill();
      target.lineWidth = Math.max(2, size * 0.1);
      target.strokeStyle = '#4a3400';
      target.stroke();

      // the all-seeing eye
      target.fillStyle = '#171006';
      target.beginPath();
      target.ellipse(0, size * 0.2, size * 0.28, size * 0.17, 0, 0, Math.PI * 2);
      target.fill();
      target.fillStyle = 'rgba(255, 255, 255, 0.85)';
      target.beginPath();
      target.arc(-size * 0.08, size * 0.13, size * 0.06, 0, Math.PI * 2);
      target.fill();
      target.restore();
    }

    // ---------- art props ----------
    function propReady(prop) {
      return !!(prop && prop.canvas && prop.w > 0 && prop.h > 0);
    }

    // A prop centred on (x, y), scaled to `width` on screen.
    function drawProp(target, prop, x, y, width, angle) {
      if (!propReady(prop)) return false;
      const height = width * (prop.h / prop.w);
      target.save();
      target.translate(x, y);
      if (angle) target.rotate(angle);
      target.drawImage(prop.canvas, prop.x, prop.y, prop.w, prop.h, -width / 2, -height / 2, width, height);
      target.restore();
      return true;
    }

    // A prop held in the mouth: its own tip sits on (x, y) and the prop runs
    // away from the face along `angle`, `length` being its full extent.
    function drawPropHeld(target, prop, x, y, length, angle) {
      if (!propReady(prop)) return false;
      const width = length * (prop.w / Math.hypot(prop.w, prop.h));
      const height = width * (prop.h / prop.w);
      target.save();
      target.translate(x, y);
      if (angle) target.rotate(angle);
      target.drawImage(prop.canvas, prop.x, prop.y, prop.w, prop.h, -width * 0.04, -height * 0.08, width, height);
      target.restore();
      return true;
    }

    function eyeCenter(rect, box) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function faceCenterX(rect, box) {
      return toScreen(rect, { x: (box.left + box.right) / 2, y: box.top }).x;
    }

    function faceTopY(rect, box) {
      return toScreen(rect, { x: (box.left + box.right) / 2, y: Math.min(box.top, box.bottom) }).y;
    }

    function faceBottomY(rect, box) {
      return toScreen(rect, { x: (box.left + box.right) / 2, y: Math.max(box.top, box.bottom) }).y;
    }

    function mouthCorner(rect, box) {
      const left = toScreen(rect, box.mouthL);
      const right = toScreen(rect, box.mouthR);
      return left.x > right.x ? left : right;
    }

    function drawArtShades(target, rect, box, faceW, faceH) {
      const center = eyeCenter(rect, box);
      return drawProp(target, ART.shades, center.x, center.y - faceH * 0.005, faceW * 0.92, headTilt(rect, box));
    }

    // Cap on top of the head, its brim coming down just above the brows.
    function drawArtCap(target, rect, box, faceW, faceH) {
      if (!propReady(ART.cap)) return false;
      const width = faceW * 1.26;
      const height = width * (ART.cap.h / ART.cap.w);
      const brim = faceTopY(rect, box) + faceH * 0.16;
      return drawProp(target, ART.cap, faceCenterX(rect, box), brim - height / 2, width, headTilt(rect, box) * 0.45);
    }

    // Chain under the chin; `top` is where its top edge sits relative to the chin
    // in face heights (negative pulls it up over the jaw).
    function drawArtChain(target, rect, box, prop, faceW, faceH, widthFactor, top, angle) {
      if (!propReady(prop)) return false;
      const width = faceW * widthFactor;
      const height = width * (prop.h / prop.w);
      const topY = faceBottomY(rect, box) + faceH * top;
      return drawProp(target, prop, faceCenterX(rect, box), topY + height / 2, width, angle || 0);
    }

    // A soft, slightly irregular puff used as the smoke stamp, built once and
    // reused for every puff on every face.
    let smokeStamp = null;
    function getSmokeStamp() {
      if (smokeStamp) return smokeStamp;
      if (typeof document === 'undefined') return null;
      const size = 128;
      const stamp = document.createElement('canvas');
      stamp.width = size;
      stamp.height = size;
      const sctx = stamp.getContext('2d');
      if (!sctx) return null;
      // A few overlapping soft blobs keep the puff irregular instead of round.
      const blob = (x, y, r, a) => {
        const grad = sctx.createRadialGradient(x, y, r * 0.05, x, y, r);
        grad.addColorStop(0, `rgba(255, 255, 255, ${a})`);
        grad.addColorStop(0.55, `rgba(248, 248, 246, ${(a * 0.82).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(244, 244, 242, 0)');
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.arc(x, y, r, 0, Math.PI * 2);
        sctx.fill();
      };
      // Dense cores with a soft rim: the smoke should read as solid, not haze.
      blob(64, 64, 56, 0.96);
      blob(46, 52, 40, 0.86);
      blob(80, 74, 44, 0.84);
      blob(64, 88, 34, 0.62);
      smokeStamp = stamp;
      return smokeStamp;
    }

    // Screen position of the lit end of a prop held in the mouth. Mirrors the
    // placement in drawPropHeld, so the smoke starts at the ember rather than
    // at the lips.
    function heldTip(x, y, angle, prop, length) {
      const width = length * (prop.w / Math.hypot(prop.w, prop.h));
      const height = width * (prop.h / prop.w);
      const lx = width * 0.81;
      const ly = height * 0.72;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos };
    }

    // Animated smoke from the ember: dense puffs rise, drift and grow out of a
    // gently pulsing glow.
    function emitCigarSmoke(target, x, y, angle, prop, length, faceW, faceH, now) {
      const tip = heldTip(x, y, angle, prop, length);
      const stamp = getSmokeStamp();
      if (!stamp) return;
      const t = (now || 0) / 1000;
      const base = Math.max(8, faceW * 0.075);
      const puffs = 9;

      target.save();
      // Ember glow first, so the smoke seems to come out of it.
      const glow = target.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, base * 1.5);
      glow.addColorStop(0, `rgba(255, 138, 40, ${(0.34 + 0.1 * Math.sin(t * 3.1)).toFixed(3)})`);
      glow.addColorStop(0.5, 'rgba(255, 90, 20, 0.14)');
      glow.addColorStop(1, 'rgba(255, 70, 10, 0)');
      target.fillStyle = glow;
      target.beginPath();
      target.arc(tip.x, tip.y, base * 1.5, 0, Math.PI * 2);
      target.fill();

      // Each puff runs its own cycle from the ember upward; the growing size and
      // the fade in/out are what make the plume read as smoke.
      for (let i = 0; i < puffs; i++) {
        const phase = (t * 0.2 + i / puffs) % 1;
        const wobble = Math.sin(phase * 5.4 + i * 1.9) * faceW * 0.08 * phase;
        const drift = Math.sin(phase * 2.2 + i * 0.8) * faceW * 0.05;
        const px = tip.x + wobble + drift + phase * faceW * 0.02;
        const py = tip.y - faceH * 0.015 - phase * faceH * 0.56;
        const size = base * (0.8 + phase * 3.3);
        const fade = Math.sin(Math.PI * Math.min(1, phase * 1.1));
        const alpha = Math.pow(Math.max(0, fade), 0.5) * 0.92;
        if (alpha <= 0.01) continue;
        target.globalAlpha = alpha;
        target.save();
        target.translate(px, py);
        target.rotate((phase - 0.5) * 1.1 + i * 0.5);
        target.drawImage(stamp, -size / 2, -size / 2, size, size);
        target.restore();
      }

      target.restore();
    }

    function drawArtJoint(target, rect, box, faceW, faceH, factor, now) {
      const corner = mouthCorner(rect, box);
      const length = faceW * (factor || 0.66);
      const painted = drawPropHeld(target, ART.joint, corner.x, corner.y - faceH * 0.01, length, -0.9);
      if (painted) {
        emitCigarSmoke(target, corner.x, corner.y - faceH * 0.01, -0.9, ART.joint, length, faceW, faceH, now);
      }
      return painted;
    }

    function drawArtBlunt(target, rect, box, faceW, faceH, now) {
      const corner = mouthCorner(rect, box);
      const length = faceW * 0.42;
      const painted = drawPropHeld(target, ART.blunt, corner.x, corner.y - faceH * 0.01, length, -0.6);
      if (painted) {
        emitCigarSmoke(target, corner.x, corner.y - faceH * 0.01, -0.6, ART.blunt, length, faceW, faceH, now);
      }
      return painted;
    }

    function drawShades(target, rect, box, faceW, faceH) {
      if (drawArtShades(target, rect, box, faceW, faceH)) return;
      // Until the art is loaded: the hand-drawn 8-bit shades.
      drawPixelShades(target, rect, box, faceW, faceH, {
        lens: '#0a0a0f', edge: '#0a0a0f', glint: 'rgba(255, 255, 255, 0.35)'
      });
    }

    function drawThug(target, rect, box, faceW, faceH, now) {
      drawShades(target, rect, box, faceW, faceH);
      drawArtJoint(target, rect, box, faceW, faceH, undefined, now);
    }

    // A gold grill that appears only while the guest smiles with their teeth
    // showing. It is clipped to the tracked inner lip contour, so the gold sits
    // exactly between the lips and follows the smile and head tilt.
    function drawGoldGrill(target, rect, box, expr, faceW, now) {
      if (!box.lipsInner || box.lipsInner.length < 6) return;
      const smile = Math.max(0, Math.min(1, (((expr && expr.smile) || 0) - 0.18) / 0.55));
      if (smile < 0.05) return;

      const inner = box.lipsInner.map((p) => toScreen(rect, p));
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const p of inner) {
        if (p.x < left) left = p.x;
        if (p.x > right) right = p.x;
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }
      const w = right - left;
      const h = bottom - top;
      if (w < 4 || h < 2) return;

      // Teeth only show once the lips part; a closed-lip smile stays uncovered.
      const open = Math.max(0, Math.min(1, (h / w - 0.05) / 0.22));
      if (open < 0.06) return;
      const strength = Math.min(1, smile * (0.45 + 0.55 * open));
      const teethH = h * (0.55 + 0.3 * open);

      target.save();
      target.beginPath();
      inner.forEach((p, i) => (i === 0 ? target.moveTo(p.x, p.y) : target.lineTo(p.x, p.y)));
      target.closePath();
      target.clip();
      target.globalAlpha = strength;

      const gold = target.createLinearGradient(0, top, 0, top + teethH);
      gold.addColorStop(0, '#fff8c8');
      gold.addColorStop(0.3, '#ffdf58');
      gold.addColorStop(0.65, '#f0b31a');
      gold.addColorStop(1, '#9c6b00');
      target.fillStyle = gold;
      target.fillRect(left, top, w, teethH);

      // Tooth separators.
      const teeth = Math.max(4, Math.min(8, Math.round(w / Math.max(6, faceW * 0.055))));
      target.strokeStyle = 'rgba(94, 62, 0, 0.55)';
      target.lineWidth = Math.max(1, w * 0.012);
      for (let i = 1; i < teeth; i++) {
        const x = left + (w * i) / teeth;
        target.beginPath();
        target.moveTo(x, top);
        target.lineTo(x, top + teethH);
        target.stroke();
      }

      // A highlight that sweeps across the grill while it is on screen.
      const sweep = ((now || 0) / 950) % 1;
      const sx = left - w * 0.35 + sweep * w * 1.7;
      const shine = target.createLinearGradient(sx - w * 0.2, top, sx + w * 0.2, top + teethH);
      shine.addColorStop(0, 'rgba(255, 255, 255, 0)');
      shine.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
      shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
      target.fillStyle = shine;
      target.fillRect(left, top, w, teethH);
      target.restore();

      // Thin gold rim on the lip opening.
      target.save();
      target.globalAlpha = strength * 0.9;
      target.beginPath();
      inner.forEach((p, i) => (i === 0 ? target.moveTo(p.x, p.y) : target.lineTo(p.x, p.y)));
      target.closePath();
      target.strokeStyle = 'rgba(255, 219, 88, 0.85)';
      target.lineWidth = Math.max(1, w * 0.015);
      target.stroke();
      target.restore();

      // Twinkles at the mouth corners.
      const twinkle = (Math.sin((now || 0) / 260) + 1) / 2;
      drawSparkle(target, left, top + h * 0.35, Math.max(3, w * 0.05), '#fff3a0', 0.35 + 0.5 * twinkle);
      drawSparkle(target, right, top + h * 0.35, Math.max(3, w * 0.05), '#fff3a0', 0.35 + 0.5 * (1 - twinkle));
    }

    // The whole outfit: cap, shades, dollar chain, gold grill and a blunt.
    function drawBoss(target, rect, box, expr, faceW, faceH, now) {
      drawArtCap(target, rect, box, faceW, faceH);
      drawArtChain(target, rect, box, ART.chainBoss, faceW, faceH, 0.75, -0.16);
      drawShades(target, rect, box, faceW, faceH);
      drawGoldGrill(target, rect, box, expr, faceW, now);
      drawArtBlunt(target, rect, box, faceW, faceH, now);
    }

    // Shades, a long link chain and a lit joint.
    function drawBling(target, rect, box, faceW, faceH, now) {
      drawShades(target, rect, box, faceW, faceH);
      drawArtChain(target, rect, box, ART.chainBling, faceW, faceH, 1.26, -0.12);
      drawArtJoint(target, rect, box, faceW, faceH, 0.62, now);
    }

    function drawJointFuel(target, rect, box, faceW, faceH, now) {
      drawArtJoint(target, rect, box, faceW, faceH, 0.8, now);
    }

    // Over the top on purpose: gold 8-bit shades, a slowly turning illuminati
    // above the head and sparkles orbiting the face.
    function drawMlg(target, rect, box, faceW, faceH, now) {
      const t = now / 1000;
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      const top = toScreen(rect, { x: (box.left + box.right) / 2, y: Math.min(box.top, box.bottom) });

      for (let i = 0; i < 6; i++) {
        const angle = t * 0.7 + (i / 6) * Math.PI * 2;
        const radius = faceW * (0.6 + 0.1 * Math.sin(t * 1.7 + i));
        drawSparkle(
          target,
          centerX + Math.cos(angle) * radius,
          centerY + Math.sin(angle) * radius * 0.85,
          faceW * (0.05 + 0.025 * Math.abs(Math.sin(t * 4 + i))),
          '#fff8c0',
          0.45 + 0.55 * Math.abs(Math.sin(t * 3 + i))
        );
      }

      if (!drawArtShades(target, rect, box, faceW, faceH)) {
        drawPixelShades(target, rect, box, faceW, faceH, {
          lens: '#241600', edge: '#ffd400', glint: '#ffffff'
        });
      }
      drawArtJoint(target, rect, box, faceW, faceH, undefined, now);

      drawIlluminati(target, top.x, top.y - faceH * 0.3, faceW * 0.2, Math.sin(t * 0.8) * 0.5);
    }

    // ---------- face swap ----------
    // Everyone in frame wears the face of the next person along the row: the
    // faces are sorted by screen position and the cycle is shifted, so a group
    // of any size swaps in one pass instead of only working for two people.
    function faceScreenMetrics(rect, box) {
      const a = toScreen(rect, box.eyeA);
      const b = toScreen(rect, box.eyeB);
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2
      });
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return {
        center,
        angle,
        width: Math.max(8, Math.abs(box.right - box.left) * rect.w),
        height: Math.max(8, Math.abs(box.bottom - box.top) * rect.h)
      };
    }

    // Copies `from`'s face onto `to`: a feathered elliptical patch sampled from
    // the raw frame (not from the canvas), scaled, rotated and shifted so the
    // eyes and mouth line up. Sampling the video is what stops several swaps
    // from feeding into each other when a whole row of people trades faces.
    function swapFaceOnto(target, rect, from, to) {
      const src = faceScreenMetrics(rect, from);
      const dst = faceScreenMetrics(rect, to);
      const scaleX = dst.width / src.width;
      const scaleY = dst.height / src.height;

      warpPatch(
        target, rect, dst.center,
        Math.max(12, dst.width * 0.66), Math.max(12, dst.height * 0.6),
        (ctx) => {
          ctx.rotate(dst.angle);
          ctx.scale(scaleX, scaleY);
          ctx.rotate(-src.angle);
          ctx.translate(dst.center.x - src.center.x, dst.center.y - src.center.y);
        }
      );
    }

    function drawFaceSwap(target, rect, boxes) {
      if (!boxes || boxes.length < 2) return false;
      const order = boxes.slice().sort((a, b) => {
        const ax = toScreen(rect, a.eyeA).x + toScreen(rect, a.eyeB).x;
        const bx = toScreen(rect, b.eyeA).x + toScreen(rect, b.eyeB).x;
        return ax - bx;
      });
      for (let i = 0; i < order.length; i++) {
        swapFaceOnto(target, rect, order[(i + 1) % order.length], order[i]);
      }
      return true;
    }

    function drawFilter(target, rect, box, id, expr, now, skin) {
      if (id === 'none') return undefined;
      const faceW = Math.max(1, Math.abs(box.right - box.left) * rect.w);
      const faceH = Math.max(1, Math.abs(box.bottom - box.top) * rect.h);
      const faceExpr = expr || ZERO_EXPR;
      if (id === 'thug') return drawThug(target, rect, box, faceW, faceH, now);
      if (id === 'mlg') return drawMlg(target, rect, box, faceW, faceH, now);
      if (id === 'shades') return drawShades(target, rect, box, faceW, faceH);
      if (id === 'boss') return drawBoss(target, rect, box, faceExpr, faceW, faceH, now);
      if (id === 'bling') return drawBling(target, rect, box, faceW, faceH, now);
      if (id === 'joint') return drawJointFuel(target, rect, box, faceW, faceH, now);
      if (id === 'big') return drawBigEyes(target, rect, box, faceExpr, faceW, faceH, now, skin);
      if (id === 'cheeky') return drawCheeky(target, rect, box, faceExpr, faceW, faceH);
      if (id === 'unibrow') return drawUnibrow(target, rect, box, faceExpr, faceW, faceH);
      if (id === 'cat') return drawCat(target, rect, box, faceW, faceH);
      if (id === 'bunny') return drawBunny(target, rect, box, faceW, faceH, now);
      if (id === 'hearts') return drawHearts(target, rect, box, faceW, faceH, now);
      if (id === 'makeup') return drawMakeup(target, rect, box, faceW, faceH);
      if (id === 'squish') return drawSquish(target, rect, box, faceW, faceH);
      if (id === 'melt') return drawMelt(target, rect, box, faceW, faceH);
      if (id === 'jelly') return drawJelly(target, rect, box, faceW, faceH, now);
      if (id === 'clown') return drawClown(target, rect, box, faceExpr, faceW, faceH, now);
      if (id === 'dog') return drawDog(target, rect, box);
      if (id === 'classic') return drawClassic(target, rect, box);
      return undefined;
    }

    // ---------- face tracking ----------
    async function loadTracker() {
      if (trackerState !== 'idle') return;
      trackerState = 'loading';
      try {
        const vision = await import(VISION_BUNDLE);
        const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM);
        const build = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: MAX_FACES,
          outputFaceBlendshapes: true
        });
        try {
          landmarker = await build('GPU');
        } catch (gpuError) {
          landmarker = await build('CPU');
        }
        trackerState = 'ready';
      } catch (err) {
        console.warn('Face tracking unavailable — filters use fixed positions:', err);
        trackerState = 'unavailable';
      }
    }

    function detect(now) {
      if (!landmarker || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;
      if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
      lastDetectAt = now;
      lastVideoTime = video.currentTime;
      try {
        const result = landmarker.detectForVideo(video, now);
        const shapes = (result && result.faceLandmarks) || [];
        const blendshapes = (result && result.faceBlendshapes) || [];
        // Every face in the frame is matched to a track or starts a new one, so
        // nobody is left without an overlay.
        for (const track of tracks) track.claimed = false;
        const count = Math.min(shapes.length, MAX_FACES);
        for (let i = 0; i < count; i++) {
          const points = shapes[i];
          if (!points || !points.length) continue;
          const box = frameFromLandmarks(points);
          const expr = readExpression(blendshapes[i] ? blendshapes[i].categories : null, box);
          const track = claimTrack(box);
          if (track) {
            track.tracked = box;
            track.trackedExpr = expr;
            track.lastSeen = now;
          } else {
            tracks.push(newTrack(box, expr, now));
          }
        }
      } catch (err) {
        if (!drawWarningShown) {
          drawWarningShown = true;
          console.warn('Face detection frame failed:', err);
        }
      }
    }

    // ---------- surfaces ----------
    function syncCanvasSize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      return width > 0 && height > 0;
    }

    function renderFrame(target, rect, surfaceW, surfaceH, now) {
      target.clearRect(0, 0, surfaceW, surfaceH);
      if (!video.videoWidth || !video.videoHeight) return;

      // With no filter selected there is nothing to track, so skip detection
      // entirely and keep the preview as cheap as a plain video element.
      let faces = null;
      if (activeFilter !== 'none') {
        detect(now);
        faces = resolveFaces(rect, surfaceW, surfaceH, now);
      }

      drawMirroredVideo(target, rect);
      if (faces) {
        // Face swap works across the whole group, so it needs every face at
        // once instead of the per-face overlay pass below.
        if (activeFilter === 'faceswap') {
          drawFaceSwap(target, rect, faces.map((entry) => entry.box));
          return;
        }
        for (const entry of faces) {
          drawFilter(target, rect, entry.box, activeFilter, entry.expr, now, entry.skin);
        }
      }
    }

    function draw() {
      rafId = window.requestAnimationFrame(draw);
      if (!video.srcObject || video.readyState < 2) return;
      if (!syncCanvasSize()) return;
      const rect = coverRect(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
      renderFrame(ctx, rect, canvas.width, canvas.height, performance.now());
    }

    function start() {
      // Load the landmarker lazily: the model is a few MB and is only useful
      // once the camera is open.
      loadTracker();
      if (rafId) return;
      rafId = window.requestAnimationFrame(draw);
    }

    function stop() {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    function setFilter(id) {
      activeFilter = FILTERS.some((filter) => filter.id === id) ? id : 'none';
      return activeFilter;
    }

    // Renders the same scene at full sensor resolution so saved photos carry the
    // filter. Coordinates are normalized, so the preview and the photo agree.
    function drawCapture(target, width, height) {
      if (!width || !height || !video.videoWidth) return false;
      const rect = { x: 0, y: 0, w: width, h: height };
      const now = performance.now();

      target.save();
      target.clearRect(0, 0, width, height);
      drawMirroredVideo(target, rect);

      if (activeFilter !== 'none') {
        // Reuse the faces the preview is tracking; their coordinates are
        // normalized, so they land on the same heads at sensor resolution.
        const live = tracks.filter((track) => now - track.lastSeen < FACE_GRACE_MS * 2);
        if (activeFilter === 'faceswap') {
          drawFaceSwap(target, rect, live.map((track) => track.face));
        } else {
          if (!live.length) {
            drawFilter(target, rect, fallbackFrame(rect, width, height), activeFilter, ZERO_EXPR, now, fallbackSkin);
          }
          for (const track of live) {
            drawFilter(target, rect, track.face, activeFilter, track.expr, now, track.skin);
          }
        }
      }

      target.restore();
      return true;
    }

    return {
      setFilter,
      getFilter: () => activeFilter,
      getTrackerStatus: () => trackerState,
      start,
      stop,
      drawCapture
    };
  }

  window.SnapBoxFilters = { FILTERS, create };
})();
