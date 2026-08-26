/* IFA 2026 — meeting booking, Monstelo × mobilki gsm.pl
   Static page + Google Apps Script backend (Sheet row + Calendar event).
   Single dependency on the backend: ENDPOINT below.

   Flow: pick day -> pick hourly slot (or evening) -> name/company/e-mail -> POST -> confirmation.
   The POST is a "simple request" (text/plain) on purpose: Apps Script does not answer
   CORS preflight, so any JSON content-type would fail in the browser. */

const ENDPOINT = "https://script.google.com/macros/s/AKfycbzzy21Dqx2-Y7XI5HkhZIeCx7qLR7st2Ts53u37ZZT2bjoyKdtodERsHSZ8a_6d-gpalw/exec"; // paste the Apps Script /exec URL after deploying

// Fair days. Booth H27E-17, Reseller Park.
const DAYS = [
  { iso: "2026-09-04", dow: "Fri", d: "4", mon: "Sep" },
  { iso: "2026-09-05", dow: "Sat", d: "5", mon: "Sep" },
  { iso: "2026-09-06", dow: "Sun", d: "6", mon: "Sep" },
  { iso: "2026-09-07", dow: "Mon", d: "7", mon: "Sep" },
  { iso: "2026-09-08", dow: "Tue", d: "8", mon: "Sep" },
];

// Show floor hours. Confirm against the official IFA opening hours before print.
const DAY_START = 10;
const DAY_END = 18;

// Stand slots run on a 15-minute grid; the visitor then stretches the meeting to 30 or 45.
const SLOT_MIN = 15;
const DURATIONS = [15, 30, 45];

/* Who is on the stand — the Monstelo catalog contact list.
   `email` is used as the calendar guest, so the meeting lands in that person's calendar. */
const PEOPLE = [
  { id: "any",       name: "No preference",      role: "We put the right person at the table", email: "" },
  { id: "mamcarczyk",name: "Michał Mamcarczyk",  role: "Key Account Manager · EN · PL", email: "mm@monstelo.com" },
  { id: "tuchowska", name: "Nikola Tuchowska",   role: "Key Account Manager · EN · PL", email: "nikola.tuchowska@monstelo.com" },
  { id: "tabak",     name: "Łukasz Tabak",       role: "Key Account Manager · PL",      email: "lukasz.tabak@monstelo.com" },
  { id: "palka",     name: "Kamil Pałka",        role: "Key Account Manager · PL · CZ", email: "kamil.palka@monstelo.com" },
  { id: "kocaba",    name: "Błażej Kócaba",      role: "Key Account Manager · PL",      email: "blazej.kocaba@monstelo.com" },
  { id: "juszczyk",  name: "Sebastian Juszczyk", role: "Board member · sourcing · PL · EN", email: "sebastian@monstelo.com" },
  { id: "drozd",     name: "Tomasz Drozd",       role: "Brand Growth Strategist · brands · PL · EN", email: "tomasz.drozd@monstelo.com" },
];
function personById(id) { return PEOPLE.find((p) => p.id === id) || null; }

// Evening slots, for "after the show" meetings.
const EVENING_START = 18;
const EVENING_END = 23;

const TZ = "Europe/Berlin";

function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function toHHMM(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
function addMinutes(hhmm, min) { return toHHMM(toMin(hhmm) + min); }

/* Start times on the 15-minute grid, from opening to closing. */
function gridSlots(start, end, step) {
  const out = [];
  for (let m = start * 60; m < end * 60; m += step) out.push(toHHMM(m));
  return out;
}

/* Durations that still fit before closing time. */
function durationsFor(from, end) {
  return DURATIONS.filter((d) => toMin(from) + d <= end * 60);
}

/* Is [from, from+dur) clear of every busy window? busy = [["HH:MM","HH:MM"], …] */
function isFree(from, dur, busy) {
  const s = toMin(from), e = s + dur;
  return !(busy || []).some((w) => toMin(w[0]) < e && s < toMin(w[1]));
}

/* Two meetings clash when they overlap, not only when they start at the same minute. */
function overlaps(aFrom, aTo, bFrom, bTo) {
  return toMin(aFrom) < toMin(bTo) && toMin(bFrom) < toMin(aTo);
}

/* Kept for the hourly view of the day — one entry per full hour. */
function hourlySlots(start, end) {
  const out = [];
  for (let h = start; h < end; h++) {
    out.push({ from: pad(h) + ":00", to: pad(h + 1) + ":00" });
  }
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
function pad(n) { return String(n).padStart(2, "0"); }

/* Google Calendar "add to my calendar" link for the visitor's own copy. */
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

function validate(b) {
  const err = [];
  if (!b.name || b.name.trim().length < 3) err.push("name");
  if (!b.company || !b.company.trim()) err.push("company");
  if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) err.push("email");
  if (!b.date || !DAYS.some((d) => d.iso === b.date)) err.push("date");
  if (!b.from || !b.to) err.push("slot");
  if (b.from && b.to && toMin(b.to) <= toMin(b.from)) err.push("slot");
  if (!b.evening && b.from && !DURATIONS.includes(toMin(b.to) - toMin(b.from))) err.push("duration");
  if (!b.evening && b.to && toMin(b.to) > DAY_END * 60) err.push("duration");
  if (!b.person || !personById(b.person)) err.push("person");
  if (b.evening && !b.place) err.push("place");
  return err;
}

/* ---------- browser ---------- */
/* Wrapped in a function, not a bare block: WebKit (Safari, every iPhone on the show floor)
   hoists function declarations out of a block but leaves the block's const bindings behind,
   so `boot` threw "Can't find variable: $" and the page rendered empty. */
if (typeof document !== "undefined") (function () {
  const $ = (id) => document.getElementById(id);
  const state = { date: null, from: null, to: null, dur: SLOT_MIN, evening: false, place: "", person: "any", busy: [] };

  function renderDays() {
    $("days").innerHTML = DAYS.map(
      (d) => `<button class="day" data-iso="${d.iso}">
                <span class="dow">${d.dow}</span>
                <span class="dnum">${d.d}</span>
                <span class="mon">${d.mon}</span>
              </button>`
    ).join("");
    $("days").querySelectorAll(".day").forEach((el) =>
      el.addEventListener("click", () => {
        state.date = el.dataset.iso;
        $("days").querySelectorAll(".day").forEach((x) => x.classList.remove("on"));
        el.classList.add("on");
        renderPeople();
        prefetchBusy(state.date);
        $("step-person").hidden = false;
        $("step-time").hidden = true;
        clearSlotSelection();
        $("step-person").scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
    );
  }

  function renderSlots() {
    $("slots").innerHTML = gridSlots(DAY_START, DAY_END, SLOT_MIN)
      .map((t) => {
        const free = isFree(t, SLOT_MIN, state.busy);
        return `<button class="slot${free ? "" : " taken"}" data-from="${t}"${free ? "" : " disabled"}>${t}</button>`;
      })
      .join("");
    $("slots").querySelectorAll(".slot:not([disabled])").forEach((el) =>
      el.addEventListener("click", () => pickSlot(el.dataset.from, addMinutes(el.dataset.from, state.dur), false, el))
    );
    $("evening-times").innerHTML = eveningTimes(EVENING_START, EVENING_END)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    clearSlotSelection();
  }

  function clearSlotSelection() {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => x.classList.remove("on"));
    $("evening-fields").hidden = true;
    $("step-dur").hidden = true;
    state.from = state.to = null;
    state.dur = SLOT_MIN;
    state.evening = false;
    $("step-who").hidden = true;
  }

  /* 15 / 30 / 45 — only the lengths that still fit before closing time. */
  function renderDurations() {
    const opts = durationsFor(state.from, DAY_END).filter((d) => isFree(state.from, d, state.busy));
    if (!opts.includes(state.dur)) state.dur = opts[0];
    state.to = addMinutes(state.from, state.dur);
    $("dur").innerHTML = opts
      .map((d) => `<button type="button" class="dur${d === state.dur ? " on" : ""}" data-min="${d}">${d} min</button>`)
      .join("");
    $("dur").querySelectorAll(".dur").forEach((el) =>
      el.addEventListener("click", () => {
        state.dur = Number(el.dataset.min);
        state.to = addMinutes(state.from, state.dur);
        $("dur").querySelectorAll(".dur").forEach((x) => x.classList.remove("on"));
        el.classList.add("on");
        $("dur-when").textContent = state.from + "–" + state.to;
      })
    );
    $("dur-when").textContent = state.from + "–" + state.to;
    $("step-dur").hidden = false;
  }

  function renderPeople() {
    $("people").innerHTML = PEOPLE.map(
      (p) => `<button type="button" class="person${p.id === state.person ? " on" : ""}" data-id="${p.id}">
                <span class="pn">${p.name}</span><span class="pr">${p.role}</span>
              </button>`
    ).join("");
    $("people").querySelectorAll(".person").forEach((el) =>
      el.addEventListener("click", async () => {
        state.person = el.dataset.id;
        $("people").querySelectorAll(".person").forEach((x) => x.classList.remove("on"));
        el.classList.add("on");
        const picked = state.person;
        clearSlotSelection();
        state.busy = [];
        $("step-time").hidden = false;
        renderSlots();                       // grid is usable immediately
        $("slots").classList.add("checking");
        $("step-time").scrollIntoView({ behavior: "smooth", block: "nearest" });
        const busy = await loadBusy(state.date, picked);
        if (state.person !== picked) return; // they changed their mind while we waited
        state.busy = busy;
        $("slots").classList.remove("checking");
        renderSlots();
      })
    );
  }

  function pickSlot(from, to, evening, el) {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => x.classList.remove("on"));
    if (el) el.classList.add("on");
    state.from = from;
    state.to = to;
    state.evening = evening;
    $("evening-fields").hidden = !evening;
    if (evening) {
      $("step-dur").hidden = true;
    } else {
      renderDurations();
    }
    $("step-who").hidden = false;
    if (!evening) $("step-who").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* Returns the parsed answer, or null when Google handed us an HTML error page. */
  async function fetchBooking(url) {
    try {
      const r = await fetch(url);
      const t = await r.text();
      return t.trim().startsWith("{") ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  }

  /* Availability of the chosen person for that day. A failure must not block booking —
     an empty list means "show everything", and the server still refuses a taken slot.
     Answers are cached per day+person and prefetched for the whole crew, so picking a
     person feels instant even though Apps Script needs a second or two to answer. */
  const busyCache = new Map();

  function loadBusy(date, person) {
    const key = date + "|" + person;
    if (busyCache.has(key)) return busyCache.get(key);
    const p = (async () => {
      if (ENDPOINT.startsWith("[[")) return [];
      try {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
        const r = await fetch(
          `${ENDPOINT}?action=free&date=${encodeURIComponent(date)}&person=${encodeURIComponent(person)}`,
          ctl ? { signal: ctl.signal } : {}
        );
        if (timer) clearTimeout(timer);
        const t = await r.text();
        if (!t.trim().startsWith("{")) return [];
        const out = JSON.parse(t);
        return out.ok && Array.isArray(out.busy) ? out.busy : [];
      } catch (e) {
        busyCache.delete(key);   // a hiccup must not be cached as "everything free"
        return [];
      }
    })();
    busyCache.set(key, p);
    return p;
  }

  /* Warm the cache for everybody the moment a day is picked — by the time the visitor
     has read the names, the answer is usually already in. */
  function prefetchBusy(date) {
    PEOPLE.forEach((p) => loadBusy(date, p.id));
  }

  function bookingFromForm() {
    return {
      name: $("f-name").value,
      company: $("f-company").value,
      email: $("f-email").value,
      phone: $("f-phone").value,
      note: $("f-note").value,
      date: state.date,
      from: state.from,
      to: state.to,
      minutes: state.evening ? 60 : state.dur,
      person: state.person,
      personName: (personById(state.person) || {}).name || "",
      personEmail: (personById(state.person) || {}).email || "",
      evening: state.evening,
      place: state.evening ? $("f-place").value.trim() : "",
      tz: TZ,
      source: "ifa-booking",
    };
  }

  function boot() {
    renderDays();

    $("evening-btn").addEventListener("click", () => {
      const t = $("evening-times").value || pad(EVENING_START) + ":00";
      const [h, m] = t.split(":").map(Number);
      const endH = m === 30 ? h + 1 : h + 1;
      const endM = m === 30 ? 30 : 0;
      pickSlot(t, pad(endH) + ":" + pad(endM), true, $("evening-btn"));
      $("f-place").focus();
    });
    $("evening-times").addEventListener("change", () => {
      if (state.evening) $("evening-btn").click();
    });

    $("form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const b = bookingFromForm();
      const err = validate(b);
      if (err.length) {
        $("msg").textContent =
          err.includes("place")
            ? "Podaj miejsce spotkania wieczorem."
            : err.includes("duration")
            ? "Wybierz długość spotkania, która mieści się przed zamknięciem targów."
            : err.includes("person")
            ? "Wybierz osobę do spotkania."
            : "Uzupełnij imię i nazwisko, firmę i adres e-mail.";
        $("msg").className = "msg bad";
        return;
      }
      const btn = $("send");
      btn.disabled = true;
      btn.textContent = "Sending…";
      $("msg").textContent = "";

      try {
        if (ENDPOINT.startsWith("[[")) throw new Error("no-endpoint");
        /* GET, not POST: Apps Script answers a POST with a 302 and WebKit re-issues it as a GET
           on /exec, so the booking never runs while the page still sees {"ok":true}.
           Google also serves an occasional HTML 404 instead of the script output — one retry. */
        const url = ENDPOINT + "?action=book&payload=" + encodeURIComponent(JSON.stringify(b));
        let out = await fetchBooking(url);
        if (!out) out = await fetchBooking(url);
        if (!out) throw new Error("network");
        if (!out.ok) throw new Error(out.reason || "failed");
        if (!out.booked) throw new Error("stale-backend");
        showDone(b);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Book the slot";
        $("msg").className = "msg bad";
        $("msg").textContent =
          e.message === "no-endpoint"
            ? "Backend nie jest jeszcze podpięty — wklej adres Apps Script w assets/app.js."
            : e.message === "taken"
            ? "Ten slot właśnie został zajęty. Wybierz inny."
            : e.message === "stale-backend"
            ? "Backend jest w starej wersji — rezerwacja nie została zapisana. Napisz do nas."
            : e.message === "network"
            ? "Google nie odpowiedział. Spróbuj jeszcze raz za chwilę."
            : "Nie udało się wysłać. Spróbuj ponownie albo napisz do nas.";
      }
    });
  }

  function showDone(b) {
    const day = DAYS.find((d) => d.iso === b.date);
    $("form-wrap").hidden = true;
    $("done").hidden = false;
    $("done-when").textContent =
      `${day.dow} ${day.d} ${day.mon} · ${b.from}–${b.to}` + (b.evening ? ` · ${b.place}` : "");
    $("done-who").textContent =
      b.person && b.person !== "any" ? `With ${b.personName}` : "We will assign the right person to your topic";
    $("done-cal").href = gcalLink(b);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

/* ---------- node (tests) ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DAYS, PEOPLE, personById, hourlySlots, gridSlots, durationsFor, overlaps, isFree, addMinutes, toMin,
    eveningTimes, validate, gcalLink, DAY_START, DAY_END, EVENING_START, EVENING_END, SLOT_MIN, DURATIONS };
}
