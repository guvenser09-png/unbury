// Daily reminder via local notifications — native app only, strictly opt-in.
// No server, no push infrastructure: we schedule the next 7 evenings on-device
// and refresh the schedule on every app open, skipping today once it's played.

function LN() {
  const c = window.Capacitor;
  return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins
    ? c.Plugins.LocalNotifications : null;
}

export function available() { return !!LN(); }
export function enabled() { return localStorage.getItem('fl_notify') === '1'; }

const LINES = [
  '⛏️ Today’s dig is waiting. What’s buried down there?',
  '🧩 A new picture is buried. Can you name it early?',
  '🏆 The world leaderboard is filling up — claim your spot.',
  '⛏️ Fresh board, fresh pieces — same for the whole world.',
];

async function cancelAll(ln) {
  try {
    const pending = await ln.getPending();
    if (pending.notifications && pending.notifications.length) {
      await ln.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    }
  } catch { /* nothing scheduled */ }
}

export async function enable(ctx) {
  const ln = LN();
  if (!ln) return false;
  try {
    const p = await ln.requestPermissions();
    if (p.display !== 'granted') return false;
    localStorage.setItem('fl_notify', '1');
    await reschedule(ctx);
    return true;
  } catch { return false; }
}

export async function disable() {
  localStorage.setItem('fl_notify', '0');
  const ln = LN();
  if (ln) await cancelAll(ln);
}

// Schedule one quiet 19:30 reminder for each of the next 7 evenings,
// skipping today if the daily is already done. Streaks get a sharper line.
export async function reschedule({ playedToday, streak }) {
  const ln = LN();
  if (!ln || !enabled()) return;
  try {
    await cancelAll(ln);
    const now = new Date();
    const notifications = [];
    for (let d = 0; d < 7; d++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 19, 30, 0);
      if (at <= now) continue;
      if (d === 0 && playedToday) continue;
      const body = streak > 1
        ? `🔥 Your ${streak}-day streak is on the line — dig today’s puzzle!`
        : LINES[d % LINES.length];
      notifications.push({
        id: 100 + d,
        title: 'Unbury',
        body,
        schedule: { at },
      });
    }
    if (notifications.length) await ln.schedule({ notifications });
  } catch { /* never let reminders break the game */ }
}
