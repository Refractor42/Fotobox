// One-shot: replace hardcoded accent/state colours with the palette tokens.
const fs = require('fs');

const pairs = [
  ['rgba(255 215 0 / ', 'rgb(var(--c-accent-rgb) / '],
  ['rgba(255, 215, 0, ', 'rgb(var(--c-accent-rgb) / '],
  ['#ffd700', 'var(--c-accent)'],
  ['#e6c200', 'var(--c-accent-dark)'],
  ['rgba(250, 204, 21, ', 'rgb(var(--c-highlight-rgb) / '],
  ['#facc15', 'var(--c-highlight)'],
  ['rgba(234, 179, 8, ', 'rgb(var(--c-highlight-edge-rgb) / '],
  ['#eab308', 'var(--c-highlight-edge)'],
  ['rgba(220, 38, 38, ', 'rgb(var(--c-danger-rgb) / '],
  ['#dc2626', 'var(--c-danger)'],
  ['#b91c1c', 'var(--c-danger-dark)'],
  ['rgba(34, 197, 94, ', 'rgb(var(--c-success-rgb) / '],
  ['#22c55e', 'var(--c-success)'],
  ['#ff5a36', 'var(--c-alert)'],
  ['rgba(255, 74, 60, ', 'rgb(var(--c-alert-rgb) / '],
  ['#ff6b5e', 'var(--c-alert-text)'],
  ['#ffb4ad', 'var(--c-alert-soft)'],
  ['rgba(249, 115, 22, 0.13)', 'rgb(var(--c-alert-rgb) / 0.13)']
];

for (const file of ['style.css', 'kiosk.css']) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let changed = 0;
  const out = lines.map((line) => {
    if (/^\s*--[a-z0-9-]+\s*:/i.test(line)) return line; // keep token definitions
    let next = line;
    for (const [from, to] of pairs) next = next.split(from).join(to);
    if (next !== line) changed++;
    return next;
  });
  fs.writeFileSync(file, out.join('\n'));
  console.log(file + ': ' + changed + ' lines updated');
}
