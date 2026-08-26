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

var CALENDAR_ID = 'primary';        // or a shared calendar id: 'xxx@group.calendar.google.com'
// Spreadsheet that collects the bookings. Leave SHEET_ID empty only if this script is bound to
// that sheet (Extensions -> Apps Script); a standalone project must open it by id.
var SHEET_ID    = '1o1kKErUs80VT6lxddnEAw-UWHmCCUct1vGxAOe3uP38';
var SHEET_NAME  = 'Bookings';
var STAND       = 'IFA Berlin 2026 · Reseller Park · stand H27E-17';
var NOTIFY      = '';               // optional: your address, to get a copy of every booking
var ERROR_COL   = 16;               // last column of the row written below
var STAND_TABLES = 2;               // parallel meetings possible when no person was chosen

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
    var b = JSON.parse(e.postData.contents);

    var missing = ['name', 'company', 'email', 'date', 'from', 'to'].filter(function (k) {
      return !b[k];
    });
    if (missing.length) return json({ ok: false, reason: 'missing:' + missing.join(',') });
    if (b.evening && !b.place) return json({ ok: false, reason: 'missing:place' });

    var pid = PEOPLE[b.person] ? b.person : 'any';
    var person = PEOPLE[pid];

    var sheet = getSheet();

    // Evening meetings are off-site, so they never collide with the stand schedule.
    if (!b.evening && isTaken(b.date, b.from, b.to, pid)) {
      return json({ ok: false, reason: 'taken' });
    }

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
      var cal = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
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

    return json({ ok: true, event: eventUrl, person: withWhom });
  } catch (err) {
    return json({ ok: false, reason: String(err) });
  }
}

/** Lets you sanity-check the deployment in a browser.
    ?diag=1&date=2026-09-04&from=10:00&to=10:15&person=any tells you what the collision check sees. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.diag) return json({ ok: true, service: 'ifa-booking' });
  try {
    var date = p.date || '2026-09-04', from = p.from || '10:00', to = p.to || '10:15';
    var pid = PEOPLE[p.person] ? p.person : 'any';
    var cal = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
    var events = cal.getEvents(new Date(date + 'T' + from + ':00'), new Date(date + 'T' + to + ':00'));
    return json({
      ok: true,
      sheetRows: getSheet().getLastRow() - 1,
      calendar: cal.getName(),
      eventsInWindow: events.map(function (ev) { return ev.getTitle(); }),
      taken: isTaken(date, from, to, pid)
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
  var cal = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
  var events = cal.getEvents(new Date(date + 'T' + from + ':00'),
                             new Date(date + 'T' + to + ':00'));
  // Only our stand meetings count — private entries in the same calendar must not block a visitor.
  var ours = events.filter(function (ev) {
    return String(ev.getLocation() || '').indexOf('H27E-17') !== -1 ||
           String(ev.getTitle() || '').indexOf('(IFA)') !== -1;
  });
  if (pid === 'any') return ours.length >= STAND_TABLES;

  var email = String(PEOPLE[pid].email || '').toLowerCase();
  if (!email) return false;
  for (var i = 0; i < ours.length; i++) {
    var guests = ours[i].getGuestList();
    for (var j = 0; j < guests.length; j++) {
      if (String(guests[j].getEmail()).toLowerCase() === email) return true;
    }
    if (String(ours[i].getTitle()).indexOf(PEOPLE[pid].name) !== -1) return true;
  }
  return false;
}

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
