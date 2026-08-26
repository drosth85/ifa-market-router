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

// siatka 15-minutowa i długości spotkań
const grid = A.gridSlots(A.DAY_START, A.DAY_END, A.SLOT_MIN);
ok(A.SLOT_MIN === 15, "siatka co 15 minut");
ok(grid.length === (A.DAY_END - A.DAY_START) * 60 / A.SLOT_MIN, "liczba startów = dzień / 15 min");
ok(grid[0] === "10:00" && grid[1] === "10:15", "starty co kwadrans od otwarcia");
ok(grid[grid.length - 1] === "17:45", "ostatni start mieści 15 min przed zamknięciem");
ok(A.addMinutes("17:45", 15) === "18:00", "dodawanie minut przechodzi przez pełną godzinę");
ok(JSON.stringify(A.DURATIONS) === JSON.stringify([15, 30, 45]), "trzy długości spotkania");
ok(A.durationsFor("17:45", A.DAY_END).join() === "15", "przy zamknięciu zostaje tylko 15 min");
ok(A.durationsFor("17:15", A.DAY_END).join() === "15,30,45", "wcześniej dostępne wszystkie długości");
ok(A.durationsFor("17:30", A.DAY_END).join() === "15,30", "45 min znika, gdy nie mieści się przed 18:00");

// kolizje = nachodzenie, nie identyczny start
ok(A.overlaps("10:00", "10:45", "10:30", "10:45"), "spotkania nachodzące wykryte");
ok(!A.overlaps("10:00", "10:15", "10:15", "10:30"), "styk koniec-początek to nie kolizja");
ok(!A.overlaps("10:00", "10:15", "11:00", "11:15"), "rozłączne sloty bez kolizji");

// lista osób ze stoiska
ok(A.PEOPLE[0].id === "any", "pierwsza opcja to brak preferencji");
ok(A.PEOPLE.length >= 7, "lista osób z katalogu Monstelo");
ok(A.PEOPLE.slice(1).every(p => /@monstelo\.com$/.test(p.email)), "każda osoba ma firmowy mail");
ok(A.PEOPLE.slice(1).every(p => p.role && p.name), "każda osoba ma imię i rolę");
ok(new Set(A.PEOPLE.map(p => p.id)).size === A.PEOPLE.length, "identyfikatory osób unikalne");
ok(A.personById("drozd").name === "Tomasz Drozd", "wyszukiwanie osoby po id");
ok(A.personById("nikt") === null, "nieznane id zwraca null");

// wolne/zajete kwadranse
const busy = [["11:00","11:30"],["14:15","14:30"]];
ok(A.isFree("10:00", 15, busy), "kwadrans poza zajetoscia jest wolny");
ok(!A.isFree("11:00", 15, busy), "start w zajetym oknie odrzucony");
ok(!A.isFree("11:15", 15, busy), "srodek zajetego okna odrzucony");
ok(A.isFree("11:30", 15, busy), "start w chwili konca zajetosci jest wolny");
ok(!A.isFree("10:45", 30, busy), "dluzsze spotkanie wchodzace w zajetosc odrzucone");
ok(A.isFree("10:45", 15, busy), "krotsze spotkanie przed zajetoscia przechodzi");
ok(A.isFree("09:00", 45, []), "brak zajetosci = wszystko wolne");

// linki personalne
ok(A.personFromQuery("?td").id === "drozd", "?td wybiera Tomasza Drozda");
ok(A.personFromQuery("?p=td").id === "drozd", "?p=td dziala tak samo");
ok(A.personFromQuery("?person=drozd").id === "drozd", "pelne id tez dziala");
ok(A.personFromQuery("?lt").id === "tabak", "?lt to Lukasz Tabak");
ok(A.personFromQuery("") === null, "brak parametru = wybor osoby jak dotad");
ok(A.personFromQuery("?xx") === null, "nieznany skrot ignorowany");
ok(A.personFromQuery("?any") === null, "'any' nie jest linkiem personalnym");
ok(new Set(A.PEOPLE.filter(p=>p.slug).map(p=>p.slug)).size === A.PEOPLE.filter(p=>p.slug).length, "skroty unikalne");
ok(A.PEOPLE.filter(p=>p.id!=="any").every(p=>/^[a-z]{2}$/.test(p.slug)), "kazdy handlowiec ma dwuliterowy skrot");

// walidacja
const good = { name: "Jan Kowalski", company: "Acme", email: "jan@acme.com",
               date: "2026-09-05", from: "11:00", to: "11:15", person: "tabak", evening: false };
ok(A.validate(good).length === 0, "poprawna rezerwacja przechodzi");
ok(A.validate({ ...good, email: "nie-mail" }).includes("email"), "zły e-mail odrzucony");
ok(A.validate({ ...good, company: "" }).includes("company"), "brak firmy odrzucony");
ok(A.validate({ ...good, name: "Ja" }).includes("name"), "za krótkie imię odrzucone");
ok(A.validate({ ...good, date: "2026-09-09" }).includes("date"), "dzień spoza targów odrzucony");
ok(A.validate({ ...good, evening: true, place: "" }).includes("place"), "wieczór bez miejsca odrzucony");
ok(A.validate({ ...good, evening: true, place: "Hotel bar", to: "12:00" }).length === 0, "wieczór z miejscem przechodzi");
ok(A.validate({ ...good, person: "" }).includes("person"), "brak wybranej osoby odrzucony");
ok(A.validate({ ...good, person: "ktos-obcy" }).includes("person"), "osoba spoza listy odrzucona");
ok(A.validate({ ...good, person: "any" }).length === 0, "brak preferencji jest poprawnym wyborem");
ok(A.validate({ ...good, to: "11:45" }).length === 0, "45 minut przechodzi");
ok(A.validate({ ...good, to: "12:00" }).includes("duration"), "60 minut poza listą długości");
ok(A.validate({ ...good, from: "17:45", to: "18:15" }).includes("duration"), "spotkanie po zamknięciu odrzucone");
ok(A.validate({ ...good, from: "11:15", to: "11:00" }).includes("slot"), "koniec przed początkiem odrzucony");

// link do kalendarza
const link = A.gcalLink(good);
ok(link.includes("dates=20260905T110000%2F20260905T111500"), "poprawny zakres dat w linku");
ok(A.gcalLink({ ...good, personName: "Łukasz Tabak" }).includes("With"), "link niesie informację z kim spotkanie");
ok(!A.gcalLink({ ...good, person: "any", personName: "No preference" }).includes("With%3A"), "brak preferencji nie trafia do opisu");
ok(link.includes("ctz=Europe%2FBerlin"), "strefa czasowa Berlin");
ok(link.includes("H27E-17"), "domyślna lokalizacja to nasze stoisko");
ok(A.gcalLink({ ...good, evening: true, place: "Hotel bar" }).includes("Hotel+bar"), "wieczorem lokalizacja z pola miejsce");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
