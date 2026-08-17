/* node test-logic.js — statyczne asercje dla formularza spotkań. */
const A = require("./assets/app.js");
let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log("  FAIL:", label)); };

// dni targów
ok(A.DAYS.length === 5, "5 dni targowych");
ok(A.DAYS[0].iso === "2026-09-04" && A.DAYS[4].iso === "2026-09-08", "zakres 4–8.09.2026");
ok(A.DAYS.every(d => d.iso.startsWith("2026-09")), "wszystkie dni we wrześniu 2026");
ok(A.DAYS[0].dow === "Fri" && A.DAYS[1].dow === "Sat" && A.DAYS[4].dow === "Tue", "dni tygodnia zgodne z kalendarzem");

// sloty godzinne
const slots = A.hourlySlots(A.DAY_START, A.DAY_END);
ok(slots.length === A.DAY_END - A.DAY_START, "liczba slotów = długość dnia targowego");
ok(slots[0].from === "10:00" && slots[0].to === "11:00", "pierwszy slot 10:00–11:00");
ok(slots[slots.length - 1].to === "18:00", "ostatni slot kończy się o zamknięciu");
ok(slots.every((s, i) => i === 0 || s.from === slots[i - 1].to), "sloty stykają się bez dziur");
ok(slots.every(s => /^\d{2}:00$/.test(s.from)), "sloty pełnogodzinne");

// wieczór
const ev = A.eveningTimes(A.EVENING_START, A.EVENING_END);
ok(ev[0] === "18:00", "wieczór startuje po zamknięciu targów");
ok(ev[ev.length - 1] === "23:00", "wieczór kończy się o 23:00");
ok(ev.includes("20:30"), "wieczór ma sloty półgodzinne");

// walidacja
const good = { name: "Jan Kowalski", company: "Acme", email: "jan@acme.com",
               date: "2026-09-05", from: "11:00", to: "12:00", evening: false };
ok(A.validate(good).length === 0, "poprawna rezerwacja przechodzi");
ok(A.validate({ ...good, email: "nie-mail" }).includes("email"), "zły e-mail odrzucony");
ok(A.validate({ ...good, company: "" }).includes("company"), "brak firmy odrzucony");
ok(A.validate({ ...good, name: "Ja" }).includes("name"), "za krótkie imię odrzucone");
ok(A.validate({ ...good, date: "2026-09-09" }).includes("date"), "dzień spoza targów odrzucony");
ok(A.validate({ ...good, evening: true, place: "" }).includes("place"), "wieczór bez miejsca odrzucony");
ok(A.validate({ ...good, evening: true, place: "Hotel bar" }).length === 0, "wieczór z miejscem przechodzi");

// link do kalendarza
const link = A.gcalLink(good);
ok(link.includes("dates=20260905T110000%2F20260905T120000"), "poprawny zakres dat w linku");
ok(link.includes("ctz=Europe%2FBerlin"), "strefa czasowa Berlin");
ok(link.includes("H27E-17"), "domyślna lokalizacja to nasze stoisko");
ok(A.gcalLink({ ...good, evening: true, place: "Hotel bar" }).includes("Hotel+bar"), "wieczorem lokalizacja z pola miejsce");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
