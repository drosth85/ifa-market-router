/* IFA 2026 — meeting booking, Monstelo × mobilki gsm.pl
   Static page + Google Apps Script backend (Sheet row + Calendar event).
   Single dependency on the backend: ENDPOINT below.

   Flow: pick day -> pick person -> pick a quarter and its length (or an evening slot)
   -> name/company/e-mail -> confirmation.
   Everything goes over GET: Apps Script answers a POST with a 302, and WebKit re-issues that
   redirect as a GET on /exec, so the booking silently never ran while the page saw {"ok":true}. */

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
  { id: "any",       slug: "",   name: "No preference",      role: "We assign the first colleague who is free", email: "" },
  { id: "mamcarczyk",slug: "mm", name: "Michał Mamcarczyk",  role: "Key Account Manager · EN · PL", email: "mm@monstelo.com" },
  { id: "tuchowska", slug: "nt", name: "Nikola Tuchowska",   role: "Key Account Manager · EN · PL", email: "nikola.tuchowska@monstelo.com" },
  { id: "tabak",     slug: "lt", name: "Łukasz Tabak",       role: "Key Account Manager · PL",      email: "lukasz.tabak@monstelo.com" },
  { id: "palka",     slug: "kp", name: "Kamil Pałka",        role: "Key Account Manager · PL · CZ", email: "kamil.palka@monstelo.com" },
  { id: "kocaba",    slug: "bk", name: "Błażej Kócaba",      role: "Key Account Manager · PL",      email: "blazej.kocaba@monstelo.com" },
  { id: "juszczyk",  slug: "sj", name: "Sebastian Juszczyk", role: "Board member · sourcing · PL · EN", email: "sebastian@monstelo.com" },
  { id: "drozd",     slug: "td", name: "Tomasz Drozd",       role: "Brand Growth Strategist · brands · PL · EN", email: "tomasz.drozd@monstelo.com" },
];
function personById(id) { return PEOPLE.find((p) => p.id === id) || null; }

/* Personal links to hand to a customer: …/spotkanie/?td, ?p=td or ?person=drozd.
   The whole "who you meet" step then disappears and the grid shows that person's free hours. */
function personFromQuery(search) {
  const q = String(search || "").replace(/^\?/, "");
  if (!q) return null;
  const keys = q.split("&").map((part) => decodeURIComponent(part.split("=").pop() || "").toLowerCase())
    .concat(q.split("&").map((part) => decodeURIComponent(part.split("=")[0] || "").toLowerCase()));
  for (const k of keys) {
    if (!k) continue;
    const hit = PEOPLE.find((p) => p.id !== "any" && (p.slug === k || p.id === k));
    if (hit) return hit;
  }
  return null;
}

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

/* Quarter-hours where nobody is free — one free colleague keeps the slot open. */
function allBusyQuarters(perPerson, startH, endH) {
  const out = [];
  const from = (startH == null ? 10 : startH) * 60;
  const to = (endH == null ? 18 : endH) * 60;
  for (let m = from; m < to; m += 15) {
    const everyoneBusy =
      perPerson.length > 0 &&
      perPerson.every((busy) => (busy || []).some((w) => toMin(w[0]) < m + 15 && m < toMin(w[1])));
    if (everyoneBusy) out.push([toHHMM(m), toHHMM(m + 15)]);
  }
  return out;
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
  if (!b.evening && b.from && b.to && !DURATIONS.includes(toMin(b.to) - toMin(b.from))) err.push("duration");
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
        clearSlotSelection();
        prefetchBusy(state.date);
        if (state.fixedPerson) {
          showSlotsFor(state.person);
          return;
        }
        renderPeople();
        $("step-person").hidden = false;
        /* "No preference" starts selected, so the hours must appear with it. Otherwise the only
           way forward is clicking a button that already looks chosen. */
        showSlotsFor(state.person);
        $("step-person").scrollIntoView({ behavior: motionPref(), block: "nearest" });
      })
    );
  }

  function renderSlots() {
    /* Split at lunchtime: 32 identical buttons in one block are hard to aim at, and everyone
       thinks about the fair day as "before lunch" and "after lunch" anyway. */
    const cell = (t) => {
      const free = isFree(t, SLOT_MIN, state.busy);
      return `<button class="slot${free ? "" : " taken"}" role="radio" aria-checked="false" data-from="${t}"${
        free ? "" : ' disabled title="Already booked"'
      }>${t}</button>`;
    };
    const all = gridSlots(DAY_START, DAY_END, SLOT_MIN);
    const morning = all.filter((t) => toMin(t) < 13 * 60);
    const afternoon = all.filter((t) => toMin(t) >= 13 * 60);
    $("slots").innerHTML =
      `<div class="slot-group"><span class="sg-label">Morning</span><div class="slot-grid">${morning
        .map(cell)
        .join("")}</div></div>` +
      `<div class="slot-group"><span class="sg-label">Afternoon</span><div class="slot-grid">${afternoon
        .map(cell)
        .join("")}</div></div>`;
    $("slots").querySelectorAll(".slot:not([disabled])").forEach((el) =>
      el.addEventListener("click", () => {
        if (el.classList.contains("on")) { clearSlotSelection(); return; }  // click again = undo
        pickSlot(el.dataset.from, addMinutes(el.dataset.from, state.dur), false, el);
      })
    );
    $("evening-times").innerHTML = eveningTimes(EVENING_START, EVENING_END)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    clearSlotSelection();
  }

  function clearSlotSelection() {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => x.classList.remove("on"));
    $("evening-fields").hidden = true;
    $("evening-block").hidden = false;
    $("slots").hidden = false;
    $("step-dur").hidden = true;
    state.from = state.to = null;
    state.dur = SLOT_MIN;
    state.evening = false;
    $("step-who").hidden = true;
    $("summary").hidden = true;
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
        renderSummary();
      })
    );
    $("dur-when").textContent = state.from + "–" + state.to;
    $("step-dur").hidden = false;
    renderSummary();
  }

  function renderPeople() {
    $("people").innerHTML = PEOPLE.map(
      (p) => `<button type="button" class="person${p.id === state.person ? " on" : ""}" role="radio" aria-checked="${p.id === state.person}" data-id="${p.id}">
                <span class="pn">${p.name}</span><span class="pr">${p.role}</span>
              </button>`
    ).join("");
    $("people").querySelectorAll(".person").forEach((el) =>
      el.addEventListener("click", () => {
        state.person = el.dataset.id;
        $("people").querySelectorAll(".person").forEach((x) => {
          x.classList.remove("on");
          x.setAttribute("aria-checked", "false");
        });
        el.classList.add("on");
        el.setAttribute("aria-checked", "true");
        clearSlotSelection();
        showSlotsFor(state.person);
      })
    );
  }

  function pickSlot(from, to, evening, el) {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => {
      x.classList.remove("on");
      x.setAttribute("aria-checked", "false");
    });
    if (el) { el.classList.add("on"); el.setAttribute("aria-checked", "true"); }
    state.from = from;
    state.to = to;
    state.evening = evening;
    $("evening-fields").hidden = !evening;
    // One choice at a time: an hour on the stand and an evening meeting are alternatives.
    $("evening-block").hidden = !evening;
    $("slots").hidden = evening;
    if (evening) {
      $("step-dur").hidden = true;
    } else {
      renderDurations();
    }
    $("step-who").hidden = false;
    renderSummary();
    if (!evening) $("step-who").scrollIntoView({ behavior: motionPref(), block: "nearest" });
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
  /* Respect the visitor's motion setting instead of always animating. */
  const motionPref = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  const dayCache = new Map();   // date -> promise of { person_id: busy[] } or null

  /* Availability is best effort. One request per day, one retry, then we stop trying:
     the grid stays usable and the server refuses a taken slot at booking time anyway.
     Everything fancier than this (per-person routes, layered caches, fallbacks) cost more
     in failure modes than it ever saved a visitor. */
  async function fetchDayOnce(date) {
    try {
      const r = await fetch(`${ENDPOINT}?action=free&date=${encodeURIComponent(date)}`);
      const t = await r.text();
      if (!t.trim().startsWith("{")) return null;
      const out = JSON.parse(t);
      return out.ok && out.people ? out.people : null;
    } catch (e) {
      return null;
    }
  }

  function loadDay(date) {
    if (dayCache.has(date)) return dayCache.get(date);
    const p = (async () => {
      if (ENDPOINT.startsWith("[[")) return null;
      const first = await fetchDayOnce(date);
      return first !== null ? first : await fetchDayOnce(date);
    })();
    dayCache.set(date, p);
    p.then((v) => { if (v === null) dayCache.delete(date); });
    return p;
  }

  /* Busy windows for one person — or, for "no preference", hours where nobody is free. */
  async function loadBusy(date, person) {
    const people = await loadDay(date);
    if (people === null) return null;
    if (person === "any") {
      const lists = PEOPLE.filter((x) => x.id !== "any").map((x) => people[x.id]).filter(Boolean);
      return lists.length ? allBusyQuarters(lists) : [];
    }
    return people[person] || [];
  }

  function prefetchBusy(date) {
    loadDay(date);
  }

  /* Paints the grid straight away, then dims what the calendar says is taken. */
  function setSlotStatus(text, warn) {
    const el = $("slots-status");
    el.textContent = text || "";
    el.classList.toggle("warn", !!warn);
    el.hidden = !text;
  }

  async function showSlotsFor(picked) {
    state.busy = [];
    $("step-time").hidden = false;
    renderSlots();
    setSlotStatus("Checking free hours…", false);
    $("step-time").scrollIntoView({ behavior: motionPref(), block: "nearest" });
    const busy = await loadBusy(state.date, picked);
    if (state.person !== picked) return;   // they changed their mind while we waited
    if (busy === null) {
      // Calendar unreachable: show every hour. The server still refuses a slot that is taken.
      setSlotStatus("", false);
      return;
    }
    setSlotStatus("", false);
    state.busy = busy;
    renderSlots();
  }

  /* What the visitor is about to book, in one line above the button. */
  function renderSummary() {
    const day = DAYS.find((d) => d.iso === state.date);
    if (!day || !state.from) { $("summary").hidden = true; return; }
    const who = personById(state.person);
    const whoLabel = state.person === "any" ? "first colleague free" : who.name;
    $("summary").innerHTML =
      `<b>${day.dow} ${day.d} ${day.mon}</b> · ${state.from}–${state.to}` +
      (state.evening ? ` · evening${state.place ? ", " + state.place : ""}` : "") +
      ` · with <b>${whoLabel}</b> <span class="tz">Berlin time</span>`;
    $("summary").hidden = false;
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

  /* Apps Script spins its container down when idle: the first call then takes 15-18 s.
     A ping the moment the page opens wakes it while the visitor is still reading. */
  function wakeBackend() {
    if (ENDPOINT.startsWith("[[")) return;
    try { fetch(ENDPOINT, { cache: "no-store" }).catch(() => {}); } catch (e) {}
  }

  function boot() {
    wakeBackend();
    const fixed = personFromQuery(location.search);
    if (fixed) {
      state.person = fixed.id;
      state.fixedPerson = true;
      $("step-person").hidden = true;
      $("with-line").hidden = false;
      $("with-name").textContent = fixed.name;
      $("with-role").textContent = fixed.role;
      $("h-time").innerHTML = '2 · Time <span class="tzhead">all times Berlin · CEST</span>';
      $("h-you").textContent = "3 · You";
      document.title = "Book a slot with " + fixed.name + " — IFA 2026";
    }
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
      ["f-name", "f-company", "f-email", "f-place"].forEach((id) => $(id).classList.remove("bad"));
      if (err.includes("name")) $("f-name").classList.add("bad");
      if (err.includes("company")) $("f-company").classList.add("bad");
      if (err.includes("email")) $("f-email").classList.add("bad");
      if (err.includes("place")) $("f-place").classList.add("bad");
      if (err.length) {
        $("msg").textContent =
          err.includes("place")
            ? "Tell us where the evening meeting should be."
            : err.includes("duration")
            ? "Pick a length that still fits before the show closes."
            : err.includes("person")
            ? "Pick who you want to meet."
            : err.includes("email")
            ? "That e-mail address does not look right."
            : "Add your name, company and work e-mail.";
        $("msg").className = "msg bad";
        return;
      }
      const btn = $("send");
      btn.disabled = true;
      btn.textContent = "Booking…";
      $("msg").textContent = "";

      try {
        if (ENDPOINT.startsWith("[[")) throw new Error("no-endpoint");
        /* GET, not POST: Apps Script answers a POST with a 302 and WebKit re-issues it as a GET
           on /exec, so the booking never runs while the page still sees {"ok":true}.
           Google also serves an occasional HTML 404 instead of the script output — one retry. */
        /* One nonce per attempt, kept across the retry: if Google loses the answer after the
           booking went through, the retry gets that same answer instead of a second meeting. */
        b.nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const url = ENDPOINT + "?action=book&payload=" + encodeURIComponent(JSON.stringify(b));
        let out = await fetchBooking(url);
        if (!out) out = await fetchBooking(url);
        if (!out) throw new Error("network");
        if (!out.ok) throw new Error(out.reason || "failed");
        if (!out.booked) throw new Error("stale-backend");
        if (out.assigned && out.person) { b.personName = out.person; b.assigned = true; }
        showDone(b);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Book the slot";
        $("msg").className = "msg bad";
        $("msg").textContent =
          e.message === "no-endpoint"
            ? "Booking is not connected yet. Write to us and we will hold the slot."
            : e.message === "taken"
            ? "That slot has just been taken. Pick another one."
            : e.message === "stale-backend"
            ? "The booking did not save. Write to us and we will hold the slot."
            : e.message === "network"
            ? "No answer from the server. Try again in a moment."
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
    $("done-who").textContent = b.assigned
      ? `With ${b.personName} — the colleague free at that hour`
      : b.person && b.person !== "any"
      ? `With ${b.personName}`
      : "We will assign the right person to your topic";
    $("done-cal").href = gcalLink(b);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

/* ---------- node (tests) ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DAYS, PEOPLE, personById, personFromQuery, allBusyQuarters, hourlySlots, gridSlots, durationsFor, overlaps, isFree, addMinutes, toMin,
    eveningTimes, validate, gcalLink, DAY_START, DAY_END, EVENING_START, EVENING_END, SLOT_MIN, DURATIONS };
}
