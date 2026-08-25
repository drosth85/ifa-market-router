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
    if (!b.evening && isTaken(sheet, b.date, b.from, b.to, pid)) {
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

/** Lets you sanity-check the deployment in a browser. */
function doGet() {
  return json({ ok: true, service: 'ifa-booking' });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
 * Meetings are 15/30/45 minutes on a 15-minute grid, so a clash is an overlap,
 * not an identical start time.
 *   - a named person: busy if any of their stand meetings overlaps,
 *   - no preference:  busy only when every table is already taken in that window.
 */
function isTaken(sheet, date, from, to, pid) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var rows = sheet.getRange(2, 2, last - 1, 8).getValues(); // date..person_email
  var overlapping = 0;
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], 'Europe/Berlin', 'yyyy-MM-dd')
      : String(rows[i][0]).trim();
    if (d !== date) continue;
    if (String(rows[i][4]).trim() === 'evening') continue;
    var f = fmtTime(rows[i][1]);
    var t = fmtTime(rows[i][2]);
    if (!(toMin(f) < toMin(to) && toMin(from) < toMin(t))) continue; // no overlap
    overlapping++;
    var rowPerson = String(rows[i][6]).trim();
    if (pid !== 'any' && rowPerson === PEOPLE[pid].name) return true;
  }
  return pid === 'any' && overlapping >= STAND_TABLES;
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
