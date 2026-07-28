/* IFA 2026 lead-gen landing — Monstelo × mobilki gsm.pl
   Voice: KIERUNEK B, booth-wall grammar — BIG LABEL + one line. No paragraphs.
   Single dependency on the form service: FORM_ENDPOINT below.

   Taxonomy (the business, not the documents):
     WHOLESALE — you buy from us:  Monstelo (electronics) · Mobilki GSM (phones)
     RETAIL    — we sell yours:    Monstelo hub · Monstelo brand management

   Lead capture, in the order the visitor meets it:
     1. deck button -> drawer with one e-mail field   -> POST (source=deck)   -> download unlocked
     2. modal, optional name/phone/company            -> POST (source=deck-contact)
     3. bottom form, general enquiry                  -> POST (source=enquiry)
   Every POST goes to FORM_ENDPOINT; the service dedupes on e-mail. */

const FORM_ENDPOINT = "[[FORM_ENDPOINT]]"; // podmienić po wyborze usługi (Tally/Formspree/Brevo)

// square send button icons: arrow to send, spinner while sending
const IC_ARROW = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h12M12 6l6 6-6 6"/></svg>`;
const IC_SPIN  = `<svg class="spin" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>`;

const SIDES = [
  {
    key: "buy",
    label: "You buy from us",
    offers: [
      {
        slug: "hurt-monstelo",
        owner: "Monstelo",
        label: "Wholesale · Electronics",
        payoff: "we offer stock with best buybox prices",
        cta: "Get the catalog",
        deck: "Electronics wholesale catalog",
        file: "offers/katalog-monstelo.pdf",
        cover: "assets/covers/katalog-monstelo.jpg",
        meta: "PDF · 6 pages",
      },
      {
        slug: "hurt-mobilki",
        owner: "Mobilki GSM",
        label: "Wholesale · Phones",
        payoff: "new & refurbished, graded A+ to C, warranted",
        cta: "Get the phone list",
        deck: "Phone wholesale catalog",
        file: "offers/katalog-mobilki.pdf",
        cover: "assets/covers/katalog-mobilki.jpg",
        meta: "PDF · 6 pages",
      },
    ],
  },
  {
    key: "sell",
    label: "You sell to us",
    offers: [
      {
        slug: "surplus",
        owner: "Monstelo × Mobilki GSM",
        label: "Sell us your overstock",
        payoff: "overstock, clearance, returns & open-box — data-priced, paid fast",
        cta: "Tell us what you have",
        contact: true,   // broker intake — no PDF, routes to the enquiry form
      },
    ],
  },
];

// secondary services, kept off the broker front — linked quietly at the bottom
const ALSO = [
  { label: "Logistics hub", file: "offers/ulotka-hub-logistyczny.pdf" },
  { label: "Brand management", file: "offers/ulotka-obsluga-marki.pdf" },
];

const OFFERS = SIDES.flatMap(s => s.offers.map(o => ({...o, side: s.key})));
const byId = id => document.getElementById(id);
const offerBySlug = slug => OFFERS.find(o => o.slug === slug);
const prefersReducedMotion = () =>
  !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

function post(fields){
  const data = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if(v) data.append(k, v); });
  return fetch(FORM_ENDPOINT, {method:"POST", body:data, headers:{Accept:"application/json"}});
}

/* ---------- render ---------- */

function offerRow(o){
  if(o.contact){
    return `
    <article class="offer offer-contact" id="offer-${o.slug}">
      <div class="offer-cover offer-cover-ph">SURPLUS<br>INTAKE</div>
      <div class="offer-body">
        <span class="offer-owner">${o.owner}</span>
        <h3 class="offer-label">${o.label}</h3>
        <p class="offer-payoff">${o.payoff}</p>
      </div>
      <div class="offer-act">
        <a class="btn btn-primary" href="#contact">${o.cta}</a>
        <span class="offer-meta">we reply within a day</span>
      </div>
    </article>`;
  }
  return `
    <article class="offer" id="offer-${o.slug}">
      <div class="offer-cover">
        <img src="${o.cover}" alt="Cover of the ${o.deck}" loading="lazy" width="620" height="878">
      </div>
      <div class="offer-body">
        <span class="offer-owner">${o.owner}</span>
        <h3 class="offer-label">${o.label}</h3>
        <p class="offer-payoff">${o.payoff}</p>
      </div>
      <div class="offer-act">
        <button class="btn btn-primary" data-offer="${o.slug}" aria-expanded="false"
                aria-controls="drawer-${o.slug}">${o.cta}</button>
        <span class="offer-meta">${o.meta}</span>

        <div class="drawer" id="drawer-${o.slug}" hidden>
          <form class="drawer-form" method="POST" action="" data-slug="${o.slug}">
            <input type="hidden" name="offer" value="${o.slug}">
            <input type="hidden" name="source" value="deck">
            <label class="sr-only" for="mail-${o.slug}">Work e-mail</label>
            <div class="drawer-row">
              <input type="email" id="mail-${o.slug}" name="email" required
                     placeholder="you@company.com" autocomplete="email" inputmode="email">
              <button type="submit" class="btn btn-primary drawer-send" aria-label="Send e-mail">${IC_ARROW}</button>
            </div>
            <p class="drawer-note">In your inbox within a minute.</p>
          </form>
          <div class="drawer-done" hidden></div>
        </div>
      </div>
    </article>`;
}

function renderSides(){
  byId("offer-list").innerHTML = SIDES.map(s => `
    <div class="side side-${s.key}">
      <p class="side-label">${s.label}</p>
      ${s.offers.map(offerRow).join("")}
    </div>`).join("");
}

function renderAlso(){
  const el = byId("also-list");
  if(!el) return;
  el.innerHTML = ALSO.map(a =>
    `<a class="also-link" href="${a.file}" download>${a.label} deck →</a>`).join("");
}

/* ---------- drawer ---------- */

function closeAllDrawers(exceptSlug){
  OFFERS.forEach(o => {
    if(o.slug === exceptSlug) return;
    const d = byId(`drawer-${o.slug}`);
    const b = document.querySelector(`.btn[data-offer="${o.slug}"]`);
    if(d && !d.querySelector(".drawer-done").hidden) return; // keep finished ones open
    if(d) d.hidden = true;
    if(b) b.setAttribute("aria-expanded", "false");
  });
}

function toggleDrawer(slug){
  const drawer = byId(`drawer-${slug}`);
  const btn = document.querySelector(`.btn[data-offer="${slug}"]`);
  if(!drawer) return;
  const open = drawer.hidden;
  closeAllDrawers(slug);
  drawer.hidden = !open;
  if(btn) btn.setAttribute("aria-expanded", String(open));
  if(open){
    const f = drawer.querySelector(".drawer-form");
    if(f && !f.hidden){ f.style.animation = "none"; void f.offsetHeight; f.style.animation = ""; }
    const input = byId(`mail-${slug}`);
    if(input && !input.disabled) setTimeout(() => input.focus({preventScroll:true}), 60);
  }
}

function drawerDone(slug, email, failed){
  const o = offerBySlug(slug);
  const drawer = byId(`drawer-${slug}`);
  drawer.querySelector(".drawer-form").hidden = true;
  const done = drawer.querySelector(".drawer-done");
  done.innerHTML = `
    <p class="done-line">${failed ? "Mail service unreachable — take it here." : `On its way to ${email}.`}</p>
    <a class="btn btn-download" href="${o.file}" download>Download now</a>`;
  done.hidden = false;
}

/* ---------- modal: optional contact ---------- */

let modalReturnFocus = null;

function openModal(slug, email){
  const m = byId("modal");
  byId("modal-offer").value = slug;
  byId("modal-email").value = email;
  byId("modal-title").textContent = "Leave your contact?";
  m.hidden = false;
  document.body.classList.add("locked");
  modalReturnFocus = document.querySelector(`.btn[data-offer="${slug}"]`);
  setTimeout(() => byId("modal-name").focus({preventScroll:true}), 60);
}

function closeModal(){
  byId("modal").hidden = true;
  document.body.classList.remove("locked");
  if(modalReturnFocus) modalReturnFocus.focus({preventScroll:true});
}

/* ---------- wiring ---------- */

document.addEventListener("DOMContentLoaded", () => {
  renderSides();
  renderAlso();

  // deck button -> drawer
  document.addEventListener("click", e => {
    const btn = e.target.closest(".btn[data-offer]");
    if(btn){ toggleDrawer(btn.getAttribute("data-offer")); return; }
    if(e.target.closest("[data-modal-close]")){ closeModal(); }
  });

  // drawer: e-mail -> lead + download + optional-contact modal
  document.addEventListener("submit", async e => {
    const form = e.target.closest(".drawer-form");
    if(!form) return;
    e.preventDefault();
    const slug = form.getAttribute("data-slug");
    const email = form.querySelector("input[name=email]").value.trim();
    const send = form.querySelector(".drawer-send");
    send.disabled = true;
    send.innerHTML = IC_SPIN;
    let failed = false;
    try{
      const res = await post({offer: slug, source: "deck", email});
      failed = !res.ok;
    }catch(err){
      failed = true; // soft gate: the download never depends on the lead POST
    }
    drawerDone(slug, email, failed);
    openModal(slug, email);
  });

  // modal: optional details
  byId("modal-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = byId("modal-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try{
      await post({
        offer: byId("modal-offer").value,
        source: "deck-contact",
        email: byId("modal-email").value,
        name: byId("modal-name").value.trim(),
        phone: byId("modal-phone").value.trim(),
        company: byId("modal-company").value.trim(),
      });
    }catch(err){ /* nothing to recover: the lead is already in */ }
    btn.disabled = false;
    btn.textContent = "Send";
    closeModal();
  });

  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && !byId("modal").hidden) closeModal();
  });

  // bottom form: general enquiry, no deck attached
  byId("enquiry-form").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    const btn = byId("enquiry-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    let failed = false;
    try{
      const res = await fetch(FORM_ENDPOINT, {method:"POST", body:new FormData(form),
        headers:{Accept:"application/json"}});
      failed = !res.ok;
    }catch(err){ failed = true; }
    byId("enquiry-done").innerHTML = failed
      ? `<p class="err">Mail service unreachable — nothing was sent. Write to us at [[CONTACT]] or come to H27E-17.</p>`
      : `<p class="done-line">Got it. We answer within one working day — or find us at <b>H27E-17</b>.</p>`;
    byId("enquiry-done").hidden = false;
    if(!failed) form.hidden = true;
    btn.disabled = false;
    btn.textContent = "Send";
  });

  // design switch v1 (ciemny) / v2 (jasny) — do porównania, zapamiętywany
  const themeBtn = byId("theme");
  const themeLabel = () => {
    themeBtn.textContent = document.documentElement.getAttribute("data-theme") === "light"
      ? "design v2 · jasny" : "design v1 · ciemny";
  };
  themeLabel();
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try{ localStorage.setItem("ifa-design", next); }catch(e){}
    themeLabel();
  });

  // sticky bar steps aside once the enquiry form is on screen
  const bar = byId("sticky");
  if("IntersectionObserver" in window){
    new IntersectionObserver(([entry]) => {
      bar.classList.toggle("off", entry.isIntersecting);
    }, {rootMargin: "-40% 0px 0px 0px"}).observe(byId("contact"));
  }
});
