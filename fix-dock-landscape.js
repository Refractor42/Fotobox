const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'style.css');
let content = fs.readFileSync(file, 'utf8');

// 1. Scope portrait base rules so they never leak into landscape mode
const portraitBaseRegex = /\/\* ============================================================\s*CAMERA DOCK \(PORTRAIT \/ DEFAULT BASE\)[\s\S]*?\/\* Admin button in gallery header \*\//;

const newPortraitBase = `/* ============================================================
   CAMERA DOCK (PORTRAIT / DEFAULT BASE)
   ============================================================ */
body:not(.orientation-landscape) .camera__dock {
  display: contents;
}
body:not(.orientation-landscape) .dock-group--timer {
  display: block;
  width: 100%;
}
body:not(.orientation-landscape) .dock-group--filters {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: 0 auto 0.9rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}
body:not(.orientation-landscape) .dock-caption { display: none; }
body:not(.orientation-landscape) .dock-divider { display: none; }
body:not(.orientation-landscape) .dock-group--lang { display: none; }
body:not(.orientation-landscape) .btn__capture-landscape { display: none; }
body:not(.orientation-landscape) .lang-switch__unit { display: flex; flex-direction: column; align-items: center; }
body:not(.orientation-landscape) .lang-switch__label { display: none; }

/* Admin button in gallery header */`;

content = content.replace(portraitBaseRegex, newPortraitBase);

// 2. Ensure landscape dock rules set explicit width: auto and flex: 0 0 auto
const landscapeDockRegex = /body\.orientation-landscape\s+\.dock-group--timer\s*\{[\s\S]*?body\.orientation-landscape\s+\.dock-group--lang\s*\{[\s\S]*?\}/;

const newLandscapeDock = `body.orientation-landscape .dock-group--timer {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: auto;
  flex: 0 0 auto;
}

body.orientation-landscape .dock-group--timer .timer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

body.orientation-landscape .dock-group--filters {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: auto;
  max-width: 480px;
  min-width: 0;
  flex: 0 1 auto;
  margin: 0;
  overflow: hidden;
}

body.orientation-landscape #filterBar {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0;
  padding: 2px 4px;
  max-width: 480px;
  width: 100%;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
}

body.orientation-landscape #filterBar::-webkit-scrollbar {
  display: none;
}

body.orientation-landscape .dock-group--lang {
  display: flex;
  align-items: center;
  width: auto;
  flex: 0 0 auto;
}`;

content = content.replace(landscapeDockRegex, newLandscapeDock);

fs.writeFileSync(file, content, 'utf8');
console.log('style.css updated cleanly to fix landscape dock layout!');
