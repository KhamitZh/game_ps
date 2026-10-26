// End-to-end protocol check against a running `npm run dev -w server`.
// Usage: node scripts/smoke.mjs [baseUrl]   (HOST_PASSWORD env, default "dev-password")
const BASE = process.argv[2] ?? 'http://localhost:8787';
const PASSWORD = process.env.HOST_PASSWORD ?? 'dev-password';
const WS_BASE = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, msg) {
  if (!cond) {
    console.error('FAIL -', msg);
    process.exit(1);
  }
  console.log('ok   -', msg);
}

class Client {
  constructor(pin) {
    this.inbox = [];
    this.waiters = [];
    this.ws = new WebSocket(`${WS_BASE}/ws/${pin}`);
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const w = this.waiters.find((x) => x.pred(m));
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      } else this.inbox.push(m);
    };
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred, timeout = 6000) {
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }
  close() {
    this.ws.close();
  }
}

const post = (body) =>
  fetch(`${BASE}/api/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

check((await (await fetch(BASE)).text()).includes('OK'), 'server answers on /');
check((await post({ password: 'wrong', timeLimitMin: 5 })).status === 403, 'wrong host password is rejected');

const created = await (await post({ password: PASSWORD, timeLimitMin: 5, level: 'python' })).json();
check(/^\d{6}$/.test(created.pin) && created.hostToken, `game created with PIN ${created.pin}`);
check(created.level === 'python', 'game is created on the requested level');
const { pin, hostToken } = created;

const info = await (await fetch(`${BASE}/api/game/${pin}`)).json();
check(info.exists && info.phase === 'LOBBY' && info.count === 0, 'game info shows an empty lobby');

const host = new Client(pin);
await host.opened;
host.send({ t: 'host', hostToken });
check((await host.wait((m) => m.t === 'hostWelcome')).pin === pin, 'host connects with token');

const alice = new Client(pin);
await alice.opened;
alice.send({ t: 'join', name: 'Аян', character: 1, lang: 'kk' });
const aliceWelcome = await alice.wait((m) => m.t === 'welcome');
check(aliceWelcome.you.name === 'Аян' && aliceWelcome.token, 'player 1 joins');

const dup = new Client(pin);
await dup.opened;
dup.send({ t: 'join', name: 'аЯН', character: 2, lang: 'ru' });
check((await dup.wait((m) => m.t === 'error')).code === 'NAME_TAKEN', 'duplicate name (other case) is rejected');
dup.close();

const bob = new Client(pin);
await bob.opened;
bob.send({ t: 'join', name: 'Bota', character: 5, lang: 'en' });
const bobWelcome = await bob.wait((m) => m.t === 'welcome');
check(bobWelcome.you.character === 5, 'player 2 joins');
check((await host.wait((m) => m.t === 'roster' && m.players.length === 2)).players.length === 2, 'host sees two players');

host.send({ t: 'start' });
check((await alice.wait((m) => m.t === 'phase' && m.phase.phase === 'COUNTDOWN')).phase.countdownEndsAt > 0, 'countdown starts');
await alice.wait((m) => m.t === 'phase' && m.phase.phase === 'PLAYING', 8000);
const tp = await alice.wait((m) => m.t === 'teleport');
check(tp.floor === 'f1', 'players are moved to floor 1');

alice.send({ t: 'interact', roomId: 'f1r1' });
check((await alice.wait((m) => m.t === 'error')).code === 'NOT_NEAR', 'interaction far from the key is refused');

alice.send({ t: 'move', x: tp.x + 300, y: tp.y, dir: 'right', moving: true });
const fix = await alice.wait((m) => m.t === 'teleport');
check(fix.x === tp.x && fix.y === tp.y, 'teleport-sized move is corrected');

check((await alice.wait((m) => m.t === 'snapshot' && m.players.length >= 2)).players.length >= 2, 'snapshots stream');

bob.close();
await sleep(300);
const bob2 = new Client(pin);
await bob2.opened;
bob2.send({ t: 'resume', token: bobWelcome.token });
const resumed = await bob2.wait((m) => m.t === 'welcome');
check(resumed.you.id === bobWelcome.you.id && resumed.phase.phase === 'PLAYING', 'player resumes after reconnect');

host.close();
await sleep(200);
const host2 = new Client(pin);
await host2.opened;
host2.send({ t: 'host', hostToken });
const hw = await host2.wait((m) => m.t === 'hostWelcome');
check(hw.phase.phase === 'PLAYING' && hw.roster.length === 2, 'host resumes after reload');

host2.send({ t: 'stop' });
const ended = await alice.wait((m) => m.t === 'ended');
check(ended.ranking.length === 2, 'stop ends the game with a ranking');

const after = await (await fetch(`${BASE}/api/game/${pin}`)).json();
check(after.phase === 'ENDED', 'game info shows ENDED');

for (const c of [alice, bob2, host2]) c.close();
console.log('\nSMOKE OK');
process.exit(0);
