/* ============================================================
   SnapBox — interactive face filters
   ------------------------------------------------------------
   Draws the mirrored camera frame into a canvas and adds funny
   overlays on top of it. Face positions come from MediaPipe's
   Face Landmarker; when it cannot load (offline, blocked CDN,
   old browser) the same filters render at a fixed position so
   the feature keeps working.

   Public API: window.SnapBoxFilters = { FILTERS, create }
   ============================================================ */
(function () {
  'use strict';

  const TASKS_VISION_VERSION = '0.10.14';
  const VISION_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
  const VISION_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const FILTERS = [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'thug', label: 'Thug Life', emoji: '🕶️' },
    { id: 'mlg', label: 'MLG', emoji: '💯' },
    { id: 'shades', label: 'Pixel Shades', emoji: '😎' },
    { id: 'boss', label: 'Thug Boss', emoji: '🧢' },
    { id: 'bling', label: 'Bling', emoji: '💰' },
    { id: 'joint', label: 'Joint', emoji: '🚬' },
    { id: 'big', label: 'Big Eyes + Mouth', emoji: '👀' },
    { id: 'cheeky', label: 'Cheeky Grin', emoji: '😏' },
    { id: 'unibrow', label: 'Unibrow', emoji: '🤨' },
    { id: 'squish', label: 'Squish', emoji: '🥞' },
    { id: 'melt', label: 'Meltdown', emoji: '🫠' },
    { id: 'jelly', label: 'Jelly', emoji: '🪼' },
    { id: 'clown', label: 'Clown', emoji: '🤡' },
    { id: 'dog', label: 'Snap Dog', emoji: '🐶' },
    { id: 'classic', label: 'Shades', emoji: '🕶️' }
  ];

  const DETECT_INTERVAL_MS = 80;  // landmark pass ~12x/s; smoothing keeps up
  const FACE_GRACE_MS = 700;      // keep the last face briefly when detection blinks
  const SMOOTHING = 0.4;          // lower = smoother, higher = snappier

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
    let skinTone = null;
    let skinToneAt = 0;
    let activeFilter = 'none';
    let landmarker = null;
    let trackerState = 'idle'; // idle | loading | ready | unavailable
    let rafId = 0;
    let lastDetectAt = 0;
    let lastVideoTime = -1;
    let lastFaceAt = 0;
    let trackedFace = null;
    let face = null;
    let trackedExpression = { ...ZERO_EXPR };
    let expression = { ...ZERO_EXPR };
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
    function sampleSkinTone(box, now) {
      if (skinTone && now - skinToneAt < 400) return skinTone;
      skinToneAt = now;
      if (!sampleCtx || !video.videoWidth || !video.videoHeight) return skinTone || DEFAULT_SKIN;

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

      if (hits) skinTone = { r: r / hits, g: g / hits, b: b / hits };
      return skinTone || DEFAULT_SKIN;
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

    // Points and expression weights are interpolated every frame, so easing
    // between detections keeps the overlay glued to the face instead of stepping.
    function resolveFace(rect, surfaceW, surfaceH, now) {
      const hasRecentFace = trackedFace && now - lastFaceAt < FACE_GRACE_MS;
      const target = hasRecentFace ? trackedFace : fallbackFrame(rect, surfaceW, surfaceH);
      face = face ? smooth(face, target) : target;
      expression = smoothExpression(expression, hasRecentFace ? trackedExpression : ZERO_EXPR);
      return face;
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
    function paintFace(target, rect, box, faceW, faceH, now) {
      const outline = faceOutline(rect, box);
      const tone = sampleSkinTone(box, now);
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
    function drawBigEyes(target, rect, box, expr, faceW, faceH, now) {
      const outline = paintFace(target, rect, box, faceW, faceH, now);

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
    // drawn on top of the skin and follows the head tilt.
    function drawUnibrow(target, rect, box, faceW, faceH) {
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

      // Thick in the middle where the two brows meet, tapering to the ends.
      target.beginPath();
      target.moveTo(-halfW, thick * 0.3);
      target.quadraticCurveTo(-halfW * 0.45, -thick * 0.6, 0, -thick * 0.8);
      target.quadraticCurveTo(halfW * 0.45, -thick * 0.6, halfW, thick * 0.3);
      target.quadraticCurveTo(halfW * 0.5, thick, 0, thick);
      target.quadraticCurveTo(-halfW * 0.5, thick, -halfW, thick * 0.3);
      target.closePath();

      const hair = target.createLinearGradient(0, -thick, 0, thick);
      hair.addColorStop(0, '#2c2018');
      hair.addColorStop(1, '#120c08');
      target.fillStyle = hair;
      target.fill();

      // A few stray hairs so it reads as hair, not a painted stripe.
      target.strokeStyle = 'rgba(16, 10, 7, 0.9)';
      target.lineWidth = Math.max(1, thick * 0.16);
      for (let i = -3; i <= 3; i++) {
        const x = i * halfW * 0.22;
        target.beginPath();
        target.moveTo(x, -thick * 0.35);
        target.lineTo(x + halfW * 0.035, -thick * 1.0);
        target.stroke();
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

    function drawClown(target, rect, box, expr, faceW, faceH) {
      // The clown uses the plain mouth stretch: no painted face, otherwise the
      // white make-up look below would paint over the real one.
      const smile = Math.max(0, Math.min(1, (expr.smile - 0.12) / 0.68));
      const strength = 0.5 + 0.5 * smile;
      stretchMouth(
        target, rect, box,
        faceW, faceH * 0.15,
        1 + 3.2 * strength,
        1 + 0.9 * strength + 0.45 * Math.min(1, expr.jawOpen || 0)
      );

      const nose = toScreen(rect, box.nose);
      const noseR = Math.max(10, faceW * 0.11);
      const noseGradient = target.createRadialGradient(
        nose.x - noseR * 0.3, nose.y - noseR * 0.35, noseR * 0.15,
        nose.x, nose.y, noseR
      );
      noseGradient.addColorStop(0, '#ff8a8a');
      noseGradient.addColorStop(0.5, '#ff1f1f');
      noseGradient.addColorStop(1, '#a30000');
      target.save();
      target.beginPath();
      target.arc(nose.x, nose.y, noseR, 0, Math.PI * 2);
      target.fillStyle = noseGradient;
      target.fill();
      target.lineWidth = Math.max(1, noseR * 0.08);
      target.strokeStyle = 'rgba(110, 0, 0, 0.45)';
      target.stroke();
      target.restore();

      for (const key of ['cheekA', 'cheekB']) {
        const cheek = toScreen(rect, box[key]);
        const cheekR = Math.max(10, faceW * 0.12);
        const blush = target.createRadialGradient(
          cheek.x, cheek.y, cheekR * 0.1,
          cheek.x, cheek.y, cheekR
        );
        blush.addColorStop(0, 'rgba(255, 70, 110, 0.42)');
        blush.addColorStop(1, 'rgba(255, 70, 110, 0)');
        target.save();
        target.fillStyle = blush;
        target.beginPath();
        target.arc(cheek.x, cheek.y, cheekR, 0, Math.PI * 2);
        target.fill();
        target.restore();
      }
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

    function drawArtJoint(target, rect, box, faceW, faceH, factor) {
      const corner = mouthCorner(rect, box);
      return drawPropHeld(target, ART.joint, corner.x, corner.y - faceH * 0.01, faceW * (factor || 0.66), -0.9);
    }

    function drawArtBlunt(target, rect, box, faceW, faceH) {
      const corner = mouthCorner(rect, box);
      return drawPropHeld(target, ART.blunt, corner.x, corner.y - faceH * 0.01, faceW * 0.42, -0.6);
    }

    function drawShades(target, rect, box, faceW, faceH) {
      if (drawArtShades(target, rect, box, faceW, faceH)) return;
      // Until the art is loaded: the hand-drawn 8-bit shades.
      drawPixelShades(target, rect, box, faceW, faceH, {
        lens: '#0a0a0f', edge: '#0a0a0f', glint: 'rgba(255, 255, 255, 0.35)'
      });
    }

    function drawThug(target, rect, box, faceW, faceH) {
      drawShades(target, rect, box, faceW, faceH);
      drawArtJoint(target, rect, box, faceW, faceH);
    }

    // The whole outfit: cap, shades, dollar chain and a blunt.
    function drawBoss(target, rect, box, faceW, faceH) {
      drawArtCap(target, rect, box, faceW, faceH);
      drawArtChain(target, rect, box, ART.chainBoss, faceW, faceH, 0.75, -0.16);
      drawShades(target, rect, box, faceW, faceH);
      drawArtBlunt(target, rect, box, faceW, faceH);
    }

    // Shades, a long link chain and a lit joint.
    function drawBling(target, rect, box, faceW, faceH) {
      drawShades(target, rect, box, faceW, faceH);
      drawArtChain(target, rect, box, ART.chainBling, faceW, faceH, 1.26, -0.12);
      drawArtJoint(target, rect, box, faceW, faceH, 0.62);
    }

    function drawJointFuel(target, rect, box, faceW, faceH) {
      drawArtJoint(target, rect, box, faceW, faceH, 0.8);
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
      drawArtJoint(target, rect, box, faceW, faceH);

      drawIlluminati(target, top.x, top.y - faceH * 0.3, faceW * 0.2, Math.sin(t * 0.8) * 0.5);
    }

    function drawFilter(target, rect, box, id, expr, now) {
      if (id === 'none') return undefined;
      const faceW = Math.max(1, Math.abs(box.right - box.left) * rect.w);
      const faceH = Math.max(1, Math.abs(box.bottom - box.top) * rect.h);
      const faceExpr = expr || ZERO_EXPR;
      if (id === 'thug') return drawThug(target, rect, box, faceW, faceH);
      if (id === 'mlg') return drawMlg(target, rect, box, faceW, faceH, now);
      if (id === 'shades') return drawShades(target, rect, box, faceW, faceH);
      if (id === 'boss') return drawBoss(target, rect, box, faceW, faceH);
      if (id === 'bling') return drawBling(target, rect, box, faceW, faceH);
      if (id === 'joint') return drawJointFuel(target, rect, box, faceW, faceH);
      if (id === 'big') return drawBigEyes(target, rect, box, faceExpr, faceW, faceH, now);
      if (id === 'cheeky') return drawCheeky(target, rect, box, faceExpr, faceW, faceH);
      if (id === 'unibrow') return drawUnibrow(target, rect, box, faceW, faceH);
      if (id === 'squish') return drawSquish(target, rect, box, faceW, faceH);
      if (id === 'melt') return drawMelt(target, rect, box, faceW, faceH);
      if (id === 'jelly') return drawJelly(target, rect, box, faceW, faceH, now);
      if (id === 'clown') return drawClown(target, rect, box, faceExpr, faceW, faceH);
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
          numFaces: 1,
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
        const points = result && result.faceLandmarks && result.faceLandmarks[0];
        if (points && points.length) {
          trackedFace = frameFromLandmarks(points);
          const blendshapes = result.faceBlendshapes && result.faceBlendshapes[0]
            ? result.faceBlendshapes[0].categories
            : null;
          trackedExpression = readExpression(blendshapes, trackedFace);
          lastFaceAt = now;
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
      let box = null;
      if (activeFilter !== 'none') {
        detect(now);
        box = resolveFace(rect, surfaceW, surfaceH, now);
      }

      drawMirroredVideo(target, rect);
      if (box) drawFilter(target, rect, box, activeFilter, expression, now);
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
        // Reuse the face the preview is tracking, but never blend a preview-
        // relative fallback into the sensor-sized frame.
        const trackedRecently = trackedFace && now - lastFaceAt < FACE_GRACE_MS * 2;
        const box = trackedRecently && face ? face : fallbackFrame(rect, width, height);
        drawFilter(target, rect, box, activeFilter, trackedRecently ? expression : ZERO_EXPR, now);
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
