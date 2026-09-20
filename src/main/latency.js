// === Is it me, or is it them? ==============================================
//
// A game stutters, Discord drops, a site hangs, and the only way to tell your
// own connection apart from someone else's server is to test both. This opens
// a plain TCP connection to a handful of hosts and times how long it takes to
// answer — no ping (ICMP is blocked on most of these anyway), no data sent, no
// account needed.
//
// Two groups: a baseline of hosts that are close to everyone and effectively
// never slow (Cloudflare's and Google's resolvers), and the services. If the
// baseline is slow, it is your line. If the baseline is fine and one service
// is not, it is that service.
const TIMEOUT_MS = 3000;
const SLOW_MS = 250;      // where a service stops being far away and starts being slow

const TARGETS = [
  { id: 'cloudflare', name: 'Your connection (Cloudflare)', host: '1.1.1.1', port: 443, baseline: true },
  { id: 'google', name: 'Your connection (Google)', host: '8.8.8.8', port: 443, baseline: true },
  { id: 'discord', name: 'Discord', host: 'gateway.discord.gg', port: 443 },
  { id: 'steam', name: 'Steam', host: 'api.steampowered.com', port: 443 },
  { id: 'riot', name: 'Riot (League, Valorant)', host: 'auth.riotgames.com', port: 443 },
  { id: 'roblox', name: 'Roblox', host: 'www.roblox.com', port: 443 },
  { id: 'epic', name: 'Epic Games', host: 'www.epicgames.com', port: 443 },
  { id: 'youtube', name: 'YouTube', host: 'www.youtube.com', port: 443 },
];

// connect: (host, port, onDone) — injected so this can be tested without a
// network. onDone(error) is called once, and the socket is closed here.
function time(target, connect, now = () => Date.now()) {
  return new Promise((resolve) => {
    const started = now();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      resolve({ id: target.id, name: target.name, host: target.host, baseline: !!target.baseline, ms: err ? null : now() - started, error: err ? String(err.message || err) : null });
    };
    try { connect(target.host, target.port, done); }
    catch (err) { done(err); }
  });
}

// What the numbers mean, in a sentence. The baseline is the lowest of the
// hosts that should always be quick; a service is called slow when it is well
// behind it, not merely behind it.
function verdict(results) {
  const ok = (r) => Number.isFinite(r.ms);
  const base = results.filter(r => r.baseline && ok(r)).map(r => r.ms).sort((a, b) => a - b)[0];
  const services = results.filter(r => !r.baseline);
  const reachable = services.filter(ok);
  const down = services.filter(r => !ok(r));

  if (base == null) return 'Nothing answered at all — that is your connection, not any one service.';
  if (base > 250) return 'Your own connection is slow right now (' + Math.round(base) + ' ms to a server that is never slow), so everything will feel it.';

  // A service is only "slow" when it is both well behind your own line and
  // slow enough to feel. A game server on another continent answering in
  // 150 ms is a long way away, not broken — and the baseline hosts answer from
  // the nearest city, so comparing with them alone would call everything slow.
  const slow = reachable.filter(r => r.ms > Math.max(SLOW_MS, base * 4));
  if (!slow.length && !down.length) return 'Your connection is fine (' + Math.round(base) + ' ms), and so is every service Vex checked.';
  const names = [...down.map(r => r.name + ' did not answer'), ...slow.map(r => r.name + ' at ' + Math.round(r.ms) + ' ms')];
  return 'Your connection is fine (' + Math.round(base) + ' ms) — it is them: ' + names.join(', ') + '.';
}

async function check(connect, targets = TARGETS) {
  const results = await Promise.all(targets.map(t => time(t, connect)));
  return { results, verdict: verdict(results) };
}

// The real thing: a TCP connect with its own deadline, closed either way.
function tcpConnect(net) {
  return (host, port, done) => {
    const socket = net.connect({ host, port });
    const finish = (err) => { try { socket.destroy(); } catch { /* already gone */ } done(err); };
    socket.setTimeout(TIMEOUT_MS, () => finish(new Error('No answer in ' + (TIMEOUT_MS / 1000) + ' s')));
    socket.once('connect', () => finish(null));
    socket.once('error', finish);
  };
}

module.exports = { check, verdict, time, tcpConnect, TARGETS, TIMEOUT_MS, SLOW_MS };
