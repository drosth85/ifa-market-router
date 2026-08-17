/* IFA 2026 — meeting booking, Monstelo × mobilki gsm.pl
   Static page + Google Apps Script backend (Sheet row + Calendar event).
   Single dependency on the backend: ENDPOINT below.

   Flow: pick day -> pick hourly slot (or evening) -> name/company/e-mail -> POST -> confirmation.
   The POST is a "simple request" (text/plain) on purpose: Apps Script does not answer
   CORS preflight, so any JSON content-type would fail in the browser. */

const ENDPOINT = "[[BOOKING_ENDPOINT]]"; // paste the Apps Script /exec URL after deploying

// Fair days. Booth H27E-17, Reseller Park.
const DAYS = [
  { iso: "2026-09-04", dow: "Fri", d: "4", mon: "Sep" },
  { iso: "2026-09-05", dow: "Sat", d: "5", mon: "Sep" },
  { iso: "2026-09-06", dow: "Sun", d: "6", mon: "Sep" },
  { iso: "2026-09-07", dow: "Mon", d: "7", mon: "Sep" },
  { iso: "2026-09-08", dow: "Tue", d: "8", mon: "Sep" },
];

// Show floor hours -> hourly slots. Confirm against the official IFA opening hours before print.
const DAY_START = 10;
const DAY_END = 18;

// Evening slots, for "after the show" meetings.
const EVENING_START = 18;
const EVENING_END = 23;

const TZ = "Europe/Berlin";

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
    details: "Meeting with Monstelo × Mobilki GSM at IFA Berlin 2026.\nStand H27E-17, Reseller Park.",
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
  if (b.evening && !b.place) err.push("place");
  return err;
}

/* ---------- browser ---------- */
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const state = { date: null, from: null, to: null, evening: false, place: "" };

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
        $("step-time").hidden = false;
        renderSlots();
        $("step-time").scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
    );
  }

  function renderSlots() {
    const slots = hourlySlots(DAY_START, DAY_END);
    $("slots").innerHTML = slots
      .map((s) => `<button class="slot" data-from="${s.from}" data-to="${s.to}">${s.from}</button>`)
      .join("");
    $("slots").querySelectorAll(".slot").forEach((el) =>
      el.addEventListener("click", () => pickSlot(el.dataset.from, el.dataset.to, false, el))
    );
    $("evening-times").innerHTML = eveningTimes(EVENING_START, EVENING_END)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    clearSlotSelection();
  }

  function clearSlotSelection() {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => x.classList.remove("on"));
    $("evening-fields").hidden = true;
    state.from = state.to = null;
    state.evening = false;
    $("step-who").hidden = true;
  }

  function pickSlot(from, to, evening, el) {
    document.querySelectorAll(".slot,.evening-toggle").forEach((x) => x.classList.remove("on"));
    if (el) el.classList.add("on");
    state.from = from;
    state.to = to;
    state.evening = evening;
    $("evening-fields").hidden = !evening;
    $("step-who").hidden = false;
    if (!evening) $("step-who").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(b),
        });
        const out = await r.json();
        if (!out.ok) throw new Error(out.reason || "failed");
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
    $("done-cal").href = gcalLink(b);
  }

  document.addEventListener("DOMContentLoaded", boot);
}

/* ---------- node (tests) ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DAYS, hourlySlots, eveningTimes, validate, gcalLink, DAY_START, DAY_END, EVENING_START, EVENING_END };
}
