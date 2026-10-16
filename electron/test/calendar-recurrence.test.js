'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recurrence = require('../calendarRecurrence');
const providers = require('../calendarProviders');
const weekly = { id:'week', label:'Weeknight', time:'22:30', days:['mon','tue','wed','thu','fri'], durationMinutes:15, action:'sleep' };

test('weekly legacy rules retain their weekdays in every month', () => {
  for(let month=0;month<12;month++) {
    for(let day=1;day<=28;day++) {
      const date=new Date(2027,month,day);
      assert.equal(recurrence.matchesDate(weekly,date),date.getDay()>=1&&date.getDay()<=5);
    }
  }
});
test('monthly rules select all calendar days and selected months', () => {
  for(let month=0;month<12;month++) for(let day=1;day<=31;day++) {
    const date=new Date(2028,month,day);if(date.getMonth()!==month)continue;
    assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[day],months:[month+1]},date),true);
    assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[day],months:[]},date),false);
  }
});
test('short months skip missing dates and support the last day, including leap years', () => {
  assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[31]},new Date(2027,1,28)),false);
  assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[-1]},new Date(2027,1,28)),true);
  assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[-1]},new Date(2028,1,28)),false);
  assert.equal(recurrence.matchesDate({repeat:'monthly',monthDays:[-1]},new Date(2028,1,29)),true);
});
test('individual dates validate and do not recur the following year', () => {
  assert.equal(recurrence.validDate('2027-02-29'),false);
  assert.equal(recurrence.validDate('2028-02-29'),true);
  assert.equal(recurrence.validDate('2028-13-01'),false);
  const rule={repeat:'once',date:'2028-02-29'};
  assert.equal(recurrence.matchesDate(rule,new Date(2028,1,29)),true);
  assert.equal(recurrence.matchesDate(rule,new Date(2029,1,28)),false);
  assert.equal(recurrence.matchesDate({...rule,enabled:false},new Date(2028,1,29)),false);
});
test('calendar events preserve assigned routines, duration, and local date identities', () => {
  const events=providers.getDefaultCalendarEvents({rules:[{...weekly,repeat:'once',date:'2028-02-29',profileId:'saved-routine'}]},new Date(2028,1,28,12),3);
  assert.equal(events.length,1); assert.equal(events[0].profileId,'saved-routine');
  assert.equal(events[0].uid,'lo-default-week-2028-02-29');
  assert.equal(events[0].start.getHours(),22);assert.equal(events[0].start.getMinutes(),30);
  assert.equal(events[0].end-events[0].start,15*60000);
});
test('a specific date takes priority when its start matches a recurring rule', () => {
  const events=providers.getDefaultCalendarEvents({rules:[weekly,{...weekly,id:'once',repeat:'once',date:'2026-10-15'}]},new Date(2026,9,15,12),0);
  assert.equal(events.length,2);assert.equal(events[0].repeat,'once');
});
