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
/* Kolejność WYŚWIETLANIA na liście — nie mylić z kolejnością przydziału przy „Anyone free",
   która żyje po stronie backendu (ASSIGN_ORDER w _domain.php) i jest od tej niezależna. */
const PEOPLE = [
  { id: "any",        slug: "",   name: "Anyone free",        role: "We assign the first colleague free", langs: [] },
  { id: "mamcarczyk", slug: "mm", name: "Michał Mamcarczyk",  role: "B2B Key Account Manager",  langs: ["EN", "PL"] },
  { id: "tuchowska",  slug: "nt", name: "Nikola Tuchowska",   role: "B2B Key Account Manager",  langs: ["EN", "PL"] },
  { id: "tabak",      slug: "lt", name: "Łukasz Tabak",       role: "B2B Key Account Manager",  langs: ["PL"] },
  { id: "kocaba",     slug: "bk", name: "Błażej Kócaba",      role: "B2B Key Account Manager",  langs: ["PL"] },
  { id: "palka",      slug: "kp", name: "Kamil Pałka",        role: "B2B Key Account Manager",  langs: ["PL", "CZ"] },
  { id: "drozd",      slug: "td", name: "Tomasz Drozd",       role: "Brand growth · retail",    langs: ["EN", "PL"] },
  { id: "juszczyk",   slug: "sj", name: "Sebastian Juszczyk", role: "Board member · sourcing",  langs: ["EN", "PL"] },
];
const LANGS = ["EN", "PL", "CZ"];

function personById(id) { return PEOPLE.find((p) => p.id === id) || null; }

/* Linki personalne dla handlowców: …/spotkanie/?td, ?p=td albo ?person=drozd. */
/* Adres z gołym znakiem procenta (np. ?utm_content=20%off z kampanii) wywracał
   decodeURIComponent wyjątkiem URIError. Ta funkcja jest wołana przy starcie, PRZED podpięciem
   zdarzeń, więc jeden taki link zabijał cały formularz: gość widział stronę, ale nic nie działało. */
function dekoduj(v) {
  try { return decodeURIComponent(String(v || "")); } catch (e) { return String(v || ""); }
}

function personFromQuery(search) {
  const q = String(search || "").replace(/^\?/, "");
  if (!q) return null;
  const keys = q
    .split("&")
    .flatMap((part) => [part.split("=")[0], part.split("=").pop()])
    .map((k) => dekoduj(k).toLowerCase());
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
function nextStep(state, formReady, detailsFilled) {
  if (!state.date) return { key: "date", label: "Pick a day to start" };
  if (!state.person) return { key: "person", label: "Pick who you want to meet" };
  if (!state.from) return { key: "time", label: "Pick a time" };
  if (state.evening && !state.place) return { key: "place", label: "Tell us where to meet" };
  // Zgoda to jedno kliknięcie, więc mówimy o niej wprost zamiast ogólnego "uzupełnij dane".
  if (!formReady && detailsFilled) return { key: "consent", label: "Tick the consent box ▸" };
  if (!formReady) return { key: "you", label: "Add your details ▸" };
  return { key: "go", label: "Book this meeting ▸" };
}

function validate(b) {
  const err = [];
  /* Godzina, której nie da się odczytać, dawała NaN — a każde porównanie z NaN jest fałszywe,
     więc walidator meldował „brak błędów" i dopiero serwer odrzucał rezerwację. */
  const zlaGodzina = (t) => t != null && t !== "" && !/^\d{1,2}:\d{2}$/.test(String(t));
  if (!b.name || b.name.trim().length < 3) err.push("name");
  if (!b.company || !b.company.trim()) err.push("company");
  if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) err.push("email");
  if (!b.date || !DAYS.some((d) => d.iso === b.date)) err.push("date");
  if (!b.from || !b.to) err.push("slot");
  if (zlaGodzina(b.from) || zlaGodzina(b.to)) err.push("slot");
  if (b.from && b.to && toMin(b.to) <= toMin(b.from)) err.push("slot");
  if (!b.evening && b.from && b.to && !DURATIONS.includes(toMin(b.to) - toMin(b.from))) err.push("duration");
  if (!b.evening && b.to && toMin(b.to) > DAY_END * 60) err.push("duration");
  if (b.evening && b.from && (toMin(b.from) < EVENING_START * 60 || toMin(b.to) > EVENING_END * 60)) err.push("evening");
  if (!b.person || !personById(b.person)) err.push("person");
  if (b.evening && !b.place) err.push("place");
  if (!b.consent) err.push("consent");
  /* Ten sam kod potrafił wpaść dwa razy (np. 17:45-19:00 to i zła długość, i po zamknięciu).
     Backend robi array_unique, więc bez tego kontrakt obu stron się rozjeżdżał. */
  return err.filter((k, i) => err.indexOf(k) === i);
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
/* Widok jest jednym formularzem: dzień → osoba → godzina → dane. Zajęte godziny są w liście
   wyłączone z dopiskiem "fully booked", tak jak u Partner Tele — najprościej i bez zaskoczeń. */
if (typeof document !== "undefined") (function () {
  const $ = (id) => document.getElementById(id);
  const state = { day: null, free: {}, fixedPerson: false, nonce: null, sending: false };

  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  /* ---------- dane ---------- */
  const cache = new Map();
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
    } catch (e) { return null; }
  }
  function loadDay(date) {
    if (cache.has(date)) return cache.get(date);
    const p = (async () => (await fetchDay(date)) || (await fetchDay(date)))();
    cache.set(date, p);
    p.then((v) => { if (v === null) cache.delete(date); });
    return p;
  }
  const busyFor = (pid) => {
    if (!state.day) return [];
    if (pid === "any") {
      const lists = PEOPLE.filter((x) => x.id !== "any").map((x) => state.day.people[x.id]).filter(Boolean);
      return lists.length ? allBusyQuarters(lists) : [];
    }
    return state.day.people[pid] || [];
  };

  /* ---------- listy ---------- */
  function fillDays() {
    $("f-day").innerHTML = '<option value="">— select a day —</option>' +
      DAYS.map((d) => `<option value="${d.iso}">${d.dow} ${d.d} ${d.mon}</option>`).join("");
  }

  /* Lista osób powstaje RAZ i nigdy nie jest przebudowywana. Wcześniej odświeżała się przy
     każdej zmianie dnia (żeby pokazać liczby wolnych kwadransów) i przy okazji gubiła wybór
     gościa — wybierał osobę, zmieniał dzień i wracał do „Anyone free", nie wiedząc dlaczego. */
  function fillPeople() {
    $("f-person").innerHTML = PEOPLE.map((p) => {
      const langs = p.langs.length ? " · " + p.langs.join("/") : "";
      const role = p.id === "any" ? "" : " — " + p.role;
      return `<option value="${p.id}">${p.name}${role}${langs}</option>`;
    }).join("");
    if (state.fixedPerson) $("f-person").value = state.person;
  }

  const isEvening = () => $("f-time").value === "evening";

  /* Jedno źródło prawdy o wybranej osobie. Przy linku personalnym (?td) pole wyboru jest UKRYTE,
     więc czytanie z niego dawało „any" i siatka pokazywała wszystko jako wolne — dokładnie tak
     zgłosił to użytkownik 27.08. Stan wie, kto jest wybrany, niezależnie od tego, co widać. */
  const wybranaOsoba = () => (state.fixedPerson ? state.person : $("f-person").value) || "any";

  function fillTimes() {
    const sel = $("f-time");
    const keep = sel.value;
    if (!$("f-day").value) {
      sel.innerHTML = '<option value="">— select a day first —</option>';
      sel.disabled = true;
      return;
    }
    const busy = busyFor(wybranaOsoba());
    const len = Number($("f-len").value) || 15;
    const opts = gridSlots(DAY_START, DAY_END, SLOT_MIN).map((t) => {
      const fits = toMin(t) + len <= DAY_END * 60;
      const ok = fits && isFree(t, len, busy);
      const why = !fits ? " — past closing" : " — fully booked";
      return `<option value="${t}"${ok ? "" : " disabled"}>${t}${ok ? "" : why}</option>`;
    });
    sel.innerHTML = '<option value="">— select a time —</option>' + opts.join("") +
      `<option value="evening">Evening off-site: ${pad(EVENING_START)}:00–${pad(EVENING_END)}:00</option>`;
    sel.disabled = false;
    if (keep) sel.value = keep;
  }

  function fillLengths() {
    if (isEvening()) {                       // wieczór to całe okno, nie kwadranse
      $("f-len").innerHTML = '<option value="">evening</option>';
      $("f-len").disabled = true;
      return;
    }
    $("f-len").disabled = false;
    const from = $("f-time").value;
    const busy = busyFor(wybranaOsoba());
    const keep = $("f-len").value;
    $("f-len").innerHTML = DURATIONS.map((d) => {
      const ok = !from || (toMin(from) + d <= DAY_END * 60 && isFree(from, d, busy));
      return `<option value="${d}"${ok ? "" : " disabled"}>${d} min${ok ? "" : " — not free"}</option>`;
    }).join("");
    const wanted = DURATIONS.includes(Number(keep)) ? keep : "15";
    $("f-len").value = wanted;
    if ($("f-len").selectedOptions[0] && $("f-len").selectedOptions[0].disabled) {
      const first = [].find.call($("f-len").options, (o) => !o.disabled);
      if (first) $("f-len").value = first.value;
    }
  }

  function freshness() {
    const out = state.day;
    const hint = $("hint-time");
    if (!out || !out.generated_at) { hint.textContent = "All times Berlin (CEST)."; hint.className = "hint"; return; }
    const t = new Date(out.generated_at);
    const hh = pad(t.getHours()) + ":" + pad(t.getMinutes());
    const stale = (out.stale_seconds || 0) > 900;
    hint.textContent = stale
      ? `All times Berlin (CEST). Availability last checked ${hh} — we confirm every meeting by e-mail.`
      : `All times Berlin (CEST). Availability updated ${hh}.`;
    hint.className = stale ? "hint warn" : "hint";
  }

  /* ---------- reakcje ---------- */
  async function onDay() {
    const date = $("f-day").value;
    $("f-time").value = "";
    if (!date) { state.day = null; fillTimes(); return; }
    $("hint-time").textContent = "Checking free hours…";
    state.day = null;
    const out = await loadDay(date);
    if ($("f-day").value !== date) return;
    state.day = out || { people: {} };
    freshness();
    fillTimes();
    fillLengths();
  }

  /* Wybór wieczoru z listy godzin odsłania pytanie o miejsce i wyłącza długość. */
  function onTime() {
    $("wrap-place").hidden = !isEvening();
    fillLengths();
  }

  function bookingFromForm() {
    if (!state.nonce) {
      const buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      state.nonce = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const evening = isEvening();
    const from = evening ? pad(EVENING_START) + ":00" : $("f-time").value;
    const len = evening ? (EVENING_END - EVENING_START) * 60 : Number($("f-len").value) || 15;
    const person = state.fixedPerson ? state.person : $("f-person").value || "any";
    return {
      name: $("f-name").value.trim().slice(0, 80),
      company: $("f-company").value.trim().slice(0, 80),
      email: $("f-email").value.trim().slice(0, 120),
      phone: $("f-phone").value.trim().slice(0, 30),
      note: $("f-note").value.trim().slice(0, 500),
      consent: $("f-consent").checked ? 1 : 0,
      date: $("f-day").value,
      from: from,
      to: from ? addMinutes(from, len) : "",
      minutes: len,
      person: person,
      personName: (personById(person) || {}).name || "",
      evening: evening,
      place: evening ? $("f-place").value.trim().slice(0, 120) : "",
      tz: TZ,
      source: state.fixedPerson ? "link-" + person : "ifa-booking",
      nonce: state.nonce,
    };
  }

  async function send(b) {
    if (USE_PHP_BACKEND) {
      const r = await fetch(`${API}/book.php`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
      });
      const t = await r.text();
      return t.trim().startsWith("{") ? JSON.parse(t) : null;
    }
    const url = `${ENDPOINT}?action=book&payload=${encodeURIComponent(JSON.stringify(b))}`;
    const t = await (await fetch(url)).text();
    return t.trim().startsWith("{") ? JSON.parse(t) : null;
  }

  function errorText(reason) {
    if (reason === "taken") return "That slot has just been taken. Pick another one.";
    if (reason === "closed") return "Booking is closed right now. Write to brands@monstelo.com.";
    if (String(reason).startsWith("limit")) return "Booking limit reached. Write to brands@monstelo.com.";
    return "Something went wrong. Try again in a moment.";
  }

  const FIELD = { name: "f-name", company: "f-company", email: "f-email", place: "f-place",
                  date: "f-day", slot: "f-time", duration: "f-len", consent: "f-consent", person: "f-person" };

  async function submit(e) {
    if (e) e.preventDefault();
    const b = bookingFromForm();
    const err = validate(b);
    Object.values(FIELD).forEach((id) => $(id).classList.remove("bad"));
    err.forEach((k) => { if (FIELD[k]) $(FIELD[k]).classList.add("bad"); });
    if (err.length) {
      $("msg").className = "msg bad";
      $("msg").textContent =
        err.includes("date") || err.includes("slot") ? "Pick a day and a time."
        : err.includes("place") ? "Tell us where the evening meeting should be."
        : err.includes("consent") ? "Tick the consent box so we can arrange the meeting."
        : err.includes("email") ? "That e-mail address does not look right."
        : "Add your name, company and work e-mail.";
      return;
    }
    state.sending = true;
    $("send").disabled = true;
    $("send").textContent = "Booking…";
    $("msg").textContent = "";
    let out = await send(b).catch(() => null);
    if (out === null) out = await send(b).catch(() => null);   // ten sam nonce nie zdubluje
    state.sending = false;
    if (!out || !out.ok) {
      $("send").disabled = false;
      $("send").innerHTML = '<span class="arrow">→</span>Book a meeting';
      $("msg").className = "msg bad";
      $("msg").textContent = errorText(out && out.reason);
      if (out && out.reason === "taken") { cache.delete(b.date); onDay(); }
      return;
    }
    if (out.person) b.personName = out.person;
    done(b, out);
  }

  function done(b, out) {
    const day = DAYS.find((d) => d.iso === b.date);
    $("form").hidden = true;
    $("done").hidden = false;
    $("done-when").textContent = b.evening
      ? `${day.dow} ${day.d} ${day.mon} · evening off-site · ${b.place}`
      : `${day.dow} ${day.d} ${day.mon} · ${b.from}–${b.to}`;
    $("done-who").textContent = out.assigned
      ? `with ${b.personName} — the colleague free at that hour`
      : b.person === "any" ? "we will assign the right person" : `with ${b.personName}`;
    $("done-cal").href = gcalLink(b);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function boot() {
    fillDays();
    fillPeople();

    const fixed = personFromQuery(location.search);
    if (fixed) {
      state.person = fixed.id;
      state.fixedPerson = true;
      $("f-person").value = fixed.id;      // pole zostaje spójne ze stanem, choć jest ukryte
      $("wrap-person").hidden = true;
      $("with-line").hidden = false;
      $("with-ini").textContent = initials(fixed.name);
      $("with-name").textContent = fixed.name;
      $("with-role").textContent = fixed.role + (fixed.langs.length ? " · " + fixed.langs.join("/") : "");
      document.title = "Book a meeting with " + fixed.name + " — IFA 2026";
    }

    $("f-day").addEventListener("change", onDay);
    $("f-person").addEventListener("change", () => { fillTimes(); fillLengths(); });
    $("f-time").addEventListener("change", onTime);
    $("f-len").addEventListener("change", fillTimes);
    $("form").addEventListener("submit", submit);
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
