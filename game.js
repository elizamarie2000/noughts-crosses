// Noughts & Crosses: the two computers talk directly over PeerJS and each keeps the same list of moves.
const PREFIX = "noughts-v1-";
const ROOM_WORDS = ["QUILL", "INK", "PAGE", "NOTE", "RIBBON", "STAMP", "INDEX", "SERIF", "LETTER", "MARGIN"];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const $ = id => document.getElementById(id);
const isSquare = v => Number.isInteger(v) && v >= 0 && v < 9;

const S = {
  me: "", foe: "Your friend", host: false, code: "", met: false, live: false, meFirst: false,
  moves: [], line: null, mine: 0, theirs: 0, draws: 0, iNext: false, foeNext: false,
};
let peer = null, conn = null, retry = null, leaving = false, typing = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- connection ----------
function bind(c) {
  conn = c;
  c.on("open", () => {
    clearTimeout(retry);
    send({ t: "hello", name: S.me });
    if (S.met) send({ t: "sync", moves: S.moves });
    showConn();
  });
  c.on("data", onMessage);
  c.on("close", dropped);
  c.on("error", dropped);
}

function dropped() {
  if (leaving) return;
  conn = null;
  showConn();
  if (S.live) setStatus("Your friend has dropped out. Hold on, trying to reconnect…", "lost");
  if (!S.host) { clearTimeout(retry); retry = setTimeout(connectToHost, 3000); }
}

function connectToHost() {
  if (leaving || (conn && conn.open) || !peer || peer.destroyed) return;
  bind(peer.connect(PREFIX + S.code, { reliable: true, serialization: "json" }));
  clearTimeout(retry);
  retry = setTimeout(() => { if (!conn || !conn.open) connectToHost(); }, 6000);
}

const send = m => { if (conn && conn.open) conn.send(m); };

function hostRoom() {
  S.host = true;
  S.code = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)] + "-" + (10 + Math.floor(Math.random() * 90));
  peer = new Peer(PREFIX + S.code);
  peer.on("open", () => {
    $("codeOut").textContent = S.code;
    show("wait");
  });
  peer.on("connection", c => {
    if (conn && conn.open) { c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 300); }); return; }
    bind(c);
  });
  peer.on("disconnected", () => { if (!leaving && !peer.destroyed) peer.reconnect(); });
  peer.on("error", e => {
    if (e.type === "unavailable-id") { peer.destroy(); hostRoom(); }
    else if (e.type !== "peer-unavailable" && !S.met) homeError("Couldn't connect. Check your internet and try again.");
  });
}

function joinRoom(code) {
  S.host = false;
  S.code = code;
  $("waitTitle").textContent = "Joining…";
  $("codeOut").textContent = code;
  $("waitNote").textContent = "Looking for your friend's room…";
  $("copyBtn").hidden = true;
  show("wait");
  peer = new Peer();
  peer.on("open", connectToHost);
  peer.on("disconnected", () => { if (!leaving && !peer.destroyed) peer.reconnect(); });
  peer.on("error", e => {
    if (e.type === "peer-unavailable") {
      if (S.met) return;
      clearTimeout(retry);
      homeError("No room with that code. Check it with your friend.");
    } else if (!S.met) homeError("Couldn't connect. Check your internet and try again.");
  });
}

function leave() {
  leaving = true;
  clearTimeout(retry);
  if (peer) peer.destroy();
  location.href = location.pathname;
}

function homeError(text) {
  clearTimeout(retry);
  if (peer) { leaving = true; peer.destroy(); leaving = false; peer = null; }
  conn = null;
  $("homeErr").textContent = text;
  show("home");
}

// ---------- messages from the other player ----------
function onMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "hello") {
    S.foe = String(m.name || "").trim().slice(0, 16) || "Your friend";
    if (S.host && !S.met) {
      S.met = true;
      const meFirst = Math.random() < 0.5;
      send({ t: "first", starter: meFirst ? "host" : "guest" });
      startRound(meFirst);
    }
    if (S.met) { refreshStatus(); renderPlay(); }
    showConn();
  } else if (m.t === "full") {
    homeError("That room already has two players.");
  } else if (m.t === "first" && !S.host && !S.met) {
    S.met = true;
    startRound(m.starter === "guest");
  } else if (m.t === "move" && isSquare(m.square) && m.n === S.moves.length && S.live && !myTurn()) {
    place(m.square);
  } else if (m.t === "sync" && Array.isArray(m.moves)) {
    for (let n = S.moves.length; n < m.moves.length && S.live; n++) if (isSquare(m.moves[n])) place(m.moves[n]);
  } else if (m.t === "next") {
    S.foeNext = true;
    tryNext();
  }
}

// ---------- rounds ----------
const myTurn = () => (S.moves.length % 2 === 0) === S.meFirst;
const markAt = n => n % 2 === 0 ? "X" : "O";
const myMark = () => S.meFirst ? "X" : "O";

function startRound(meFirst) {
  Object.assign(S, { meFirst, live: true, moves: [], line: null, iNext: false, foeNext: false });
  $("nextBtn").hidden = true;
  chime([392, 523]);
  show("play");
  showConn();
  refreshStatus();
  renderPlay();
}

function place(square) {
  if (S.moves.includes(square)) return;
  const n = S.moves.length;
  S.moves.push(square);
  const board = boardNow();
  S.line = LINES.find(line => line.every(i => board[i] === markAt(n))) || null;
  if (S.line) return endRound(markAt(n) === myMark() ? "me" : "foe");
  if (S.moves.length === 9) return endRound(null);
  ripple();
  refreshStatus();
  renderPlay();
  if (myTurn()) nudge();
}

function boardNow() {
  const board = Array(9).fill("");
  S.moves.forEach((square, n) => { board[square] = markAt(n); });
  return board;
}

function endRound(winner) {
  S.live = false;
  if (winner === "me") S.mine++; else if (winner === "foe") S.theirs++; else S.draws++;
  winner === "me" ? chime([523, 659, 784, 1047]) : winner === "foe" ? chime([392, 330, 262]) : chime([523, 659]);
  setStatus(winner === "me" ? "You win this round!" : winner === "foe" ? `${S.foe} wins this round.` : "A draw.");
  $("nextBtn").hidden = false;
  $("nextBtn").disabled = false;
  $("nextBtn").textContent = "Next round";
  renderPlay();
}

function tryNext() {
  if (S.iNext && S.foeNext) startRound(!S.meFirst);
  else if (S.foeNext && !S.live) setStatus(`${S.foe} is ready for another round.`);
}

function choose(square) {
  if (!S.live || !myTurn() || !conn || !conn.open) return;
  const n = S.moves.length;
  send({ t: "move", square, n });
  place(square);
}

function renderPlay() {
  const board = boardNow();
  const last = S.moves[S.moves.length - 1];
  $("grid").replaceChildren(...board.map((mark, i) => {
    const b = document.createElement("button");
    b.textContent = mark;
    b.className = (S.line && S.line.includes(i) ? "win " : "") + (i === last ? "new" : "");
    b.disabled = !!mark || !S.live || !myTurn();
    b.setAttribute("aria-label", mark ? `Square ${i + 1}, ${mark}` : `Square ${i + 1}, empty`);
    b.onclick = () => choose(i);
    return b;
  }));
  $("myScore").textContent = `You ${S.mine}`;
  $("drawScore").textContent = `Draws ${S.draws}`;
  $("foeScore").textContent = `${S.foe} ${S.theirs}`;
}

// ---------- screen text ----------
const stillMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function setStatus(text, kind = "") {
  const el = $("status");
  el.className = "status " + kind;
  clearTimeout(typing);
  if (stillMotion || document.hidden) { el.textContent = text; return; }
  let n = 0;
  (function type() {
    el.textContent = text.slice(0, ++n);
    if (n < text.length) typing = setTimeout(type, 16);
  })();
}

function refreshStatus() {
  if (!S.live) return;
  if (myTurn()) setStatus(`Your turn. You're ${myMark()}.`, "mine");
  else setStatus(`${S.foe} is thinking… You're ${myMark()}.`);
}

function nudge() {
  if (document.hidden) document.title = "Your turn! Noughts & Crosses";
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.title = "Noughts & Crosses"; });

function showConn() {
  const on = conn && conn.open;
  document.querySelectorAll("[data-conn]").forEach(e => {
    const dot = document.createElement("i");
    dot.className = "dot" + (on ? "" : " off");
    e.replaceChildren(dot, on ? `With ${S.foe}` : "Reconnecting…");
  });
}

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id));
  window.scrollTo(0, 0);
}

// ---------- sound ----------
let audio = null, muted = store.get("noughts-muted") === "1";
function sound() {
  if (muted) return null;
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  return audio;
}
function note(freq, at, length, level) {
  const ctx = sound();
  if (!ctx) return;
  const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + at;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length);
}
function ripple() {   // a single typewriter key
  const ctx = sound();
  if (!ctx) return;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  buffer.getChannelData(0).forEach((_, i, d) => { d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3; });
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  gain.gain.value = 0.3;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}
const chime = notes => { ripple(); notes.forEach((f, i) => note(f * 2, i * 0.12, 0.7, 0.05)); };   // key, then the carriage bell
const soundLabel = () => { $("soundBtn").textContent = muted ? "Sound off" : "Sound on"; };

// ---------- buttons ----------
const myName = () => { S.me = $("nameIn").value.trim().slice(0, 16); store.set("noughts-name", S.me); $("homeErr").textContent = ""; };
$("hostBtn").onclick = () => { myName(); hostRoom(); };
$("joinBtn").onclick = () => {
  myName();
  const code = $("codeIn").value.trim().toUpperCase();
  if (!/^[A-Z]+-\d{2}$/.test(code)) { $("homeErr").textContent = "Room codes look like QUILL-42."; return; }
  joinRoom(code);
};
$("codeIn").onkeydown = e => { if (e.key === "Enter") $("joinBtn").click(); };
$("copyBtn").onclick = async () => {
  const link = location.origin + location.pathname + "#" + S.code;
  try { await navigator.clipboard.writeText(link); $("copyBtn").textContent = "Copied!"; }
  catch { $("copyBtn").textContent = link; }
};
document.querySelectorAll("[data-leave]").forEach(b => { b.onclick = leave; });
$("nextBtn").onclick = () => {
  S.iNext = true;
  send({ t: "next" });
  $("nextBtn").disabled = true;
  $("nextBtn").textContent = "Waiting…";
  tryNext();
};
$("soundBtn").onclick = () => { muted = !muted; store.set("noughts-muted", muted ? "1" : "0"); soundLabel(); };

// ---------- start ----------
$("nameIn").value = store.get("noughts-name") || "";
const invite = decodeURIComponent(location.hash.slice(1)).toUpperCase();
if (/^[A-Z]+-\d{2}$/.test(invite)) $("codeIn").value = invite;
soundLabel();
