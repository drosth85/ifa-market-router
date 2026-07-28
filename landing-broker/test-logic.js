/* Static + data test — no dependencies, no browser.  Run: node test-logic.js
   Guards the business taxonomy, the files behind each deck, and the copy discipline
   (booth-wall grammar). The interaction itself is covered by test-flow.js. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const appSrc = fs.readFileSync(path.join(DIR, 'assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(DIR, 'assets/style.css'), 'utf8');

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fail++; };

// --- read the data out of app.js (no DOM needed) --------------------------
const sandbox = { document: {addEventListener(){}}, window: {}, console };
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox);
const SIDES = vm.runInContext('SIDES', sandbox);
const OFFERS = vm.runInContext('OFFERS', sandbox);

// --- taxonomy: the business, not the documents ----------------------------
ok(SIDES.length === 2 && SIDES[0].key === 'buy' && SIDES[1].key === 'sell',
   'two sides: wholesale (you buy from us) and retail (we sell yours)');
ok(JSON.stringify(SIDES[0].offers.map(o => o.slug).sort()) === JSON.stringify(['hurt-mobilki','hurt-monstelo']),
   'wholesale = Monstelo electronics + Mobilki phones');
ok(JSON.stringify(SIDES[1].offers.map(o => o.slug).sort()) === JSON.stringify(['brand','hub']),
   'retail = Monstelo hub + Monstelo brand management');
ok(SIDES[0].offers.some(o => o.owner === 'Mobilki GSM'), 'phone wholesale is credited to Mobilki GSM');
ok(SIDES[1].offers.every(o => o.owner === 'Monstelo'), 'both retail offers are Monstelo');

// --- files behind the decks ----------------------------------------------
OFFERS.forEach(o => {
  ok(fs.existsSync(path.join(DIR, o.file)), `PDF exists: ${o.file}`);
  ok(fs.existsSync(path.join(DIR, o.cover)), `cover exists: ${o.cover}`);
});
const onDisk = fs.readdirSync(path.join(DIR, 'offers')).filter(f => f.endsWith('.pdf')).map(f => 'offers/' + f);
ok(onDisk.every(f => OFFERS.some(o => o.file === f)), 'no orphaned PDF in offers/');

// --- copy discipline: booth-wall grammar ----------------------------------
ok(OFFERS.every(o => o.label && o.payoff && o.cta && o.deck && o.meta),
   'every offer is label + one payoff line + CTA');
ok(OFFERS.every(o => o.payoff.split(/\s+/).length <= 9),
   'no payoff longer than 9 words — walls do not do paragraphs');
const body = (html.match(/<main>([\s\S]*)<\/main>/) || ['',''])[1];
ok((body.match(/<p[^>]*>[^<]{190,}/g) || []).length === 0, 'no paragraph over ~190 chars in <main>');
ok(!/From EAN to Europe/i.test(html), 'no leftover KIERUNEK A copy on the page');
ok(!/top-rated seller/i.test(html), 'no unvalidated "top-rated seller" claim');

// --- lead capture wiring (markup level; behaviour is in test-flow.js) -----
ok(/name="offer"/.test(appSrc) && /source: "deck"/.test(appSrc), 'deck lead carries offer + source');
ok(/source: "deck-contact"/.test(appSrc), 'modal enrichment is tagged separately');
ok(/value="enquiry"/.test(html), 'bottom form is tagged as a general enquiry');
ok(!/id="offer-input"/.test(html) && !/id="offer-picker"/.test(html),
   'the old deck picker is gone — decks are chosen at the row');
ok(/aria-controls="drawer-/.test(appSrc) && /aria-expanded/.test(appSrc), 'deck button is wired to its drawer');
ok(/role="dialog"/.test(html) && /aria-modal="true"/.test(html), 'modal is a real dialog for screen readers');
ok((html.match(/id="modal-(name|phone|company)"/g) || []).length === 3,
   'modal asks exactly for name, phone and company');
ok(!/id="modal-form"[\s\S]{0,600}required/.test(html), 'nothing in the modal is required');
ok(/<textarea/.test(html), 'enquiry form has a message field');
ok(/method="POST"/.test(appSrc), 'drawer forms degrade to a plain POST without JS');
ok(/do not sell or share/i.test(html), 'consent/privacy microcopy present');
ok(/within a minute/i.test(appSrc), 'drawer promises the one-minute delivery');

// --- quality floor --------------------------------------------------------
ok(/prefers-reduced-motion/.test(css), 'reduced motion respected');
ok(/:focus-visible/.test(css), 'visible keyboard focus');
ok(/\.sr-only/.test(css) && /class="sr-only"/.test(appSrc), 'the drawer input has a label for screen readers');
ok(/Escape/.test(appSrc), 'Esc closes the modal');
ok(/id="sticky"/.test(html) && /\.sticky\b/.test(css), 'sticky mobile CTA present');
ok(/not live yet/i.test(html), 'facts line admits what is not live');

console.log(fail ? `\n${fail} FAILED` : `\nALL PASSED`);
process.exit(fail ? 1 : 0);
