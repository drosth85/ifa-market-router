# Dostępność w narzędziu do umawiania spotkań — opcje

Stan na 2026-08-26. Wymóg użytkownika: **liczy się wyłącznie szybkość**; w dniu targowym dane
mogą być nieświeże **1–5 minut**, nie więcej.

## Dlaczego dziś jest wolno (zmierzone)

| Co | Czas |
|---|---|
| Wywołanie Apps Script, które nic nie robi (ping) | 1,4–1,7 s |
| Odczyt 7 kalendarzy wewnątrz skryptu | ~0,5 s (kalendarz 188 ms, odczyt dnia 471 ms) |
| Zapytanie o dostępność, ciepły kontener | 1,2–6,6 s |
| To samo po bezczynności (zimny start) | 16–18 s, czasem HTML 404 zamiast odpowiedzi |

**Wniosek: wąskim gardłem jest samo wywołanie Apps Script, nie liczenie dostępności.**
Dostrajanie backendu nie zejdzie poniżej ~1,5 s. Żeby było szybko, strona nie może pytać Google
w czasie rzeczywistym — albo źródłem prawdy nie może być Kalendarz Google.

---

## Opcja A — migawka na GitHub Pages, odświeżana przez Apps Script *(zaprojektowana, gotowa do wdrożenia)*

Wyzwalacz czasowy w Apps Script chodzi co minutę, czyta 7 kalendarzy **raz dla całego tygodnia
targowego** (7 odczytów, nie 35) i wypycha `avail.json` do repo `ifa-market-router` przez API
GitHuba. Strona czyta ten plik z Pages — ten sam serwer, CDN, bez przekierowań.

- **Szybkość:** dziesiątki milisekund.
- **Świeżość:** do 1 minuty w godzinach targowych (funkcja rusza tylko w dni targowe 9:45–18:15,
  poza oknem kończy się natychmiast).
- **Limity Google:** ~480 pełnych przebiegów dziennie × 3 s ≈ 25 min z 90 min dobowego limitu
  wyzwalaczy. Commit tylko przy zmianie treści.
- **Koszt:** 0 zł. Bez nowego hostingu.
- **Wymaga:** fine-grained token GitHub (`Contents: write`, wyłącznie repo `ifa-market-router`,
  z datą wygaśnięcia) w Właściwościach skryptu. Sekret poza kodem i poza gitem.
- **Ryzyko:** wyciek tokenu = nadpisanie plików w publicznym repo z materiałami targowymi.
  Zero dostępu do konta Google, kalendarzy, poczty.
- **Praca:** ~60 linii w `Code.gs`, ~25 w `app.js`, test świeżości. Po stronie użytkownika:
  token, wklejenie kodu, wdrożenie, uruchomienie `installSnapshot()`.
- **Bezpiecznik:** brak pliku lub plik starszy niż 10 minut → strona wraca do odczytu na żywo.

## Opcja B — model Partner Tele: własna baza jako źródło prawdy

Wzorzec z `meet-us.partnertele.com`: statyczny HTML na zwykłym hostingu, `check_slot.php?date=…`
zwraca `{options, taken}` z własnej bazy, `submit.php` zapisuje i sprawdza kolizję ponownie,
panel `/admin/` do obsługi. Kalendarz Google przestaje być źródłem dostępności — staje się
**wyjściem**: po zapisie rezerwacji serwer woła istniejący endpoint Apps Script, który zakłada
wydarzenie w kalendarzu handlowca i wysyła zaproszenie.

- **Szybkość:** ~100 ms, bez zależności od Google przy odczycie.
- **Świeżość:** natychmiastowa dla rezerwacji z formularza.
- **Słaby punkt:** spotkanie **wpisane ręcznie w Kalendarzu Google nie zablokuje slotu**,
  dopóki nie dołożymy cyklicznego dociągania z kalendarzy do bazy (co wraca do problemu z Opcji A,
  tyle że po stronie hostingu — tam cron chodzi punktualnie i bez limitu 90 minut).
- **Wymaga:** hostingu z PHP i bazą (SQLite wystarczy). Monstelo dziś takiego nie ma pod ręką —
  sklep stoi na IdoSell.
- **Praca:** przepisanie backendu (formularz, kolizje, panel), ~1–2 dni.

## Opcja C — Calendly / Cal.com, po jednym linku na handlowca

Każdy z siódemki zakłada darmowe konto, podpina swój kalendarz Google, ustawia dostępność na
4–8.09. Nasza strona zostaje jako rozdzielacz „wybierz osobę" i przerzuca na jej stronę rezerwacji.

- **Szybkość i świeżość:** natychmiast, dwukierunkowa synchronizacja z Kalendarzem Google
  w standardzie, do tego strefy czasowe, przypomnienia, przekładanie i odwoływanie spotkań.
- **Koszt:** 0 zł za linki imienne (plan darmowy = 1 typ zdarzenia na osobę, a my potrzebujemy
  jednego). **Automatyczny przydział „pierwsza wolna osoba" (round-robin) jest płatny** —
  ok. 16 USD/mies. za użytkownika, czyli ~450 zł za miesiąc dla siedmiu osób.
- **Tracimy:** własny wygląd, „Evening after the show", nasz przepływ dzień → osoba → godzina,
  zbieranie leadów do naszego Arkusza (są webhooki, ale to znów integracja).
- **Praca:** 7 × 5 minut konfiguracji, zero kodu.

## Opcja D — Google Appointment Schedules

Wbudowane w Kalendarz Google, ale **tylko w płatnym Workspace**. Konto Monstelo to zwykły Gmail —
odpada bez migracji na Workspace.

---

## Rekomendacja

**Opcja A**, jeśli ma zostać nasz przepływ i nasz wygląd: jedyna, która daje minutę świeżości,
zero kosztów i zero nowego hostingu, kosztem jednego tokenu o wąskim zasięgu.

**Opcja C**, jeśli priorytetem jest „ma po prostu działać i nie wymagać opieki": za darmo,
pod warunkiem rezygnacji z automatycznego przydziału przy „No preference".

Opcja B ma sens dopiero wtedy, gdy narzędzie ma żyć po targach i obsługiwać więcej niż pięć dni —
wtedy własna baza przestaje być kosztem, a staje się fundamentem.
