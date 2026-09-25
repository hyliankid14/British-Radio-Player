import test from "node:test";
import assert from "node:assert/strict";

// Test the weekday mapping logic used by RadioAlarm for iOS weekly triggers:
// Settings days: 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
// Expo Notifications WEEKLY trigger expects: 1 = Sun, 2 = Mon, ..., 7 = Sat
function mapDayToExpoWeekday(day: number): number {
  return (day % 7) + 1;
}

test("RadioAlarm weekday mapping matches Expo Notifications specification", () => {
  assert.equal(mapDayToExpoWeekday(0), 1, "Sunday should map to 1");
  assert.equal(mapDayToExpoWeekday(1), 2, "Monday should map to 2");
  assert.equal(mapDayToExpoWeekday(2), 3, "Tuesday should map to 3");
  assert.equal(mapDayToExpoWeekday(3), 4, "Wednesday should map to 4");
  assert.equal(mapDayToExpoWeekday(4), 5, "Thursday should map to 5");
  assert.equal(mapDayToExpoWeekday(5), 6, "Friday should map to 6");
  assert.equal(mapDayToExpoWeekday(6), 7, "Saturday should map to 7");
});

test("RadioAlarm parse days string handles commas, whitespace and empty inputs", () => {
  const parseDays = (daysStr: string) =>
    String(daysStr)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number);

  assert.deepEqual(parseDays("1,2,3,4,5"), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays("0, 6"), [0, 6]);
  assert.deepEqual(parseDays(""), []);
  assert.deepEqual(parseDays("   "), []);
});

test("RadioAlarm next one-off trigger date calculation is always in the future", () => {
  const getNextTrigger = (hour: number, minute: number, now: Date) => {
    const trigger = new Date(now.getTime());
    trigger.setHours(hour, minute, 0, 0);
    if (trigger.getTime() <= now.getTime()) {
      trigger.setDate(trigger.getDate() + 1);
    }
    return trigger;
  };

  const now = new Date(2026, 8, 25, 10, 30, 0); // 10:30 AM
  // Alarm set for 11:00 AM (same day)
  const futureSameDay = getNextTrigger(11, 0, now);
  assert.equal(futureSameDay.getDate(), 25);
  assert.equal(futureSameDay.getHours(), 11);
  assert.ok(futureSameDay.getTime() > now.getTime());

  // Alarm set for 9:00 AM (already passed today -> next day)
  const nextDay = getNextTrigger(9, 0, now);
  assert.equal(nextDay.getDate(), 26);
  assert.equal(nextDay.getHours(), 9);
  assert.ok(nextDay.getTime() > now.getTime());
});
