/**
 * IFA 2026 — meeting booking backend.
 * Bound to a Google Sheet: Extensions -> Apps Script, paste this, then Deploy -> Web app.
 *
 * One booking gives three things:
 *   1. a row in the sheet (source of truth — it survives a calendar or mail failure),
 *   2. a Calendar event with the visitor AND the chosen colleague invited as guests,
 *      so it lands in that person's own calendar,
 *   3. a confirmation e-mail to the visitor.
 *
 * Answers text/plain POSTs, because Apps Script cannot serve a CORS preflight.
 */

var CALENDAR_ID = 'primary';        // fallback calendar, used when a person has none of their own

/* One calendar per person: create them in Google Calendar on this account, then paste the ids
   (Calendar settings -> Integrate calendar -> Calendar ID). Empty value = use CALENDAR_ID. */
var CALENDARS = {
  any:        '',   // no calendar of its own: availability is summed across the crew below
  mamcarczyk: 'b35b6a8afc310198e7194055591a4af5905c09ffe273ef579906ede462bf2c69@group.calendar.google.com',
  tuchowska:  '4a2cba031e56a837a1d41aed1f85f82fb276df2c937920347728d9b42e2c0157@group.calendar.google.com',
  tabak:      'b5610f91507b5d41e4269694c572f3fe987821f29b57436b543b68186ed042e5@group.calendar.google.com',
  palka:      '0bced86f57a91ba4f011212e7382ada3985b7469674ca361d8bf77037698a6ba@group.calendar.google.com',
  kocaba:     '81f2cdc0628f9e9ec4d7aaee6960f96b7b48c6d44f440f4ed290ab17479a1d3b@group.calendar.google.com',
  juszczyk:   '91b2b8c65cbb32720ef0bab92775359c3e00c86355d8220510c5c7768b519b4e@group.calendar.google.com',
  drozd:      '94c71ef01b994e14c9f6a2d6c14c373c4cbb2e4d9e9b988ab443ad5a9ed2da63@group.calendar.google.com'
};

/* Abuse limits. The endpoint is public and anonymous by necessity, and every booking sends mail
   from this account (100/day on a free Gmail), so the caps protect the mail quota first. */
var FAIR_DAYS   = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'];
var DAY_START_H = 10;               // stand hours; evening meetings are handled separately
var DAY_END_H   = 18;
/* "No preference" is assigned to the first free person in this order. Meetings can always be
   held in the open IFA space, so there is no limit on parallel meetings. */
var ASSIGN_ORDER = ['juszczyk', 'mamcarczyk', 'tuchowska', 'tabak', 'kocaba', 'drozd', 'palka'];
var MAX_PER_DAY = 60;               // total bookings accepted per calendar day
var MAX_PER_MAIL = 3;               // bookings per e-mail address per calendar day
var DIAG_KEY    = 'gw0zdz';     // ?diag=<DIAG_KEY>; anything else gets nothing
// Spreadsheet that collects the bookings. Leave SHEET_ID empty only if this script is bound to
// that sheet (Extensions -> Apps Script); a standalone project must open it by id.
var SHEET_ID    = '1o1kKErUs80VT6lxddnEAw-UWHmCCUct1vGxAOe3uP38';
var SHEET_NAME  = 'Bookings';
var STAND       = 'IFA Berlin 2026 · Reseller Park · stand H27E-17';
var NOTIFY      = '';               // optional: your address, to get a copy of every booking
var ERROR_COL   = 16;               // last column of the row written below

/* The stand crew — kept here as well, so a tampered payload cannot invite strangers. */
var PEOPLE = {
  any:        { name: 'No preference',      email: '' },
  mamcarczyk: { name: 'Michał Mamcarczyk',  email: 'mm@monstelo.com' },
  tuchowska:  { name: 'Nikola Tuchowska',   email: 'nikola.tuchowska@monstelo.com' },
  tabak:      { name: 'Łukasz Tabak',       email: 'lukasz.tabak@monstelo.com' },
  palka:      { name: 'Kamil Pałka',        email: 'kamil.palka@monstelo.com' },
  kocaba:     { name: 'Błażej Kócaba',      email: 'blazej.kocaba@monstelo.com' },
  juszczyk:   { name: 'Sebastian Juszczyk', email: 'sebastian@monstelo.com' },
  drozd:      { name: 'Tomasz Drozd',       email: 'tomasz.drozd@monstelo.com' }
};

function doPost(e) {
  try {
    return handleBooking(JSON.parse(e.postData.contents));
  } catch (err) {
    return json({ ok: false, reason: String(err) });
  }
}

/**
 * The page books over GET, not POST. Apps Script answers a POST with a 302, and WebKit
 * (Safari, every iPhone) re-issues that redirect as a GET on /exec — the booking silently
 * never runs and the visitor still sees a confirmation. A GET has nothing to downgrade.
 */
function handleBooking(b) {
  try {

    var missing = ['name', 'company', 'email', 'date', 'from', 'to'].filter(function (k) {
      return !b[k];
    });
    if (missing.length) return json({ ok: false, reason: 'missing:' + missing.join(',') });
    if (b.evening && !b.place) return json({ ok: false, reason: 'missing:place' });

    // Never trust the page: it validates for the visitor's comfort, this validates for us.
    b.name    = clean(b.name, 80);
    b.company = clean(b.company, 80);
    b.email   = clean(b.email, 120);
    b.phone   = clean(b.phone, 30);
    b.note    = clean(b.note, 500);
    b.place   = clean(b.place, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) return json({ ok: false, reason: 'bad:email' });
    if (FAIR_DAYS.indexOf(String(b.date)) === -1) return json({ ok: false, reason: 'bad:date' });
    if (!/^\d{2}:\d{2}$/.test(b.from) || !/^\d{2}:\d{2}$/.test(b.to)) return json({ ok: false, reason: 'bad:time' });
    var mins = minutesBetween(b.from, b.to);
    if (b.evening) {
      if (toMin(b.from) < DAY_END_H * 60 || mins <= 0 || mins > 180) return json({ ok: false, reason: 'bad:evening' });
    } else {
      if ([15, 30, 45].indexOf(mins) === -1) return json({ ok: false, reason: 'bad:duration' });
      if (toMin(b.from) % 15 !== 0) return json({ ok: false, reason: 'bad:grid' });
      if (toMin(b.from) < DAY_START_H * 60 || toMin(b.to) > DAY_END_H * 60) return json({ ok: false, reason: 'bad:hours' });
    }
    var limit = underLimit(b.email);
    if (!limit.ok) return json({ ok: false, reason: limit.reason });

    var pid = PEOPLE[b.person] ? b.person : 'any';
    var assigned = false;

    // Evening meetings are off-site, so they never collide with the stand schedule.
    if (!b.evening) {
      if (pid === 'any') {
        var free = firstFree(b.date, b.from, b.to);
        if (!free) return json({ ok: false, reason: 'taken' });
        pid = free;
        assigned = true;
      } else if (isTaken(b.date, b.from, b.to, pid)) {
        return json({ ok: false, reason: 'taken' });
      }
    }
    var person = PEOPLE[pid];
    var sheet = getSheet();

    var when = b.date + ' ' + b.from + '–' + b.to;
    var place = b.evening ? b.place : STAND;
    var withWhom = pid === 'any' ? '' : person.name;

    sheet.appendRow([
      new Date(), b.date, b.from, b.to, b.minutes || minutesBetween(b.from, b.to),
      b.evening ? 'evening' : 'stand', place, withWhom || '(any)', person.email,
      b.name, b.company, b.email, b.phone || '', b.note || '', b.source || ''
    ]);

    var eventUrl = '';
    try {
      var cal = calendarFor(pid);
      var guests = [b.email];
      if (person.email) guests.push(person.email);
      var ev = cal.createEvent(
        b.company + ' — ' + b.name + ' (IFA)' + (withWhom ? ' · ' + withWhom : ''),
        new Date(b.date + 'T' + b.from + ':00'),
        new Date(b.date + 'T' + b.to + ':00'),
        {
          location: place,
          description: [
            'Company: ' + b.company,
            'Name: ' + b.name,
            'E-mail: ' + b.email,
            b.phone ? 'Phone: ' + b.phone : '',
            withWhom ? 'Meeting with: ' + withWhom : 'Meeting with: whoever is free',
            b.note ? 'Topic: ' + b.note : '',
            b.evening ? 'Evening meeting — ' + b.place : ''
          ].filter(String).join('\n'),
          guests: guests.join(','),
          sendInvites: true
        }
      );
      eventUrl = ev.getId();
    } catch (calErr) {
      // The row is already saved — a calendar failure must not lose the lead.
      sheet.getRange(sheet.getLastRow(), ERROR_COL).setValue('calendar error: ' + calErr);
    }

    try {
      MailApp.sendEmail({
        to: b.email,
        subject: 'Confirmed — ' + when + ' at IFA Berlin',
        body: [
          'Hi ' + b.name + ',',
          '',
          'Your meeting with Monstelo × Mobilki GSM is booked.',
          '',
          'When:  ' + when + ' (Europe/Berlin)',
          'Where: ' + place,
          withWhom ? 'With:  ' + withWhom : 'With:  the right person for your topic',
          '',
          'A calendar invitation is on its way — accept it and the slot is yours.',
          '',
          'See you there.',
          'Monstelo × Mobilki GSM'
        ].join('\n')
      });
      var copyTo = [NOTIFY, person.email].filter(String).join(',');
      if (copyTo) {
        MailApp.sendEmail(copyTo, 'New IFA booking: ' + b.company,
          when + '\n' + place + '\n' + (withWhom || 'no preference') + '\n' +
          b.name + ' · ' + b.email + ' · ' + (b.phone || '-') + '\n' + (b.note || ''));
      }
    } catch (mailErr) { /* the booking stands even if mail quota is spent */ }

    // The freshly taken slot must disappear from the grid straight away.
    try {
      var c = CacheService.getScriptCache();
      c.remove('fb:' + b.date + ':' + pid);
      c.remove('fb:' + b.date + ':any');
      c.remove('day:' + b.date + ':' + pid);
    } catch (e) {}

    return json({ ok: true, booked: true, event: eventUrl, person: withWhom, assigned: assigned });
  } catch (err) {
    return json({ ok: false, reason: String(err) });
  }
}

/**
 * Run once from the editor during the fair week: a five-minute trigger keeps the web app warm,
 * so no visitor pays the 15-second cold start. Run removeKeepWarm() when the fair is over.
 */
function installKeepWarm() {
  removeKeepWarm();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  return 'keepWarm installed';
}

function removeKeepWarm() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t);
  });
  return 'keepWarm removed';
}

/** Cheap warm-up: one cached calendar read, so the container stays alive. */
function keepWarm() {
  try { dayBusy(ASSIGN_ORDER[0], FAIR_DAYS[0], false); } catch (e) {}
}

/** Lets you sanity-check the deployment in a browser.
    ?diag=<DIAG_KEY>&date=2026-09-04&from=10:00&to=10:15&person=any tells you what the check sees.
    ?action=book&payload=<url-encoded JSON> books — this is the path the page uses. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'book' && p.payload) {
    try {
      return handleBooking(JSON.parse(p.payload));
    } catch (err) {
      return json({ ok: false, reason: 'bad payload: ' + err });
    }
  }
  if (p.action === 'free') return json(freeBusy(p.date, p.person));
  if (p.diag !== DIAG_KEY) return json({ ok: true, service: 'ifa-booking' });
  try {
    var date = p.date || '2026-09-04', from = p.from || '10:00', to = p.to || '10:15';
    var pid = PEOPLE[p.person] ? p.person : 'any';
    var t0 = new Date().getTime();
    var cal = calendarFor(pid);
    var calName = cal ? cal.getName() : '(none)';
    var tCal = new Date().getTime() - t0;
    var t1 = new Date().getTime();
    var spans = dayBusy(pid, date, true);
    var tDay = new Date().getTime() - t1;
    var t2 = new Date().getTime();
    var taken = isTaken(date, from, to, pid);
    var tTaken = new Date().getTime() - t2;
    return json({
      ok: true,
      person: pid,
      calendar: calName,
      calendarId: CALENDARS[pid] || CALENDAR_ID,
      sheetRows: getSheet().getLastRow() - 1,
      busyToday: spans,
      taken: taken,
      ms: { calendar: tCal, dayRead: tDay, takenCheck: tTaken }
    });
  } catch (err) {
    return json({ ok: false, reason: String(err) });
  }
}

function getSheet() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: set SHEET_ID or bind the script to a sheet.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['received', 'date', 'from', 'to', 'minutes', 'type', 'place',
                  'person', 'person_email', 'name', 'company', 'email', 'phone',
                  'note', 'source', 'error']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Strips control characters and newlines (no mail-header games) and caps the length. */
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t\u0000-\u001F]+/g, ' ').trim().slice(0, max);
}

/** Daily caps, kept in script properties. Protects the Gmail quota from a flood. */
function underLimit(email) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  var total = Number(props.getProperty('count:' + today) || 0);
  if (total >= MAX_PER_DAY) return { ok: false, reason: 'limit:day' };
  var perMail = Number(props.getProperty('mail:' + today + ':' + email.toLowerCase()) || 0);
  if (perMail >= MAX_PER_MAIL) return { ok: false, reason: 'limit:email' };
  props.setProperty('count:' + today, String(total + 1));
  props.setProperty('mail:' + today + ':' + email.toLowerCase(), String(perMail + 1));
  return { ok: true };
}

/** Stand meetings only — a private entry in a fallback calendar must not block a visitor. */
function standEvents(cal, from, to, isOwnCalendar) {
  var events = cal.getEvents(from, to);
  if (isOwnCalendar) return events;
  return events.filter(function (ev) {
    return String(ev.getLocation() || '').indexOf('H27E-17') !== -1 ||
           String(ev.getTitle() || '').indexOf('(IFA)') !== -1;
  });
}

/** The person's own calendar when they have one, otherwise the shared fallback. */
function calendarFor(pid) {
  var id = CALENDARS[pid];
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  return cal || CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
}

function toMin(hhmm) {
  var p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}
function minutesBetween(from, to) { return toMin(to) - toMin(from); }

/**
 * Availability is read from the CALENDAR, not from the sheet: the calendar also knows about
 * meetings somebody added by hand, and it is what the crew actually looks at.
 * Meetings are 15/30/45 minutes on a 15-minute grid, so a clash is an overlap,
 * not an identical start time — getEvents(from, to) returns exactly the overlapping ones.
 *   - a named person: busy when they are a guest of an overlapping stand meeting,
 *   - no preference:  busy only when every table is taken in that window.
 */
function isTaken(date, from, to, pid) {
  var start = new Date(date + 'T' + from + ':00');
  var end   = new Date(date + 'T' + to + ':00');

  if (pid === 'any') return !firstFree(date, from, to);

  if (CALENDARS[pid]) return busyAt(dayBusy(pid, date, true), from, to);  // own calendar: all of it counts

  var events = standEvents(calendarFor(pid), start, end, false);
  var email = String(PEOPLE[pid].email || '').toLowerCase();
  if (!email) return false;
  for (var i = 0; i < events.length; i++) {
    var guests = events[i].getGuestList();
    for (var j = 0; j < guests.length; j++) {
      if (String(guests[j].getEmail()).toLowerCase() === email) return true;
    }
    if (String(events[i].getTitle()).indexOf(PEOPLE[pid].name) !== -1) return true;
  }
  return false;
}

/**
 * Busy spans of one person for a whole fair day, cached for two minutes.
 * Walking seven calendars live took up to 50 s, so every availability question goes through here.
 */
function dayBusy(pid, date, fresh) {
  var cache = CacheService.getScriptCache();
  var key = 'day:' + date + ':' + pid;
  if (!fresh) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  var spans = spansOf(standEvents(
    calendarFor(pid),
    new Date(date + 'T' + pad2(DAY_START_H) + ':00:00'),
    new Date(date + 'T' + pad2(DAY_END_H) + ':00:00'),
    !!CALENDARS[pid]
  ));
  cache.put(key, JSON.stringify(spans), 120);
  return spans;
}

function busyAt(spans, from, to) {
  for (var i = 0; i < spans.length; i++) {
    if (toMin(spans[i][0]) < toMin(to) && toMin(from) < toMin(spans[i][1])) return true;
  }
  return false;
}

/**
 * The first colleague in ASSIGN_ORDER who is free. The cached day is used to pick a candidate,
 * then that one candidate is re-read live — so a two-minute-old cache cannot double-book.
 */
function firstFree(date, from, to) {
  for (var i = 0; i < ASSIGN_ORDER.length; i++) {
    var pid = ASSIGN_ORDER[i];
    if (!PEOPLE[pid]) continue;
    if (busyAt(dayBusy(pid, date, false), from, to)) continue;
    if (!busyAt(dayBusy(pid, date, true), from, to)) return pid;
  }
  return null;
}

/** True when this calendar belongs to one person (not the shared fallback). */
function ownsCalendar(cal) {
  var id = cal.getId();
  for (var pid in CALENDARS) if (CALENDARS[pid] && CALENDARS[pid] === id) return true;
  return false;
}

/**
 * What the page needs to grey out taken slots: the busy windows of one person on one fair day.
 * Returned as ["HH:MM","HH:MM"] pairs clipped to the stand hours.
 */
function freeBusy(date, person) {
  try {
    if (FAIR_DAYS.indexOf(String(date)) === -1) return { ok: false, reason: 'bad:date' };
    var pid = PEOPLE[person] ? person : 'any';
    var spans;
    if (pid === 'any') {
      // Busy only where every colleague is busy — one free person keeps the slot open.
      // The page normally works this out itself from the individual answers; this is the fallback.
      spans = allBusyWindows(ASSIGN_ORDER.map(function (id) { return dayBusy(id, date, false); }));
    } else {
      spans = dayBusy(pid, date, false);
    }
    return { ok: true, date: date, person: pid, busy: spans };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

function spansOf(events) {
  return events.map(function (ev) { return [fmtTime(ev.getStartTime()), fmtTime(ev.getEndTime())]; });
}

/** Quarter-hours in which nobody from the crew is free. */
function allBusyWindows(perPerson) {
  var out = [];
  for (var m = DAY_START_H * 60; m < DAY_END_H * 60; m += 15) {
    var everyoneBusy = perPerson.length > 0 && perPerson.every(function (spans) {
      return spans.some(function (w) { return toMin(w[0]) < m + 15 && m < toMin(w[1]); });
    });
    if (everyoneBusy) out.push([hhmm(m), hhmm(m + 15)]);
  }
  return out;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function hhmm(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

/** The sheet may hand back a Date for a time cell, depending on how it was typed. */
function fmtTime(v) {
  return v instanceof Date
    ? Utilities.formatDate(v, 'Europe/Berlin', 'HH:mm')
    : String(v).trim();
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
