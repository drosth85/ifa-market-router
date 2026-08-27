/* IFA 2026 — umawianie spotkań, Monstelo × mobilki gsm.pl
   Kierunek "Deal Ticket": kwit na dole ekranu jest podsumowaniem, paskiem postępu,
   nawigacją wstecz i przyciskiem naraz.

   Backend: własny PHP na ifa.monstelo.com (odczyt ~60 ms). Apps Script zostaje pod spodem
   jako most do Kalendarza Google i jako awaryjne wejście — patrz USE_PHP_BACKEND. */

const USE_PHP_BACKEND = true;
const API = "https://ifa.monstelo.com/api";
const ENDPOINT = "https://script.google.com/macros/s/AKfycbzzy21Dqx2-Y7XI5HkhZIeCx7qLR7st2Ts53u37ZZT2bjoyKdtodERsHSZ8a_6d-gpalw/exec";

// Dni targowe. Stoisko H27E-17, Reseller Park.
const DAYS = [
  { iso: "2026-09-04", dow: "Fri", d: "4", mon: "Sep" },
  { iso: "2026-09-05", dow: "Sat", d: "5", mon: "Sep" },
  { iso: "2026-09-06", dow: "Sun", d: "6", mon: "Sep" },
  { iso: "2026-09-07", dow: "Mon", d: "7", mon: "Sep" },
  { iso: "2026-09-08", dow: "Tue", d: "8", mon: "Sep" },
];

// Godziny stoiska. Potwierdzić z oficjalnym harmonogramem IFA przed drukiem QR.
const DAY_START = 10;
const DAY_END = 18;
const SLOT_MIN = 15;
const DURATIONS = [15, 30, 45];
const EVENING_START = 18;
const EVENING_END = 23;
const TZ = "Europe/Berlin";

/* Załoga na stoisku. Kolejność = kolejność przydziału przy "Anyone free" (ta sama w backendzie).
   Adresy e-mail żyją wyłącznie po stronie serwera — klient wysyła samo `id`. */
const PEOPLE = [
  { id: "any",        slug: "",   name: "Anyone free",        role: "We assign the first colleague free", langs: [] },
  { id: "juszczyk",   slug: "sj", name: "Sebastian Juszczyk", role: "Board member · sourcing",  langs: ["EN", "PL"] },
  { id: "mamcarczyk", slug: "mm", name: "Michał Mamcarczyk",  role: "Key Account Manager",      langs: ["EN", "PL"] },
  { id: "tuchowska",  slug: "nt", name: "Nikola Tuchowska",   role: "Key Account Manager",      langs: ["EN", "PL"] },
  { id: "tabak",      slug: "lt", name: "Łukasz Tabak",       role: "Key Account Manager",      langs: ["PL"] },
  { id: "kocaba",     slug: "bk", name: "Błażej Kócaba",      role: "Key Account Manager",      langs: ["PL"] },
  { id: "drozd",      slug: "td", name: "Tomasz Drozd",       role: "Brand growth · retail",    langs: ["EN", "PL"] },
  { id: "palka",      slug: "kp", name: "Kamil Pałka",        role: "Key Account Manager",      langs: ["PL", "CZ"] },
];
const LANGS = ["EN", "PL", "CZ"];

function personById(id) { return PEOPLE.find((p) => p.id === id) || null; }

/* Linki personalne dla handlowców: …/spotkanie/?td, ?p=td albo ?person=drozd. */
function personFromQuery(search) {
  const q = String(search || "").replace(/^\?/, "");
  if (!q) return null;
  const keys = q
    .split("&")
    .flatMap((part) => [part.split("=")[0], part.split("=").pop()])
    .map((k) => decodeURIComponent(k || "").toLowerCase());
  for (const k of keys) {
    if (!k) continue;
    const hit = PEOPLE.find((p) => p.id !== "any" && (p.slug === k || p.id === k));
    if (hit) return hit;
  }
  return null;
}

function pad(n) { return String(n).padStart(2, "0"); }
function toMin(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }
function toHHMM(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
function addMinutes(hhmm, min) { return toHHMM(toMin(hhmm) + min); }

/* Kwadranse od otwarcia do zamknięcia. */
function gridSlots(start, end, step) {
  const out = [];
  for (let m = start * 60; m < end * 60; m += step) out.push(toHHMM(m));
  return out;
}

function eveningTimes(start, end) {
  const out = [];
  for (let h = start; h <= end; h++) {
    out.push(pad(h) + ":00");
    if (h < end) out.push(pad(h) + ":30");
  }
  return out;
}

/* Długości, które mieszczą się przed zamknięciem. */
function durationsFor(from, end) {
  return DURATIONS.filter((d) => toMin(from) + d <= end * 60);
}

/* Dwa spotkania kolidują, gdy się nakładają — nie tylko gdy zaczynają się o tej samej minucie. */
function overlaps(aFrom, aTo, bFrom, bTo) {
  return toMin(aFrom) < toMin(bTo) && toMin(bFrom) < toMin(aTo);
}

/* Czy [from, from+dur) jest wolne wobec listy zajętości? */
function isFree(from, dur, busy) {
  const s = toMin(from), e = s + dur;
  return !(busy || []).some((w) => toMin(w[0]) < e && s < toMin(w[1]));
}

/* Kwadranse, w których nikt nie jest wolny — dla "Anyone free". */
function allBusyQuarters(perPerson, startH, endH) {
  const out = [];
  const from = (startH == null ? DAY_START : startH) * 60;
  const to = (endH == null ? DAY_END : endH) * 60;
  for (let m = from; m < to; m += SLOT_MIN) {
    const everyoneBusy =
      perPerson.length > 0 &&
      perPerson.every((busy) => (busy || []).some((w) => toMin(w[0]) < m + SLOT_MIN && m < toMin(w[1])));
    if (everyoneBusy) out.push([toHHMM(m), toHHMM(m + SLOT_MIN)]);
  }
  return out;
}

/* Ile kwadransów danego dnia zostało wolnych — liczba przy nazwisku. */
function freeQuarters(busy) {
  let n = 0;
  for (let m = DAY_START * 60; m < DAY_END * 60; m += SLOT_MIN) {
    if (isFree(toHHMM(m), SLOT_MIN, busy)) n++;
  }
  return n;
}

/* Numer kwitu: IFA-MMDD-HHMM-XX. Nie jest identyfikatorem w bazie — to znak, że to transakcja. */
function ticketRef(state) {
  const day = state.date ? state.date.slice(5).replace("-", "") : "····";
  const time = state.from ? state.from.replace(":", "") : "····";
  const p = personById(state.person);
  const ini = !p || p.id === "any" ? "AN" : p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `IFA-${day}-${time}-${ini}`;
}

/* Zawsze ten sam zestaw pól — pusty jako kropki, żeby było widać czego brakuje. */
function ticketFields(state) {
  const dots = (n) => "·".repeat(n);
  const day = DAYS.find((d) => d.iso === state.date);
  const p = personById(state.person);
  return [
    ["DAY", day ? `${day.d} ${day.mon}` : dots(5)],
    ["TIME", state.from ? (state.evening ? `${state.from} evening` : state.from) : dots(5)],
    ["LEN", state.from ? (state.evening ? "60" : String(state.dur)) : dots(2)],
    ["WITH", p ? (p.id === "any" ? "anyone free" : p.name) : dots(12)],
  ];
}

/* Czego brakuje do rezerwacji — treść przycisku bierze się stąd. */
function nextStep(state, formReady) {
  if (!state.date) return { key: "date", label: "Pick a day to start" };
  if (!state.person) return { key: "person", label: "Pick who you want to meet" };
  if (!state.from) return { key: "time", label: "Pick a time" };
  if (state.evening && !state.place) return { key: "place", label: "Tell us where to meet" };
  if (!formReady) return { key: "you", label: "Add your details ▸" };
  return { key: "go", label: "Book this meeting ▸" };
}

function validate(b) {
  const err = [];
  if (!b.name || b.name.trim().length < 3) err.push("name");
  if (!b.company || !b.company.trim()) err.push("company");
  if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) err.push("email");
  if (!b.date || !DAYS.some((d) => d.iso === b.date)) err.push("date");
  if (!b.from || !b.to) err.push("slot");
  if (b.from && b.to && toMin(b.to) <= toMin(b.from)) err.push("slot");
  if (!b.evening && b.from && b.to && !DURATIONS.includes(toMin(b.to) - toMin(b.from))) err.push("duration");
  if (!b.evening && b.to && toMin(b.to) > DAY_END * 60) err.push("duration");
  if (!b.person || !personById(b.person)) err.push("person");
  if (b.evening && !b.place) err.push("place");
  if (!b.consent) err.push("consent");
  return err;
}

/* Link "dodaj do swojego kalendarza" dla gościa. */
function gcalLink(b) {
  const start = b.date.replace(/-/g, "") + "T" + b.from.replace(":", "") + "00";
  const end = b.date.replace(/-/g, "") + "T" + b.to.replace(":", "") + "00";
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: "Monstelo × Mobilki GSM — IFA Berlin",
    dates: start + "/" + end,
    ctz: TZ,
    location: b.place || "IFA Berlin, Reseller Park, stand H27E-17",
    details:
      "Meeting with Monstelo × Mobilki GSM at IFA Berlin 2026.\nStand H27E-17, Reseller Park." +
      (b.personName && b.person !== "any" ? "\nWith: " + b.personName : ""),
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

/* Zachowane dla zgodności z testami sprzed przebudowy. */
function hourlySlots(start, end) {
  const out = [];
  for (let h = start; h < end; h++) out.push({ from: pad(h) + ":00", to: pad(h + 1) + ":00" });
  return out;
}

/* ---------------------------------------------------------------- przeglądarka */
if (typeof document !== "undefined") (function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    date: null, person: null, from: null, to: null, dur: SLOT_MIN,
    evening: false, place: "", busy: [], free: {}, day: null, fixedPerson: false,
    stale: null, nonce: null, sending: false,
  };

  const motion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  const show = (id, on) => { $(id).hidden = !on; };
  const jump = (id) => $(id).scrollIntoView({ behavior: motion(), block: "start" });

  /* ---------- dane ---------- */
  const dayCache = new Map();

  async function fetchDay(date) {
    const url = USE_PHP_BACKEND
      ? `${API}/free.php?date=${encodeURIComponent(date)}`
      : `${ENDPOINT}?action=free&date=${encodeURIComponent(date)}`;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const t = await r.text();
      if (!t.trim().startsWith("{")) return null;
      const out = JSON.parse(t);
      return out.ok && out.people ? out : null;
    } catch (e) {
      return null;
    }
  }

  /* Dostępność to najlepszy wysiłek: jedna próba, jedno ponowienie, potem pokazujemy wszystko
     i pozwalamy rezerwować — serwer i tak odrzuci zajęty termin. */
  function loadDay(date) {
    if (dayCache.has(date)) return dayCache.get(date);
    const p = (async () => (await fetchDay(date)) || (await fetchDay(date)))();
    dayCache.set(date, p);
    p.then((v) => { if (v === null) dayCache.delete(date); });
    return p;
  }

  function busyFor(pid) {
    if (!state.day) return [];
    if (pid === "any") {
      const lists = PEOPLE.filter((x) => x.id !== "any").map((x) => state.day.people[x.id]).filter(Boolean);
      return lists.length ? allBusyQuarters(lists) : [];
    }
    return state.day.people[pid] || [];
  }

  /* ---------- widok ---------- */
  function renderDays() {
    $("days").innerHTML = DAYS.map(
      (d) => `<button type="button" class="day${d.iso === state.date ? " on" : ""}" role="radio"
                aria-checked="${d.iso === state.date}" data-iso="${d.iso}">
                <span class="dow">${d.dow}</span><span class="dnum">${d.d}</span><span class="mon">${d.mon}</span>
              </button>`
    ).join("");
    $("days").querySelectorAll(".day").forEach((el) =>
      el.addEventListener("click", () => pickDay(el.dataset.iso))
    );
  }

  function renderPeople() {
    const list = state.side === "sell" ? PEOPLE : PEOPLE;      // ta sama załoga, kolejność bez zmian
    $("people").innerHTML = list.map((p) => {
      const busy = busyFor(p.id);
      const free = p.id === "any"
        ? Object.values(state.free || {}).reduce((a, b) => a + b, 0)
        : (state.free && state.free[p.id] != null ? state.free[p.id] : freeQuarters(busy));
      const known = state.day !== null;
      const full = known && free === 0;
      // Tylko języki, którymi ta osoba faktycznie mówi — wygaszone chipy myliły gości.
      const langs = p.id === "any" || !p.langs.length ? "" :
        `<span class="lg">${p.langs.map((l) => `<em>${l}</em>`).join("")}</span>`;
      return `<button type="button" class="p${p.id === "any" ? " any" : ""}${p.id === state.person ? " on" : ""}"
                role="radio" aria-checked="${p.id === state.person}" data-id="${p.id}" ${full ? "disabled" : ""}>
                <span class="ini">${p.id === "any" ? "◆" : p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)}</span>
                <span class="txt"><span class="nm">${p.name}</span><span class="rl">${p.role}</span>${langs}</span>
                <span class="free">${known ? `<b>${free}</b>${full ? "full" : "free"}` : ""}</span>
              </button>`;
    }).join("");
    $("people").querySelectorAll(".p:not([disabled])").forEach((el) =>
      el.addEventListener("click", () => pickPerson(el.dataset.id))
    );
  }

  function renderTimes() {
    const busy = busyFor(state.person);
    const cell = (t) => {
      const free = isFree(t, SLOT_MIN, busy);
      return `<button type="button" class="h${t === state.from ? " sel" : ""}${free ? "" : " taken"}"
        role="radio" aria-checked="${t === state.from}" data-from="${t}"
        ${free ? "" : ' disabled title="Already booked"'}>${t}</button>`;
    };
    const all = gridSlots(DAY_START, DAY_END, SLOT_MIN);
    const half = all.filter((t) => toMin(t) < 13 * 60);
    const rest = all.filter((t) => toMin(t) >= 13 * 60);
    $("times").innerHTML =
      `<div class="tgroup"><span class="tg">Morning</span><div class="hours">${half.map(cell).join("")}</div></div>` +
      `<div class="tgroup"><span class="tg">Afternoon</span><div class="hours">${rest.map(cell).join("")}</div></div>`;
    $("times").querySelectorAll(".h:not([disabled])").forEach((el) =>
      el.addEventListener("click", () => pickTime(el.dataset.from))
    );
    renderLengths();
  }

  /* Niedostępna długość nie znika — jest wygaszona i mówi dlaczego. */
  function renderLengths() {
    if (!state.from) { show("step-len", false); return; }
    const busy = busyFor(state.person);
    const opts = DURATIONS.map((d) => {
      const fitsDay = toMin(state.from) + d <= DAY_END * 60;
      const free = isFree(state.from, d, busy);
      return { d, ok: fitsDay && free, why: !fitsDay ? "past 18:00" : "into a taken slot" };
    });
    if (!opts.find((o) => o.d === state.dur && o.ok)) {
      const first = opts.find((o) => o.ok);
      state.dur = first ? first.d : SLOT_MIN;
      state.to = addMinutes(state.from, state.dur);
    }
    $("lens").innerHTML = opts.map((o) =>
      `<button type="button" class="len${o.d === state.dur ? " sel" : ""}${o.ok ? "" : " off"}"
        role="radio" aria-checked="${o.d === state.dur}" data-min="${o.d}" ${o.ok ? "" : "disabled"}>${o.d} min</button>`
    ).join("");
    const blocked = opts.filter((o) => !o.ok);
    $("len-note").textContent = blocked.length
      ? `${blocked.map((o) => o.d).join(" and ")} min runs ${blocked[0].why}`
      : "";
    $("lens").querySelectorAll(".len:not([disabled])").forEach((el) =>
      el.addEventListener("click", () => {
        state.dur = Number(el.dataset.min);
        state.to = addMinutes(state.from, state.dur);
        renderLengths();
        renderTicket();
      })
    );
    show("step-len", true);
  }

  function formReady() {
    return $("f-name").value.trim().length >= 3 &&
           $("f-company").value.trim() !== "" &&
           /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($("f-email").value.trim()) &&
           $("f-consent").checked;
  }

  function renderTicket() {
    $("tk-ref").textContent = ticketRef(state);
    $("tk-fields").innerHTML = ticketFields(state)
      .map(([k, v]) => {
        const empty = v.startsWith("·");
        const step = { DAY: "step-day", TIME: "step-time", LEN: "step-time", WITH: "step-person" }[k];
        return `<button type="button" class="f${empty ? " e" : ""}" data-go="${step}">
                  <span class="k">${k}</span> <span class="v">${v}</span></button>`;
      })
      .join("");
    $("tk-fields").querySelectorAll(".f").forEach((el) =>
      el.addEventListener("click", () => { const t = $(el.dataset.go); if (t && !t.hidden) jump(el.dataset.go); })
    );
    const step = nextStep(state, formReady());
    const btn = $("tk-cta");
    btn.textContent = state.sending ? "Booking…" : step.label;
    btn.classList.toggle("go", step.key === "go" || step.key === "you");
    btn.disabled = state.sending;
    btn.dataset.step = step.key;
  }

  function freshness(out) {
    if (!out || !out.generated_at) { $("fresh").textContent = ""; return; }
    const secs = out.stale_seconds != null ? out.stale_seconds : 0;
    const t = new Date(out.generated_at);
    const hh = pad(t.getHours()) + ":" + pad(t.getMinutes());
    $("fresh").textContent = secs > 600
      ? `Availability may be out of date (last checked ${hh}) — we confirm every meeting by e-mail`
      : `Availability updated ${hh}`;
    $("fresh").classList.toggle("warn", secs > 600);
  }

  /* ---------- kroki ---------- */
  function pickSide(side) {
    state.side = side;
    renderSides();
    show("step-day", true);
    renderTicket();
    jump("step-day");
  }

  async function pickDay(iso) {
    state.date = iso;
    state.person = state.fixedPerson ? state.person : null;
    state.from = state.to = null;
    state.day = null; state.free = {};
    renderDays();
    show("step-person", !state.fixedPerson);
    show("step-time", false);
    show("step-you", false);
    show("evening", true);
    show("evening-fields", false);
    $("evening-btn").classList.remove("on");
    state.evening = false;
    renderTicket();

    if (!state.fixedPerson) { renderPeople(); jump("step-person"); }
    $("fresh").textContent = "Checking free hours…";

    const out = await loadDay(iso);
    if (state.date !== iso) return;
    state.day = out || { people: {} };
    state.free = (out && out.free) || {};
    freshness(out);
    if (out && out.booking_enabled === false) {
      $("closed").hidden = false;
      $("tk-cta").disabled = true;
    }
    if (state.fixedPerson) { showTimes(); } else { renderPeople(); }
  }

  function pickPerson(id) {
    state.person = id;
    state.from = state.to = null;
    renderPeople();
    renderTicket();
    showTimes();
  }

  function showTimes() {
    show("step-time", true);
    renderTimes();
    jump("step-time");
  }

  function pickTime(from) {
    state.from = from;
    state.evening = false;
    state.place = "";
    state.dur = DURATIONS[0];
    state.to = addMinutes(from, state.dur);
    show("evening", false);          // jedno albo drugie — nie oba naraz
    renderTimes();
    show("step-you", true);
    renderTicket();
  }

  /* Wieczór wyklucza się z godziną na stoisku: zaznaczony kwadrans znika, siatka też. */
  function openEvening() {
    state.evening = true;
    state.from = $("evening-when").value || pad(EVENING_START) + ":00";
    state.dur = 60;
    state.to = addMinutes(state.from, 60);
    state.place = $("evening-place").value.trim();
    show("evening-fields", true);
    show("times", false);
    show("legend", false);
    show("step-len", false);
    $("evening-btn").classList.add("on");
    show("step-you", true);
    renderTicket();
  }

  function closeEvening() {
    state.evening = false;
    state.from = state.to = null;
    state.place = "";
    show("evening-fields", false);
    show("times", true);
    show("legend", true);
    $("evening-btn").classList.remove("on");
    renderTimes();
    renderTicket();
  }

  function bookingFromForm() {
    if (!state.nonce) {
      const buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      state.nonce = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return {
      name: $("f-name").value.trim().slice(0, 80),
      company: $("f-company").value.trim().slice(0, 80),
      email: $("f-email").value.trim().slice(0, 120),
      phone: $("f-phone").value.trim().slice(0, 30),
      note: $("f-note").value.trim().slice(0, 500),
      consent: $("f-consent").checked ? 1 : 0,
      date: state.date,
      from: state.from,
      to: state.to,
      minutes: state.evening ? 60 : state.dur,
      person: state.person,
      personName: (personById(state.person) || {}).name || "",
      evening: state.evening,
      place: state.evening ? $("evening-place").value.trim().slice(0, 120) : "",
      tz: TZ,
      source: state.fixedPerson ? "link-" + state.person : "ifa-booking",
      nonce: state.nonce,
    };
  }

  async function send(b) {
    if (USE_PHP_BACKEND) {
      const r = await fetch(`${API}/book.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const t = await r.text();
      return t.trim().startsWith("{") ? JSON.parse(t) : null;
    }
    const url = `${ENDPOINT}?action=book&payload=${encodeURIComponent(JSON.stringify(b))}`;
    const t = await (await fetch(url)).text();
    return t.trim().startsWith("{") ? JSON.parse(t) : null;
  }

  function errorText(reason) {
    if (!reason) return "Something went wrong. Try again in a moment.";
    if (reason === "taken") return "That slot has just been taken. Pick another one.";
    if (reason === "closed") return "Booking is closed right now. Write to brands@monstelo.com and we will hold a slot.";
    if (reason.startsWith("limit")) return "You have reached today's booking limit. Write to brands@monstelo.com.";
    if (reason.startsWith("bad:consent")) return "Tick the consent box so we can arrange the meeting.";
    if (reason.startsWith("bad:")) return "Check the highlighted fields.";
    return "Something went wrong. Try again in a moment.";
  }

  async function submit() {
    const b = bookingFromForm();
    const err = validate(b);
    ["f-name", "f-company", "f-email", "evening-place"].forEach((id) => $(id).classList.remove("bad"));
    err.forEach((e) => {
      const el = e === "place" ? $("evening-place") : $("f-" + e);
      if (el) el.classList.add("bad");
    });
    if (err.length) {
      $("msg").textContent = err.includes("consent")
        ? "Tick the consent box so we can arrange the meeting."
        : err.includes("email")
        ? "That e-mail address does not look right."
        : "Add your name, company and work e-mail.";
      $("msg").className = "msg bad";
      return;
    }
    state.sending = true; renderTicket();
    $("msg").textContent = "";
    let out = await send(b).catch(() => null);
    if (out === null) out = await send(b).catch(() => null);   // ten sam nonce — nie zdubluje
    state.sending = false;
    if (!out || !out.ok) {
      renderTicket();
      $("msg").className = "msg bad";
      $("msg").textContent = errorText(out && out.reason);
      if (out && out.reason === "taken") { dayCache.delete(state.date); pickDay(state.date); }
      return;
    }
    if (out.person) b.personName = out.person;
    done(b, out);
  }

  function done(b, out) {
    const day = DAYS.find((d) => d.iso === b.date);
    $("form-wrap").hidden = true;
    $("ticket").classList.add("stamped");
    $("done").hidden = false;
    $("done-ref").textContent = ticketRef(state);
    $("done-when").textContent =
      `${day.dow} ${day.d} ${day.mon} · ${b.from}–${b.to} · Berlin time` + (b.evening ? ` · ${b.place}` : "");
    $("done-who").textContent = out.assigned
      ? `With ${b.personName} — the colleague free at that hour`
      : b.person === "any" ? "We will assign the right person" : `With ${b.personName}`;
    $("done-cal").href = gcalLink(b);
    window.scrollTo({ top: 0, behavior: motion() });
  }

  function boot() {
    const fixed = personFromQuery(location.search);
    if (fixed) {
      state.person = fixed.id;
      state.fixedPerson = true;
      show("step-person", false);
      $("with-line").hidden = false;
      $("with-name").textContent = fixed.name;
      $("with-role").textContent = fixed.role;
      document.title = "Book a slot with " + fixed.name + " — IFA 2026";
    }
    renderDays();
    renderTicket();

    $("evening-btn").addEventListener("click", () => (state.evening ? closeEvening() : openEvening()));
    $("evening-when").addEventListener("change", () => { if (state.evening) openEvening(); });
    $("evening-place").addEventListener("input", () => { state.place = $("evening-place").value.trim(); renderTicket(); });
    ["f-name", "f-company", "f-email", "f-consent"].forEach((id) =>
      $(id).addEventListener("input", renderTicket)
    );
    $("f-consent").addEventListener("change", renderTicket);
    $("tk-cta").addEventListener("click", () => {
      const step = $("tk-cta").dataset.step;
      if (step === "go") { submit(); return; }
      const target = { date: "step-day", person: "step-person", time: "step-time",
                       place: "step-time", you: "step-you" }[step];
      if (target && !$(target).hidden) jump(target);
    });
    $("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

/* ---------------------------------------------------------------- node (testy) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAYS, PEOPLE, LANGS, personById, personFromQuery, allBusyQuarters, freeQuarters,
    hourlySlots, gridSlots, durationsFor, overlaps, isFree, addMinutes, toMin,
    eveningTimes, validate, gcalLink, ticketRef, ticketFields, nextStep,
    DAY_START, DAY_END, EVENING_START, EVENING_END, SLOT_MIN, DURATIONS,
  };
}
