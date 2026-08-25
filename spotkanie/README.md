# Umów spotkanie na stoisku — IFA 2026

Statyczna strona + Google Apps Script jako backend. Zero hostingu poza GitHub Pages, zero kosztów.

**Live:** https://drosth85.github.io/ifa-market-router/spotkanie/

## Co robi

Odwiedzający wybiera dzień targów (4–8.09.2026) → **kwadrans startowy** (10:00–18:00, siatka co 15 min)
→ **długość spotkania: 15 / 30 / 45 minut** (pokazywane są tylko te, które mieszczą się przed zamknięciem)
**albo** „Evening after the show" (18:00–23:00 co 30 min + pole na miejsce) → **osobę do spotkania**
(lista z katalogu Monstelo albo „No preference") → podaje imię i nazwisko, firmę, e-mail
(telefon i temat opcjonalnie) → dostaje potwierdzenie i przycisk „Add to Google Calendar".

Po stronie Google jedno zgłoszenie daje trzy rzeczy:
1. wiersz w Arkuszu (`Bookings`),
2. **wydarzenie w Kalendarzu z zaproszeniem dla gościa I dla wybranej osoby ze stoiska** — dzięki temu
   spotkanie trafia do jej własnego kalendarza, bez żadnej dodatkowej integracji,
3. mail potwierdzający do gościa (+ kopia do wybranej osoby i na adres z `NOTIFY`).

**Kolizje liczone są jako nachodzenie przedziałów, nie identyczny start.** Osoba wybrana z listy jest
zajęta, jeśli jakiekolwiek jej spotkanie na stoisku nachodzi na wybrany czas. „No preference" blokuje
się dopiero, gdy w danym oknie zajęte są wszystkie stoliki (`STAND_TABLES`, domyślnie 2).
Spotkania wieczorne nie blokują niczego, bo są poza stoiskiem.

**Lista osób** jest w dwóch miejscach i musi się zgadzać: `assets/app.js` (`PEOPLE`, to co widzi
odwiedzający) oraz `apps-script/Code.gs` (`PEOPLE`, adresy używane do zaproszeń — backend nie ufa
temu, co przyszło z przeglądarki, żeby podrobiony request nie rozsyłał zaproszeń w naszym imieniu).

## Uruchomienie — 5 kroków

1. Nowy Arkusz Google (dowolna nazwa) → **Rozszerzenia → Apps Script**.
2. Wklej zawartość `apps-script/Code.gs`, zapisz.
3. Góra strony: **Wdróż → Nowe wdrożenie → Aplikacja internetowa**.
   - *Wykonaj jako:* **ja**
   - *Kto ma dostęp:* **wszyscy** ← bez tego formularz dostanie 401
4. Skopiuj adres kończący się na `/exec`.
5. Wklej go w `assets/app.js` w miejsce `[[BOOKING_ENDPOINT]]`, wypchnij na Pages.

Przy pierwszym wdrożeniu Google poprosi o zgody (Arkusz, Kalendarz, Gmail) — to normalne, skrypt jest Twój.

Sprawdzenie: wejdź na adres `/exec` w przeglądarce — powinno pokazać `{"ok":true,"service":"ifa-booking"}`.

## Konfiguracja

**`assets/app.js`** — godziny, dni, ludzie:
- `DAY_START` / `DAY_END` = 10 / 18 — **do potwierdzenia z oficjalnymi godzinami otwarcia IFA**
- `SLOT_MIN` = 15 — gęstość siatki startów; `DURATIONS` = [15, 30, 45]
- `EVENING_START` / `EVENING_END` = 18 / 23
- `DAYS` — pięć dni targowych
- `PEOPLE` — lista osób do wyboru (id, imię, rola, mail)

**`apps-script/Code.gs`**:
- `CALENDAR_ID` — `'primary'` albo id kalendarza współdzielonego, jeśli spotkania mają widzieć wszyscy na stoisku
- `NOTIFY` — Twój adres, żeby dostawać kopię każdej rezerwacji
- `PEOPLE` — ta sama lista co w `app.js`, z adresami (to one dostają zaproszenie)
- `STAND_TABLES` — ile spotkań naraz mieści stoisko przy wyborze „No preference"

## Testy

```
node test-logic.js
```

51 asercji: zakres dni, siatka 15-minutowa, długości spotkań przy zamknięciu, wykrywanie nachodzenia,
lista osób, walidacja formularza, poprawność linku do Google Calendar.

## Limity, o których warto wiedzieć

- Gmail przez Apps Script: 100 maili/dobę na koncie darmowym. Na targach spokojnie wystarczy.
- Arkusz jest źródłem prawdy — jeśli Kalendarz padnie, lead i tak się zapisze (błąd ląduje w kolumnie `error`).
- Strona nie pokazuje zajętych slotów z góry; kolizję wykrywa dopiero przy wysyłce. Świadome uproszczenie —
  odczyt zajętości wymagałby drugiego wywołania i obejścia CORS.
- Zaproszenie trafia do kalendarza osoby ze stoiska jako *gość* wydarzenia — właścicielem pozostaje konto,
  na którym wdrożono skrypt. Jeśli spotkania mają być własnością wspólnego kalendarza zespołu,
  ustaw `CALENDAR_ID` na kalendarz współdzielony i daj tym osobom prawo zapisu.
- **WebKit:** kod przeglądarkowy w `app.js` musi zostać opakowany w funkcję (`(function(){…})()`).
  Zwykły blok `if (...) { … }` z deklaracjami funkcji i `const` działa w Chrome, ale w Safari/iOS
  wywala `Can't find variable: $` i strona renderuje się pusta.
