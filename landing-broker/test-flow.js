/* Flow test — drives the real page in Chrome headless with fetch() stubbed.
   Run: node test-flow.js      (needs Google Chrome; see README)
   Covers: drawer open/close, e-mail -> lead POST -> download unlocked -> optional-contact modal,
   modal send vs "No thanks", and the bottom enquiry form. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HARNESS = path.join(DIR, '_flow-harness.html');

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fail++; };

const script = `
<script>
window.__posts = [];
window.fetch = (url, opts) => {
  const o = {__url: url};
  if (opts && opts.body && opts.body.entries) for (const [k, v] of opts.body.entries()) o[k] = v;
  window.__posts.push(o);
  return Promise.resolve({ok: true});
};
const fire = el => el.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
const wait = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener('load', async () => {
  const R = {};
  const drawer = s => document.getElementById('drawer-' + s);
  const btn = s => document.querySelector('.btn[data-offer="' + s + '"]');

  R.closedInitially = drawer('hurt-mobilki').hidden === true;
  btn('hurt-mobilki').click();
  R.opensOnClick = drawer('hurt-mobilki').hidden === false;
  R.ariaExpanded = btn('hurt-mobilki').getAttribute('aria-expanded');
  R.focusedInput = false;
  await wait(120);
  R.focusedInput = document.activeElement === document.getElementById('mail-hurt-mobilki');

  btn('hub').click();
  R.onlyOneOpen = drawer('hurt-mobilki').hidden === true && drawer('hub').hidden === false;
  btn('hub').click();
  R.togglesClosed = drawer('hub').hidden === true;

  btn('hurt-mobilki').click();
  document.getElementById('mail-hurt-mobilki').value = 'ola@shop.de';
  fire(document.querySelector('#drawer-hurt-mobilki .drawer-form'));
  await wait(80);
  R.leadPost = window.__posts[0] || null;
  R.doneHtml = document.querySelector('#drawer-hurt-mobilki .drawer-done').innerHTML;
  R.formHiddenAfterSend = document.querySelector('#drawer-hurt-mobilki .drawer-form').hidden === true;
  R.modalOpen = document.getElementById('modal').hidden === false;
  R.modalRequired = document.querySelectorAll('#modal-form [required]').length;
  R.modalPrefill = document.getElementById('modal-offer').value + '|' + document.getElementById('modal-email').value;

  document.getElementById('modal-name').value = 'Ola K.';
  document.getElementById('modal-phone').value = '+49 170 000';
  fire(document.getElementById('modal-form'));
  await wait(80);
  R.contactPost = window.__posts[1] || null;
  R.modalClosedAfterSend = document.getElementById('modal').hidden === true;
  R.postCountAfterContact = window.__posts.length;

  // second deck, then decline the modal -> no extra POST
  btn('brand').click();
  document.getElementById('mail-brand').value = 'anna@brand.it';
  fire(document.querySelector('#drawer-brand .drawer-form'));
  await wait(80);
  const before = window.__posts.length;
  document.querySelector('#modal .btn-ghost[data-modal-close]').click();
  await wait(40);
  R.declineSendsNothing = window.__posts.length === before;
  R.modalClosedAfterDecline = document.getElementById('modal').hidden === true;
  R.bothDrawersStayDone =
    document.querySelector('#drawer-hurt-mobilki .drawer-done').hidden === false &&
    document.querySelector('#drawer-brand .drawer-done').hidden === false;

  // bottom form: general enquiry
  document.getElementById('enq-email').value = 'buyer@chain.fr';
  document.getElementById('enq-msg').value = 'Do you have iPhone 13 grade A?';
  fire(document.getElementById('enquiry-form'));
  await wait(80);
  R.enquiryPost = window.__posts[window.__posts.length - 1] || null;
  R.enquiryDone = document.getElementById('enquiry-done').hidden === false;

  document.title = 'RESULT:' + JSON.stringify(R);
});
</script>`;

const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8').replace('</body>', script + '</body>');
fs.writeFileSync(HARNESS, html);

let dom = '';
try{
  dom = execFileSync(CHROME, ['--headless=new','--disable-gpu','--virtual-time-budget=4000',
    '--dump-dom', 'file://' + HARNESS], {encoding: 'utf8', stdio: ['ignore','pipe','ignore']});
}finally{
  fs.unlinkSync(HARNESS);
}

const m = dom.match(/<title>RESULT:(\{.*?\})<\/title>/s);
if(!m){ console.log('FAIL harness did not report — the page threw before finishing'); process.exit(1); }
const R = JSON.parse(m[1]);

ok(R.closedInitially, 'drawer is closed until the deck button is pressed');
ok(R.opensOnClick, 'deck button opens the drawer under it');
ok(R.ariaExpanded === 'true', 'button reports aria-expanded=true when open');
ok(R.focusedInput, 'the e-mail field takes focus — no extra tap on mobile');
ok(R.onlyOneOpen, 'opening another deck closes the previous drawer');
ok(R.togglesClosed, 'pressing the same button again closes the drawer');

ok(R.leadPost && R.leadPost.email === 'ola@shop.de', 'e-mail is posted as the lead');
ok(R.leadPost && R.leadPost.offer === 'hurt-mobilki', 'lead carries the deck that was asked for');
ok(R.leadPost && R.leadPost.source === 'deck', 'lead is tagged source=deck');
ok(/katalog-mobilki\.pdf/.test(R.doneHtml), 'download of the right deck appears in the drawer');
ok(/ola@shop\.de/.test(R.doneHtml), 'drawer confirms where it was sent');
ok(R.formHiddenAfterSend, 'the e-mail field gives way to the confirmation');

ok(R.modalOpen, 'optional-contact modal opens after the deck is on its way');
ok(R.modalRequired === 0, 'no field in the modal is required');
ok(R.modalPrefill === 'hurt-mobilki|ola@shop.de', 'modal carries the deck and the e-mail already given');
ok(R.contactPost && R.contactPost.name === 'Ola K.' && R.contactPost.phone === '+49 170 000',
   'modal posts the optional details');
ok(R.contactPost && R.contactPost.source === 'deck-contact', 'enrichment is tagged source=deck-contact');
ok(R.contactPost && R.contactPost.email === 'ola@shop.de', 'enrichment is joined to the same e-mail');
ok(R.modalClosedAfterSend, 'modal closes after sending');
ok(R.postCountAfterContact === 2, 'exactly two posts for one deck: lead, then enrichment');

ok(R.declineSendsNothing, '"No thanks" sends nothing extra');
ok(R.modalClosedAfterDecline, '"No thanks" closes the modal');
ok(R.bothDrawersStayDone, 'a finished drawer keeps its download visible');

ok(R.enquiryPost && R.enquiryPost.source === 'enquiry', 'bottom form posts as a general enquiry');
ok(R.enquiryPost && R.enquiryPost.message === 'Do you have iPhone 13 grade A?', 'enquiry carries the question');
ok(R.enquiryPost && !R.enquiryPost.offer, 'enquiry is not tied to any deck');
ok(R.enquiryDone, 'enquiry shows a confirmation');

console.log(fail ? `\n${fail} FAILED` : `\nALL PASSED`);
process.exit(fail ? 1 : 0);
