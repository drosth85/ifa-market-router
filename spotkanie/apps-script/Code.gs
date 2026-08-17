/**
 * IFA 2026 — meeting booking backend.
 * Bound to a Google Sheet: Extensions -> Apps Script, paste this, then Deploy -> Web app.
 *
 * Writes one row per booking and creates a calendar event.
 * Answers text/plain POSTs, because Apps Script cannot serve a CORS preflight.
 */

var CALENDAR_ID = 'primary';        // or a shared calendar id: 'xxx@group.calendar.google.com'
var SHEET_NAME  = 'Bookings';
var STAND       = 'IFA Berlin 2026 · Reseller Park · stand H27E-17';
var NOTIFY      = '';               // optional: your address, to get a copy of every booking

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);

    var missing = ['name', 'company', 'email', 'date', 'from', 'to'].filter(function (k) {
      return !b[k];
    });
    if (missing.length) return json({ ok: false, reason: 'missing:' + missing.join(',') });
    if (b.evening && !b.place) return json({ ok: false, reason: 'missing:place' });

    var sheet = getSheet();

    // One party per slot. Evening meetings are off-site, so they do not collide.
    if (!b.evening && isTaken(sheet, b.date, b.from)) return json({ ok: false, reason: 'taken' });

    var when = b.date + ' ' + b.from + '–' + b.to;
    var place = b.evening ? b.place : STAND;

    sheet.appendRow([
      new Date(), b.date, b.from, b.to, b.evening ? 'evening' : 'stand',
      place, b.name, b.company, b.email, b.phone || '', b.note || '', b.source || ''
    ]);

    var eventUrl = '';
    try {
      var cal = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
      var ev = cal.createEvent(
        b.company + ' — ' + b.name + ' (IFA)',
        new Date(b.date + 'T' + b.from + ':00'),
        new Date(b.date + 'T' + b.to + ':00'),
        {
          location: place,
          description: [
            'Company: ' + b.company,
            'Name: ' + b.name,
            'E-mail: ' + b.email,
            b.phone ? 'Phone: ' + b.phone : '',
            b.note ? 'Topic: ' + b.note : '',
            b.evening ? 'Evening meeting — ' + b.place : ''
          ].filter(String).join('\n'),
          guests: b.email,
          sendInvites: true
        }
      );
      eventUrl = ev.getId();
    } catch (calErr) {
      // The row is already saved — a calendar failure must not lose the lead.
      sheet.getRange(sheet.getLastRow(), 13).setValue('calendar error: ' + calErr);
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
          '',
          'See you there.',
          'Monstelo × Mobilki GSM'
        ].join('\n')
      });
      if (NOTIFY) {
        MailApp.sendEmail(NOTIFY, 'New IFA booking: ' + b.company,
          when + '\n' + place + '\n' + b.name + ' · ' + b.email + ' · ' + (b.phone || '-') + '\n' + (b.note || ''));
      }
    } catch (mailErr) { /* the booking stands even if mail quota is spent */ }

    return json({ ok: true, event: eventUrl });
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
    sh.appendRow(['received', 'date', 'from', 'to', 'type', 'place',
                  'name', 'company', 'email', 'phone', 'note', 'source', 'error']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function isTaken(sheet, date, from) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var rows = sheet.getRange(2, 2, last - 1, 4).getValues(); // date, from, to, type
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], 'Europe/Berlin', 'yyyy-MM-dd')
      : String(rows[i][0]).trim();
    var f = String(rows[i][1]).trim();
    if (d === date && f === from && rows[i][3] !== 'evening') return true;
  }
  return false;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
