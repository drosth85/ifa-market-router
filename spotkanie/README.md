# Umów spotkanie na stoisku — IFA 2026

Statyczna strona + Google Apps Script jako backend. Zero hostingu poza GitHub Pages, zero kosztów.

**Live:** https://drosth85.github.io/ifa-market-router/spotkanie/

## Co robi

Odwiedzający wybiera dzień targów (4–8.09.2026) → godzinny slot 10:00–18:00 **albo** „Evening after the
show" (18:00–23:00 co 30 min + pole na miejsce) → podaje imię i nazwisko, firmę, e-mail (telefon i temat
opcjonalnie) → dostaje potwierdzenie i przycisk „Add to Google Calendar".

Po stronie Google jedno zgłoszenie daje trzy rzeczy:
1. wiersz w Arkuszu (`Bookings`),
2. wydarzenie w Kalendarzu z zaproszeniem wysłanym na adres gościa,
3. mail potwierdzający do gościa (opcjonalnie kopia do Ciebie).

Sloty na stoisku są blokowane — drugie zgłoszenie na tę samą godzinę dostaje „ten slot właśnie został
zajęty". Spotkania wieczorne nie blokują niczego, bo są poza stoiskiem.

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

**`assets/app.js`** — godziny i dni:
- `DAY_START` / `DAY_END` = 10 / 18 — **do potwierdzenia z oficjalnymi godzinami otwarcia IFA**
- `EVENING_START` / `EVENING_END` = 18 / 23
- `DAYS` — pięć dni targowych

**`apps-script/Code.gs`**:
- `CALENDAR_ID` — `'primary'` albo id kalendarza współdzielonego, jeśli spotkania mają widzieć wszyscy na stoisku
- `NOTIFY` — Twój adres, żeby dostawać kopię każdej rezerwacji

## Testy

```
node test-logic.js
```

23 asercje: zakres dni, ciągłość slotów, walidacja formularza, poprawność linku do Google Calendar.

## Limity, o których warto wiedzieć

- Gmail przez Apps Script: 100 maili/dobę na koncie darmowym. Na targach spokojnie wystarczy.
- Arkusz jest źródłem prawdy — jeśli Kalendarz padnie, lead i tak się zapisze (błąd ląduje w kolumnie `error`).
- Strona nie pokazuje zajętych slotów z góry; kolizję wykrywa dopiero przy wysyłce. Świadome uproszczenie —
  odczyt zajętości wymagałby drugiego wywołania i obejścia CORS.
