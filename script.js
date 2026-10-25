/* ============================================================
   SnapBox — Photobox Interaction Logic
   ============================================================ */

const gsap = window.gsap;
const { timeline } = gsap;

// --- DOM references ---
const $splash        = document.getElementById('splash');
const $camera        = document.getElementById('camera');
const $gallery       = document.getElementById('gallery');
const $countdown     = document.getElementById('countdown');
const $flash         = document.getElementById('flash');
const $captureBtn    = document.getElementById('captureBtn');
const $processing    = document.getElementById('processing');
const $processingFill = document.getElementById('processingFill');
const $placeholder   = $camera.querySelector('.camera__placeholder');
const $viewfinderFrame = $camera.querySelector('.viewfinder__frame');
const $corners       = $camera.querySelectorAll('.viewfinder__corner');
const $galleryGrid   = document.getElementById('galleryGrid');
const $galleryEmpty  = document.getElementById('galleryEmpty');
const $video         = document.getElementById('cameraVideo');
const $permission    = document.getElementById('permission');
const $galleryBadge  = document.getElementById('galleryBadge');
const $discardBtn    = document.getElementById('discardBtn');
const $galleryBtn    = document.getElementById('galleryBtn');

const photos = [];

// --- State ---
let currentState = 'splash';
let hasPhoto = false;
let photoCount = 0;
let videoPlaying = false;
let viewfinderVisible = false;
let isCapturing = false;

// ============================================================
//  CAMERA ACCESS
// ============================================================
let stream = null;

async function initCamera() {
  $permission.classList.remove('visible');

  // already have a stream (returning from gallery or re-entering)
  if (stream) {
    videoPlaying = true;
    $video.classList.add('has-source');
    if (!$video.srcObject) {
      $video.srcObject = stream;
    }
    $video.style.transform = 'scaleX(-1)';
    $video.play().catch((e) => console.warn('video.play() failed:', e)); // resume playback
    gsap.set($placeholder, { opacity: 0 });
    showViewfinder();
    return true;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    $video.srcObject = stream;
    $video.classList.add('has-source');

    // once video can play, hide placeholder and show viewfinder
    $video.onplaying = () => {
      videoPlaying = true;
      gsap.to($placeholder, { opacity: 0, duration: 0.3 });
      showViewfinder();
    };

    // mirror the video for a natural selfie feel
    $video.style.transform = 'scaleX(-1)';

    return true;
  } catch (err) {
    console.warn('Camera access denied:', err.message);
    showPermissionPrompt();
    return false;
  }
}

function showPermissionPrompt() {
  $permission.classList.add('visible');
  gsap.from('.permission__content > *', {
    y: 20, opacity: 0, stagger: 0.1,
    duration: 0.5, ease: 'power2.out'
  });
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

// ============================================================
//  PHOTO CAPTURE (video frame snapshot)
// ============================================================
function captureFromVideo() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const w = $video.videoWidth;
    const h = $video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // mirror to match the displayed (flipped) video
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage($video, -w, 0, w, h);
    ctx.restore();

    resolve(canvas.toDataURL('image/jpeg', 0.92));
  });
}

// ============================================================
//  ANIMATIONS: Splash reveal
// ============================================================
function animateSplashIn() {
  const tl = timeline();
  tl.to($splash, { display: 'flex', opacity: 1, duration: 0.01 })
    .from('.splash__title', { y: 40, opacity: 0, duration: 1.1, ease: 'elastic.out(1, 0.6)' }, 0.3)
    .from('.splash__subtitle', { y: 20, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.45)
    .from('.splash__cta', { y: 30, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.55);
}

// ============================================================
//  ANIMATIONS: Camera enter
// ============================================================
function animateCameraIn() {
  const tl = timeline({ onStart: () => { $camera.style.display = 'block'; } });
  tl.to($camera, { opacity: 1, duration: 0.01 })
    .from($camera.querySelector('.camera__stage'), {
      y: 60, opacity: 0, duration: 0.9, ease: 'power3.out'
    }, 0)
    .from('.camera__controls > *', {
      y: 40, opacity: 0, stagger: 0.12, duration: 0.7, ease: 'power2.out'
    }, 0.3)
    .from($placeholder, { opacity: 0, duration: 0.5 }, 0.7);

  // if video already playing (camera was fast), hide placeholder
  if (videoPlaying) {
    gsap.set($placeholder, { opacity: 0 });
  }
  showViewfinder();
}

function showViewfinder() {
  if (viewfinderVisible) return;
  viewfinderVisible = true;
  const tl = timeline();
  tl.to([...$corners, $viewfinderFrame], {
    opacity: 1, scale: [0, 1], duration: 0.6,
    ease: 'back.out(1.4)', stagger: 0.1
  });
}

function hideViewfinder() {
  viewfinderVisible = false;
  return gsap.to([...$corners, $viewfinderFrame], {
    opacity: 0, duration: 0.35, ease: 'power2.in', stagger: 0.05
  });
}

// ============================================================
//  CAPTURE SEQUENCE
// ============================================================
async function runCaptureSequence() {
  if (currentState !== 'camera') return;
  if (isCapturing) return;
  if (!stream || !$video.srcObject) {
    showPermissionPrompt();
    return;
  }
  isCapturing = true;
  $captureBtn.disabled = true;

  // unlock / resume audio while we still have the user gesture
  unlockAudio();

  try {
    // 1. countdown with tick sounds
    await runCountdown();

    // 2. hide viewfinder + placeholder
    await hideViewfinder();
    gsap.to($placeholder, { opacity: 0, duration: 0.2, ease: 'power2.in' });

    // 3. flash + shutter sound
    playShutterSound();
    gsap.to($flash, { opacity: 1, duration: 0.01 });
    gsap.fromTo($flash, { opacity: 1 }, {
      opacity: 0, duration: 0.35, ease: 'power2.out', delay: 0.02
    });

    // 4. process photo
    showProcessing();
    await new Promise((r) => setTimeout(r, 200));
    $video.pause();
    const photoUrl = await captureFromVideo();

    // 5. reveal photo in stage
    await showCaptureResult(photoUrl);

    // 6. add to gallery
    addToGallery(photoUrl);
  } finally {
    isCapturing = false;
    $captureBtn.disabled = false;
    currentState = 'camera';
  }
}

function runCountdown() {
  return new Promise((resolve) => {
    let count = 3;
    const STEP_MS = 900;

    gsap.killTweensOf($countdown);
    $countdown.style.opacity = '1';

    const showTick = () => {
      $countdown.textContent = String(count);
      playCountdownTick(count === 1);

      gsap.fromTo(
        $countdown,
        { scale: 0.35, opacity: 0, y: 0 },
        { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.2)' }
      );

      // Fade the digit out near the end of the step, but keep the timing
      // logic independent of GSAP so a throttled tab can't stall the capture.
      setTimeout(() => {
        gsap.to($countdown, {
          scale: 0.8,
          opacity: 0,
          duration: 0.22,
          ease: 'power2.in'
        });
      }, STEP_MS - 220);

      setTimeout(() => {
        count--;
        if (count >= 1) {
          showTick();
        } else {
          gsap.set($countdown, { opacity: 0 });
          resolve();
        }
      }, STEP_MS);
    };

    showTick();
  });
}

function showProcessing() {
  gsap.to($processing, { opacity: 1, duration: 0.4, pointerEvents: 'none' });
  $processingFill.style.transition = 'width 0.8s ease';
  $processingFill.style.width = '100%';
}

async function showCaptureResult(photoUrl) {
  gsap.to($placeholder, { opacity: 0, duration: 0.001 });

  const img = document.createElement('img');
  img.src = photoUrl;
  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 0;
    border-radius: 0; filter: grayscale(100%) contrast(1.1);
  `;
  $camera.querySelector('.viewfinder').appendChild(img);

  const tl = timeline({ defaults: { ease: 'power2.out' } });
  await tl.to($flash, { opacity: 0.9, duration: 0.01 })
    .to($flash, { opacity: 0, duration: 0.3 }, '+=0.05');

  gsap.to(img, { opacity: 1, duration: 0.5 });
  await gsap.to(img, {
    filter: 'grayscale(0%) contrast(1)', duration: 0.7, delay: 0.2
  });

  gsap.to($processing, { opacity: 0, duration: 0.3, delay: 0.5 });
  $processingFill.style.width = '0%';
  $processingFill.style.transition = 'none';

  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 1; border-radius: 0;
    filter: grayscale(0%) contrast(1);
  `;
  // enable discard button — a photo is now shown in the stage
  hasPhoto = true;
  $discardBtn.classList.add('active');
  return new Promise((r) => setTimeout(r, 300));
}

function resetCameraView() {
  const existingImg = $camera.querySelector('.viewfinder img');
  if (existingImg) existingImg.remove();

  gsap.set($processing, { opacity: 0 });
  gsap.set($flash, { opacity: 0 });
  gsap.killTweensOf($countdown);
  gsap.set($countdown, { scale: 1, opacity: 0 });
  $countdown.style.opacity = '0';

  // disable discard — no photo shown anymore
  hasPhoto = false;
  $discardBtn.classList.remove('active');

  // if video is active, hide placeholder; otherwise show it
  if (stream) {
    gsap.set($placeholder, { opacity: 0 });
    $video.play().catch((e) => console.warn('video.play() failed:', e)); // resume if paused/hidden
  } else {
    gsap.to($placeholder, { opacity: 1, duration: 0.3, ease: 'power2.out' });
  }

  // reset viewfinder guard so corners can re-animate
  viewfinderVisible = false;
  showViewfinder();
}


// ============================================================
//  GALLERY MANAGEMENT
// ============================================================
let lightbox = null;
// Saves a photo in the database through the server. Failure is logged only,
// so the photo still shows in the current session.
function savePhotoToServer(photoUrl) {
  return fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: photoUrl })
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
  }).catch((err) => console.warn('Photo could not be saved to database:', err));
}

// Loads all stored photos from the database when the page starts.
function loadPhotosFromServer() {
  return fetch('/api/photos', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((items) => items.forEach((item) => addToGallery(item.image, false)))
    .catch((err) => console.warn('Photos could not be loaded from database:', err));
}

function addToGallery(photoUrl, save = true) {
  if (save) savePhotoToServer(photoUrl);

  const card = document.createElement('div');
  card.className = 'gallery__card';

  const img = document.createElement('img');
  img.src = photoUrl;
  img.alt = 'Captured photo';
  img.loading = 'lazy';
  card.appendChild(img);

  $galleryGrid.appendChild(card);
  $galleryEmpty.style.display = 'none';

  // staggered entrance
  gsap.from(card, {
    y: 30, opacity: 0, scale: 0.85,
    duration: 0.6, ease: 'back.out(1.3)'
  });

  // lightbox on click
  card.addEventListener('click', () => openLightbox(photoUrl));
  photos.push(photoUrl);

  // update badge
  photoCount++;
  $galleryBadge.textContent = String(photoCount);
  $galleryBadge.classList.add('has-new');
  setTimeout(() => $galleryBadge.classList.remove('has-new'), 600);

  // success animation on gallery button
  gsap.from($galleryBtn, {
    scale: [1, 1.15, 1], duration: 0.5, ease: 'elastic.out(1, 0.6)'
  });
}

function openLightbox(photoUrl) {
  if (lightbox) lightbox.remove();

  lightbox = document.createElement('div');
  lightbox.className = 'lb';

  const img = document.createElement('img');
  img.src = photoUrl;
  img.alt = 'Photo preview';
  lightbox.appendChild(img);

  lightbox.addEventListener('click', () => {
    const tl = timeline({
      onComplete: () => { lightbox.remove(); lightbox = null; }
    });
    tl.to(img, { scale: 0.9, opacity: 0, duration: 0.3, ease: 'power2.in' })
      .to(lightbox, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 0);
  });

  document.body.appendChild(lightbox);
  gsap.set(lightbox, { opacity: 0 });
  gsap.to(lightbox, { opacity: 1, duration: 0.3, ease: 'power2.out' });
  gsap.from(img, { scale: 0.85, opacity: 0, duration: 0.4, ease: 'back.out(1.2)' });
}

// ============================================================
//  STATE NAVIGATION
// ============================================================
function goTo(sectionName) {
  const sections = { splash: $splash, camera: $camera, gallery: $gallery };
  const target = sections[sectionName];
  if (!target) return;

  // hide all non-target sections immediately
  Object.values(sections).forEach((s) => {
    if (s !== target) s.style.display = 'none';
  });

  // show target with a smooth fade-in
  target.style.display = 'block';
  target.style.opacity = '0';
  gsap.to(target, { opacity: 1, duration: 0.3, ease: 'power2.out' });

  currentState = sectionName;

  if (sectionName === 'camera') {
    // init camera + reset view after fade
    gsap.delayedCall(0.3, () => {
      initCamera();
      resetCameraView();
    });
  }
}

// ============================================================
//  SOUND
// ============================================================
// A single shared AudioContext is created lazily from a user gesture.
// Creating a new context per shot is unreliable and Chrome may leave it
// suspended, which is why the original shutter stayed silent.
let audioCtx = null;
let noiseBuffer = null;

// Real shutter recording (camera-shutter.mp3). It is fetched right away and
// decoded into the shared AudioContext on the first user gesture, so the
// recording is ready long before the capture button is pressed.
const SHUTTER_SRC = 'assets/audio/camera-shutter.mp3';
let shutterBytes = null;      // raw file data, fetched at load
let shutterBuffer = null;     // decoded AudioBuffer, ready for playback
let shutterLoadPromise = null;
let shutterDecodePromise = null;

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioCtx();
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function unlockAudio() {
  // Must be called from inside a click/keydown handler.
  const ctx = getAudioContext();
  if (ctx) prepareShutterSound(ctx);
}

// Fetch the recording once. Runs at page load, so the bytes are cached by the
// time the user presses "start".
function preloadShutterSound() {
  if (shutterLoadPromise) return shutterLoadPromise;
  shutterLoadPromise = fetch(SHUTTER_SRC)
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then((bytes) => {
      shutterBytes = bytes;
      return bytes;
    })
    .catch((err) => {
      console.warn('Shutter MP3 could not be loaded, using synthesized fallback:', err);
      return null;
    });
  return shutterLoadPromise;
}

// The recording starts with ~1.2 s of silence. Playing that untouched would
// put the click over a second after the flash, so cut the silence away while
// keeping a short pre/post roll for a natural attack and tail.
function trimSilence(buffer, ctx, threshold = 0.02, preRoll = 0.01, postRoll = 0.06) {
  const channels = buffer.numberOfChannels;
  const data = buffer.getChannelData(0);
  let first = -1;
  let last = -1;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > threshold) { first = i; break; }
  }
  for (let i = data.length - 1; i >= 0; i--) {
    if (Math.abs(data[i]) > threshold) { last = i; break; }
  }
  if (first < 0 || last <= first) return buffer;

  const rate = buffer.sampleRate;
  const startIdx = Math.max(0, first - Math.floor(preRoll * rate));
  const endIdx = Math.min(data.length, last + Math.floor(postRoll * rate));
  const length = endIdx - startIdx;
  if (length >= data.length) return buffer;

  const trimmed = ctx.createBuffer(channels, length, rate);
  for (let c = 0; c < channels; c++) {
    trimmed.copyToChannel(buffer.getChannelData(c).subarray(startIdx, endIdx), c);
  }
  return trimmed;
}

// Decoding needs an AudioContext, so this runs after the first gesture.
function prepareShutterSound(ctx) {
  if (shutterBuffer || !ctx) return Promise.resolve(shutterBuffer);
  if (shutterDecodePromise) return shutterDecodePromise;
  shutterDecodePromise = (async () => {
    try {
      const bytes = shutterBytes || (await preloadShutterSound());
      if (!bytes) return null;
      // decodeAudioData detaches its input, so hand it a copy.
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      shutterBuffer = trimSilence(decoded, ctx);
      return shutterBuffer;
    } catch (err) {
      console.warn('Shutter MP3 could not be decoded, using synthesized fallback:', err);
      return null;
    } finally {
      shutterDecodePromise = null;
    }
  })();
  return shutterDecodePromise;
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.2);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// One mechanical shutter strike: a bright noise snap, a short metallic
// ring from the mechanism and a low body thump. Layering those three gives
// the dry "ka-chak" of a real camera instead of a generic beep/thud.
function playShutterStrike(ctx, when, opts) {
  const {
    level,
    noiseFreq,
    q,
    decay,
    ringFreq,
    thumpFreq,
    thumpLevel,
    thumpDecay
  } = opts;

  // 1. broadband snap of the mirror/shutter blades
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = noiseFreq;
  band.Q.value = q;

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = noiseFreq * 0.5;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, when);
  noiseGain.gain.exponentialRampToValueAtTime(level, when + 0.0015);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  noise.connect(band).connect(high).connect(noiseGain).connect(ctx.destination);
  noise.start(when);
  noise.stop(when + decay + 0.02);

  // 2. tiny metallic ring — the spring/blade resonance that reads as "camera"
  const ring = ctx.createOscillator();
  const ringGain = ctx.createGain();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime(ringFreq, when);
  ring.frequency.exponentialRampToValueAtTime(ringFreq * 0.82, when + 0.028);
  ringGain.gain.setValueAtTime(0.0001, when);
  ringGain.gain.exponentialRampToValueAtTime(level * 0.22, when + 0.002);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  ring.connect(ringGain).connect(ctx.destination);
  ring.start(when);
  ring.stop(when + 0.035);

  // 3. body thump so the click has some weight
  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(thumpFreq, when);
  thump.frequency.exponentialRampToValueAtTime(thumpFreq * 0.55, when + thumpDecay);
  thumpGain.gain.setValueAtTime(0.0001, when);
  thumpGain.gain.exponentialRampToValueAtTime(thumpLevel, when + 0.003);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + thumpDecay);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(when);
  thump.stop(when + thumpDecay + 0.01);
}

// A DSLR shutter is two strikes: mirror up, then shutter close.
// Only used when the MP3 is unavailable (offline first run, decode error).
function playSynthShutter(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  // a tiny random gap keeps repeated shots from sounding machine-identical
  const gap = 0.075 + Math.random() * 0.01;
  try {
    // first strike: mirror swings up — heavier, more body
    playShutterStrike(ctx, now, {
      level: 0.85,
      noiseFreq: 2500,
      q: 0.9,
      decay: 0.045,
      ringFreq: 2300,
      thumpFreq: 220,
      thumpLevel: 0.26,
      thumpDecay: 0.06
    });
    // second strike: shutter closes — sharper, brighter snap
    playShutterStrike(ctx, now + gap, {
      level: 0.55,
      noiseFreq: 4200,
      q: 0.8,
      decay: 0.03,
      ringFreq: 3300,
      thumpFreq: 180,
      thumpLevel: 0.14,
      thumpDecay: 0.04
    });
  } catch (e) {
    /* audio not available */
  }
}

// Plays the recorded shutter. Returns true when the real MP3 was used, and
// falls back to the synthesized shutter so a shot is never silent.
function playShutterSound(ctx = getAudioContext()) {
  if (!ctx) return false;

  if (shutterBuffer) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = shutterBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(ctx.destination);
      src.start(ctx.currentTime + 0.005);
      return true;
    } catch (e) {
      /* fall through to the synth */
    }
  }

  // Not decoded yet (e.g. very first shot after a cold start): warm it up for
  // the next shot, and use the synth so this one is not silent.
  prepareShutterSound(ctx);
  playSynthShutter(ctx);
  return false;
}

function playCountdownTick(isFinal) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isFinal ? 1320 : 880, t);
    osc.frequency.exponentialRampToValueAtTime(isFinal ? 1760 : 1040, t + 0.09);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.21);
  } catch (e) {
    /* audio not available */
  }
}


// ============================================================
//  EVENT LISTENERS
// ============================================================
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => {
    const action = el.dataset.action;
    switch (action) {
      case 'start':
        unlockAudio(); // create the AudioContext inside the user gesture
        currentState = 'camera';
        initCamera(); // request camera immediately to preserve user-gesture context
        const tl = timeline();
        tl.to('.splash__content', {
          y: -30, opacity: 0, duration: 0.5, ease: 'power2.in'
        }).to($splash, {
          opacity: 0, duration: 0.01
        }, '+=0.2').add(() => {
          $splash.style.display = 'none';
          animateCameraIn();
        }, '+=0.3');
        break;
      case 'capture':
        runCaptureSequence();
        break;
      case 'gallery':
        if (currentState === 'camera') {
          const img = $camera.querySelector('.viewfinder img');
          if (img) img.remove();
          gsap.to($camera, {
            opacity: 0, duration: 0.3, ease: 'power2.in',
            onComplete: () => { $camera.style.display = 'none'; goTo('gallery'); }
          });
        }
        break;
      case 'back-camera':
        gsap.to($gallery, {
          opacity: 0, duration: 0.3, ease: 'power2.in',
          onComplete: () => { $gallery.style.display = 'none'; goTo('camera'); }
        });
        break;
      case 'back-drop':
        if (!hasPhoto) return;
        const capturedImg = $camera.querySelector('.viewfinder img');
        if (capturedImg) {
          gsap.to(capturedImg, {
            scale: 0.7, opacity: 0, duration: 0.35,
            ease: 'power2.in', rotation: -6,
            onComplete: resetCameraView
          });
        } else {
          resetCameraView();
        }
        break;
      case 'retry-camera':
        initCamera();
        break;
    }
  });
});



// ============================================================
//  INIT
// ============================================================
window.addEventListener('load', () => {
  animateSplashIn();
  loadPhotosFromServer();

  // Fetch the shutter recording up front; it is decoded on the first gesture.
  preloadShutterSound();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (currentState === 'camera' && (e.key === ' ' || e.key === 'Enter')) {
      unlockAudio(); // keyboard activation is a gesture too
      runCaptureSequence();
    }
    if (e.key === 'Escape') {
      if (lightbox) { lightbox.remove(); lightbox = null; }
      if (currentState === 'gallery') {
        gsap.to($gallery, {
          opacity: 0, duration: 0.3, ease: 'power2.in',
          onComplete: () => { $gallery.style.display = 'none'; goTo('camera'); }
        });
      }
    }
  });
});

// lightbox styles injected at runtime
const style = document.createElement('style');
style.textContent = `
  .lb {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.9);
    z-index: 9999;
  }
  .lb img {
    max-width: 90vw; max-height: 90vh;
    border-radius: var(--radius-sm);
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.8);
  }
`;
document.head.appendChild(style);

