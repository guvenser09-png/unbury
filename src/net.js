// Network layer. All server traffic goes through Supabase edge functions;
// when no backend is configured (or offline) every call degrades gracefully
// and the game runs fully local.

const cfg = window.FL_CONFIG || { enabled: false };

function deviceKey() {
  let k = localStorage.getItem('fl_device_key');
  if (!k) {
    k = crypto.randomUUID();
    localStorage.setItem('fl_device_key', k);
  }
  return k;
}

export function isOnlineMode() { return !!cfg.enabled; }

async function call(fn, body, timeoutMs = 8000) {
  if (!cfg.enabled) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.functionsUrl}/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.anonKey}`,
        apikey: cfg.anonKey,
      },
      body: JSON.stringify({ device_key: deviceKey(), ...body }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `http ${res.status}`, detail: await res.text().catch(() => '') };
    return await res.json();
  } catch (e) {
    return { error: String(e && e.name === 'AbortError' ? 'timeout' : e) };
  } finally {
    clearTimeout(timer);
  }
}

// → { played, players, percentile, streak, best_streak } or null offline
export async function getDaily(dateStr) {
  return call('fl-get-daily', { fault_date: dateStr });
}

// → { percentile, players, streak, best_streak, verified } or null/error
export async function submitRun(dateStr, moves, score, revealPctVal, durationMs) {
  return call('fl-submit-run', {
    fault_date: dateStr,
    moves,
    claimed_score: score,
    claimed_reveal_pct: revealPctVal,
    duration_ms: durationMs,
    client_version: 'web-1.0.0',
  }, 15000);
}

// → { name } or { error } — sets the public digger name
export async function setName(name) {
  return call('fl-set-name', { name });
}

// Queue for offline submissions, flushed on reconnect / next boot.
export function queueSubmission(payload) {
  const q = JSON.parse(localStorage.getItem('fl_queue') || '[]');
  q.push(payload);
  localStorage.setItem('fl_queue', JSON.stringify(q.slice(-5)));
}

export async function flushQueue(onResult) {
  if (!cfg.enabled) return;
  const q = JSON.parse(localStorage.getItem('fl_queue') || '[]');
  if (q.length === 0) return;
  const remaining = [];
  for (const item of q) {
    const res = await submitRun(item.dateStr, item.moves, item.score, item.revealPctVal, item.durationMs);
    if (!res || res.error) remaining.push(item);
    else if (onResult) onResult(item, res);
  }
  localStorage.setItem('fl_queue', JSON.stringify(remaining));
}
