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
    { id: 'smile', label: 'Mega Smile', emoji: '😄' },
    { id: 'big', label: 'Big Eyes + Mouth', emoji: '👀' },
    { id: 'balloon', label: 'Balloon Head', emoji: '🎈' },
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
      // estimate keeps Mega Smile alive if blendshapes are unavailable.
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

    // Warps a soft-edged elliptical patch of the frame around `center`. The
    // feathered rim is what keeps the exaggerated faces from showing a seam.
    function softWarp(target, rect, center, radiusX, radiusY, scaleX, scaleY) {
      const rx = Math.max(2, radiusX);
      const ry = Math.max(2, radiusY);
      if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) return;
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
      // Scale about the patch centre, then draw the mirrored feed into it.
      warpCtx.translate(w / 2, h / 2);
      warpCtx.scale(scaleX, scaleY);
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

    function drawBigEyes(target, rect, box, faceW, faceH) {
      const eyeRx = Math.max(12, faceW * 0.17);
      const eyeRy = Math.max(10, faceH * 0.12);

      // 2.2x keeps both features clearly past the "twice as big" mark.
      for (const key of ['eyeA', 'eyeB']) {
        const eye = toScreen(rect, box[key]);
        softWarp(target, rect, eye, eyeRx, eyeRy, 2.2, 2.2);
      }

      const mouth = toScreen(rect, box.mouth);
      softWarp(
        target, rect, mouth,
        Math.max(18, faceW * 0.46), Math.max(10, faceH * 0.13),
        2.2, 2.2
      );
    }

    function drawMegaSmile(target, rect, box, expr, faceW, faceH) {
      const smile = Math.max(0, Math.min(1, (expr.smile - 0.12) / 0.68));
      // Neutral faces get a tiny lift; a real smile stretches the mouth region
      // up to ~3.6x wide and ~2.2x tall — a whole-face grin. The patch stays
      // between the nose and chin so eyes and nose are never replaced.
      const strength = 0.05 + 0.95 * smile;
      const mouth = toScreen(rect, box.mouth);
      softWarp(
        target, rect, mouth,
        faceW * 0.95, faceH * 0.12,
        1 + 2.6 * strength,
        1 + 1.2 * strength + 0.35 * Math.min(1, expr.jawOpen || 0)
      );
    }

    function drawBalloon(target, rect, box, faceW, faceH) {
      const center = toScreen(rect, {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2
      });
      softWarp(target, rect, center, faceW * 0.75, faceH * 0.8, 1.35, 1.55);
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
      drawMegaSmile(target, rect, box, expr, faceW, faceH);

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

    function drawFilter(target, rect, box, id, expr, now) {
      if (id === 'none') return undefined;
      const faceW = Math.max(1, Math.abs(box.right - box.left) * rect.w);
      const faceH = Math.max(1, Math.abs(box.bottom - box.top) * rect.h);
      const faceExpr = expr || ZERO_EXPR;
      if (id === 'smile') return drawMegaSmile(target, rect, box, faceExpr, faceW, faceH);
      if (id === 'big') return drawBigEyes(target, rect, box, faceW, faceH);
      if (id === 'balloon') return drawBalloon(target, rect, box, faceW, faceH);
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
