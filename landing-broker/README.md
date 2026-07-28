# IFA 2026 — Lead-gen landing

Statyczny one-pager na targi IFA (stoisko H27E-17). **Ruch = QR na stoisku → telefon**, ~30 s uwagi
w hałasie hali. Cel: kwalifikowany lead (mail + który deck) i deck w ręce, zanim odejdzie od stoiska.
Styl Black Book, język EN, głos **KIERUNKU B** („Win the market").

Spec: `../docs/superpowers/specs/2026-07-22-ifa-lead-landing-design.md`
Plan: `../docs/superpowers/plans/2026-07-22-ifa-lead-landing.md`

## Taksonomia oferty — ŹRÓDŁO PRAWDY
Dwa kierunki handlu, po dwie oferty w każdym. Tak dzieli to biznes i tak dzieli to strona:

| Kierunek | Oferta | Właściciel | Deck |
|---|---|---|---|
| **HURT** — kupujesz od nas | Elektronika | Monstelo | `katalog-monstelo.pdf` |
| **HURT** — kupujesz od nas | Telefony (nowe + refurb, grading) | Mobilki GSM | `katalog-mobilki.pdf` |
| **DETAL** — sprzedajemy twoje | Hub logistyczny | Monstelo | `ulotka-hub-logistyczny.pdf` |
| **DETAL** — sprzedajemy twoje | Obsługa marek | Monstelo | `ulotka-obsluga-marki.pdf` |

W kodzie: `SIDES` w `assets/app.js` (`key: "buy" | "sell"`). Test pilnuje tego podziału — jeśli
ktoś przełoży ofertę do złego kierunku, `test-logic.js` padnie.

## Pliki
- `index.html` — cała narracja strony
- `assets/app.js` — `SIDES`/`OFFERS`, wybór oferty → formularz → reveal, `FORM_ENDPOINT`
- `assets/style.css` — tokeny Black Book (1:1 z `../materialy-drukowane/`)
- `offers/*.pdf` — 4 decki (kopie z `../materialy-drukowane/`; zmiana = podmiana w OBU miejscach)
- `assets/covers/*.jpg` — okładki decków (regeneracja niżej)
- `test-logic.js` — dane + statyka bez zależności: `node test-logic.js` (taksonomia, pliki, dyscyplina copy)
- `test-flow.js` — interakcja w prawdziwym DOM (Chrome headless, `fetch` zastubowany): `node test-flow.js`

## Narracja — gramatyka ścian stoiska
Strona mówi tak, jak ściany boxu: **WIELKA ETYKIETA + jedna linia + przycisk.** Zero akapitów,
zero opowieści. Kolejność: kim jesteśmy (hero) → gdzie sprzedajemy → cztery oferty → trzy fakty →
formularz.

1. **Hero = lewa ściana:** `WIN THE MARKET.` + „Data-driven commerce across Europe's marketplaces"
   + linia liczb. Nic więcej.
2. **Pasek marketplace'ów** — dowód w jednej linii.
3. **Cztery oferty = prawa ściana**, w dwóch grupach (`You buy from us` / `We sell yours`).
   Każdy wiersz: okładka decka · właściciel · **wielka etykieta** · jedna linia payoffu · CTA · objętość PDF.
   Payoff max 9 słów — pilnuje tego test.
4. **Trzy fakty** (mono, bez zdań): skąd wysyłka, komis, czego jeszcze nie ma. Obiekcje w wersji ściany.
5. **Zbieranie leada — trzy kroki, rosnące zaangażowanie:**
   - klik „Get the catalog" → **spod przycisku wyjeżdża jedno pole na mail** + „In your inbox within a minute.";
   - po wysłaniu → drawer zamienia się w potwierdzenie + **Download now** (bramka miękka, pobranie działa
     nawet gdy POST padnie), a na wierzch wchodzi **pop-up „Leave your contact?"** — Name / Phone / Company,
     **wszystkie nieobowiązkowe**, z „No thanks";
   - **formularz na dole = ogólny kontakt/zapytanie** (mail wymagany, imię/firma/pytanie opcjonalne,
     checkbox „porozmawiajmy na stoisku"). Nie jest przypisany do żadnego decka.
6. Sticky CTA na mobile prowadzi do listy ofert; znika gdy formularz kontaktowy jest na ekranie.

⚠️ Trzy wersje odrzucone przed tą: 4 kafle „Get the PDF", 3 ścieżki z pomieszanymi liniami biznesu,
oraz wersja z rozbudowaną narracją („The same box sells for two different prices…"). Feedback usera:
**ma być prościej, jak na ścianach.** Nie wracać do prozy.


## Regeneracja okładek (po podmianie PDF-ów)
```bash
cd ~/projekty/active/monstelo/IFA/landing
~/projekty/active/monstelo/ecom-rag/.venv/bin/python - <<'PY'
import fitz, pathlib
out = pathlib.Path('assets/covers')
for pdf in sorted(pathlib.Path('offers').glob('*.pdf')):
    page = fitz.open(pdf)[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(620/page.rect.width, 620/page.rect.width), alpha=False)
    pix.save(out / (pdf.stem + '.jpg'), jpg_quality=82)
PY
```

## Liczby i twierdzenia
Wyłącznie z materiałów drukowanych: 241 marek · 28 rynków EU · ~11k aktywnych EAN · 6 kanałów ·
8 000 monitorowanych cen · ~80% wysyłek w 24h (~35% tego samego dnia) · grading A+–C ·
bateria ≥85% · do 12 mies. gwarancji. **Świadomie NIE użyto „top-rated seller"** (niezwalidowane).

✅ **Lista kanałów rozstrzygnięta (2026-07-23):** **Allegro · MediaMarkt · amazon · Refurbed ·
Empik + własny sklep = 6 kanałów.** Ceneo i Skąpiec wypadły z listy kanałów sprzedaży.
Poprawione w ulotkach, katalogu Monstelo, ofercie detal, prototypie v0 i README projektu.

⚠️ **Okładki zdradzają rozjazd:** decki są nadal w głosie A („FROM EAN TO EUROPE"), landing mówi B.
Widać to na miniaturach. Do domknięcia razem z materiałami drukowanymi.

## Podłączenie usługi form (DO ZROBIENIA przed live)
1. Usługa: **Tally** (darmowy nielimitowany, faworyt) / Formspree / Brevo.
2. Strona wysyła **trzy rodzaje zgłoszeń**, rozróżniane polem `source`:
   - `source=deck` — `email` + `offer` (slug decka). To jest lead; autoresponder ma odesłać ten deck
     **w ciągu minuty** (obietnica jest wypisana na stronie).
   - `source=deck-contact` — ten sam `email` + `offer` + `name`/`phone`/`company` z pop-upu (mogą być puste).
     To wzbogacenie tego samego leada → usługa powinna **deduplikować po `email`**.
   - `source=enquiry` — formularz z dołu: `email`, `name`, `company`, `message`, `meeting`. Bez decka.
   Kolejność jest celowa: lead zapisuje się natychmiast po mailu, dane kontaktowe są bonusem.
3. Endpoint wklej w `assets/app.js` → `FORM_ENDPOINT`. Jedyne miejsce zależności od usługi.

Bramka jest **miękka**: PDF-y to publiczne URL-e, a pobranie działa nawet gdy POST padnie.

## Placeholdery do domknięcia
- `[[FORM_ENDPOINT]]` w `assets/app.js`
- `[[CONTACT]]`, `[[DOMAIN]]` w `index.html` (footer)
- sign-off IFA dot. logotypów (`support@ifa-management.com`) przed ostrą promocją

## Deploy (GitHub Pages)
Landing to podkatalog repo IFA (lokalne, bez remote). Opcje: osobne repo `ifa-landing` z zawartością
tego katalogu → Pages z `main`, albo Pages z folderu `/landing` po dodaniu remote'a. QR → URL Pages.

## Podgląd lokalny
```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --window-size=1200,3200 --screenshot=/tmp/landing.png "file://$PWD/index.html"
```
⚠️ Chrome headless klamruje layout viewport do **min. 500 px** — zrzut przy `--window-size=390`
wygląda na ucięty, choć strona nie ma poziomego overflow. Do podglądu mobilnego używaj 500.
