/**
 * Formats the timestamp when a song was played into a human-readable date and time.
 * Examples:
 * - "Today at 19:40"
 * - "Yesterday at 08:15"
 * - "Thu 24 Sep at 14:32"
 * - "Thu 24 Sep 2025 at 14:32"
 */
export function formatSongPlayedAt(playedAtMs?: number, nowMs = Date.now()): string {
  if (!playedAtMs || playedAtMs <= 0) return "";
  const date = new Date(playedAtMs);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date(nowMs);

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(nowMs);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${mins}`;

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  const dayName = dayNames[date.getDay()];
  const day = date.getDate();
  const month = monthNames[date.getMonth()];
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  if (isCurrentYear) {
    return `${dayName} ${day} ${month} at ${timeStr}`;
  }
  return `${dayName} ${day} ${month} ${date.getFullYear()} at ${timeStr}`;
}
