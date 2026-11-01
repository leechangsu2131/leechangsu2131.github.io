(function () {
  "use strict";

  const BOARD = buildBoard();
  const ROUTES = buildRoutes();
  const YUT_FACES = {
    backdo: { name: "백도", steps: -1, animal: "뒷도", emoji: "🔙", label: "한 칸 뒤로" },
    do: { name: "도", steps: 1, animal: "돼지", emoji: "🐖", label: "한 칸" },
    gae: { name: "개", steps: 2, animal: "개", emoji: "🐕", label: "두 칸" },
    geol: { name: "걸", steps: 3, animal: "양", emoji: "🐑", label: "세 칸" },
    yut: { name: "윷", steps: 4, again: true, animal: "소", emoji: "🐄", label: "네 칸" },
    mo: { name: "모", steps: 5, again: true, animal: "말", emoji: "🐎", label: "다섯 칸" },
  };

  const state = {
    current: 0,
    players: [newPlayer(), newPlayer()],
    pendingMoves: [],
    bonusThrows: 0,
    gameOver: false,
    busy: false,
    epoch: 0,
    selected: null,
    autoTimer: null,
    teamSize: 1,
    borderBack: false,
    names: [[], []],
    member: [0, 0],
  };

  const NET = { on: false, host: false, code: "", me: null, q: 0, queue: {}, net: null, slots: null, size: 1, pid: Math.random().toString(36).slice(2, 8) };

  const el = {
    board: document.getElementById("board"),
    throwBtn: document.getElementById("throw-btn"),
    restartBtn: document.getElementById("restart-btn"),
    sticks: document.getElementById("yut-sticks"),
    resultName: document.getElementById("result-name"),
    resultSteps: document.getElementById("result-steps"),
    movesQueue: document.getElementById("moves-queue"),
    logList: document.getElementById("log-list"),
    winModal: document.getElementById("win-modal"),
    winEmblem: document.getElementById("win-emblem"),
    winText: document.getElementById("win-text"),
    winRestart: document.getElementById("win-restart"),
    throwStage: document.getElementById("throw-stage"),
    throwTitle: document.getElementById("throw-title"),
    throwSticks: document.getElementById("throw-sticks"),
    bigResult: document.getElementById("big-result"),
    throwHint: document.getElementById("throw-hint"),
    banner: document.getElementById("board-banner"),
    soundBtn: document.getElementById("sound-btn"),
  };

  function newPlayer() {
    return { home: 4, done: 0, tokens: [] };
  }

  function buildBoard() {
    const nodes = {};
    const add = (id, x, y, type) => {
      nodes[id] = { id, x, y, type: type || "edge" };
    };

    add("o0", 92, 92, "start");
    add("o1", 92, 75.2); add("o2", 92, 58.4); add("o3", 92, 41.6); add("o4", 92, 24.8);
    add("c_tr", 92, 8, "corner");
    add("t1", 75.2, 8); add("t2", 58.4, 8); add("t3", 41.6, 8); add("t4", 24.8, 8);
    add("c_tl", 8, 8, "corner");
    add("l1", 8, 24.8); add("l2", 8, 41.6); add("l3", 8, 58.4); add("l4", 8, 75.2);
    add("c_bl", 8, 92, "corner");
    add("b1", 24.8, 92); add("b2", 41.6, 92); add("b3", 58.4, 92); add("b4", 75.2, 92);

    add("d1", 78, 22); add("d2", 64, 36);
    add("center", 50, 50, "center");
    add("d3", 36, 64); add("d4", 22, 78);
    add("e1", 22, 22); add("e2", 36, 36);
    add("e3", 64, 64); add("e4", 78, 78);

    return nodes;
  }

  function buildRoutes() {
    const outerLoop = [
      "o0", "o1", "o2", "o3", "o4",
      "c_tr", "t1", "t2", "t3", "t4",
      "c_tl", "l1", "l2", "l3", "l4",
      "c_bl", "b1", "b2", "b3", "b4",
    ];
    const OUTER = outerLoop.concat(["o0", "FIN"]);

    const tr = outerLoop.indexOf("c_tr");
    const tl = outerLoop.indexOf("c_tl");
    const bl = outerLoop.indexOf("c_bl");

    const SC_TR = outerLoop.slice(0, tr + 1)
      .concat(["d1", "d2", "center", "d3", "d4"])
      .concat(outerLoop.slice(bl))
      .concat(["o0", "FIN"]);

    const SC_TL = outerLoop.slice(0, tl + 1)
      .concat(["e1", "e2", "center", "e3", "e4", "o0", "FIN"]);

    return [OUTER, SC_TR, SC_TL];
  }

  function routesThrough(nodeId) {
    const result = [];
    ROUTES.forEach((route) => {
      const idx = route.indexOf(nodeId);
      if (idx !== -1) result.push({ route, idx });
    });
    return result;
  }

  // 길 끝에는 결승 칸(출발 칸과 같은 자리)이 한 칸 더 있고, 그 칸을 지나가야 완주(FIN)이다.
  function advance(fromId, fromRoute, steps, fromIdx) {
    let route = fromRoute;
    let idx = null;
    if (route) {
      if (typeof fromIdx === "number" && route[fromIdx] === fromId) {
        idx = fromIdx;
      } else {
        idx = route.indexOf(fromId);
        if (idx === -1) route = null;
      }
    }
    // 모서리·가운데 칸에 멈춰 있던 말은 앞으로 갈 때 지름길(대각선)로 들어간다.
    // 가운데에서는 결승(출발) 쪽 대각선으로 간다.
    if (steps > 0 && (fromId === "c_tr" || fromId === "c_tl" || fromId === "center")) {
      route = preferShortcut(fromId);
      idx = route.indexOf(fromId);
    }
    if (!route) {
      if (isShortcutJunction(fromId)) {
        route = preferShortcut(fromId);
      } else {
        route = routesThrough(fromId)[0].route;
      }
      idx = route.indexOf(fromId);
    }

    // 지역 규칙: 뒷도는 테두리로만 돌아간다 (샛길 안쪽 칸은 갈라진 모서리로, 테두리 칸은 테두리 앞 칸으로)
    if (steps < 0 && state.borderBack) {
      const outer = ROUTES[0];
      const INNER_BRANCH = { d1: "c_tr", d2: "c_tr", d3: "c_tr", d4: "c_tr", e1: "c_tl", e2: "c_tl", e3: "c_tl", e4: "c_tl" };
      let branch = INNER_BRANCH[fromId] || null;
      if (fromId === "center") branch = route === ROUTES[1] ? "c_tr" : "c_tl";
      if (branch) {
        const bi = outer.indexOf(branch);
        return { finished: false, dest: branch, route: outer, idx: bi, atEnd: false, nodes: [branch] };
      }
      let oi = outer.indexOf(fromId);
      if (fromId === "o0" && idx > 0) oi = outer.length - 2;
      const ti = Math.max(0, oi + steps);
      return { finished: false, dest: outer[ti], route: outer, idx: ti, atEnd: false, nodes: [outer[ti]] };
    }

    const target = idx + steps;
    if (target >= route.length - 1) {
      return { finished: true, nodes: route.slice(idx + 1, route.length - 1) };
    }
    if (target < 0) {
      return { finished: false, dest: "o0", route: ROUTES[0], idx: 0, atEnd: false, nodes: ["o0"] };
    }
    const nodes = steps > 0 ? route.slice(idx + 1, target + 1) : [route[target]];
    return { finished: false, dest: route[target], route, idx: target, atEnd: target === route.length - 2, nodes };
  }

  function isShortcutJunction(nodeId) {
    return nodeId === "c_tr" || nodeId === "c_tl" || nodeId === "center";
  }

  function preferShortcut(nodeId) {
    if (nodeId === "c_tr") return ROUTES[1];
    if (nodeId === "c_tl") return ROUTES[2];
    if (nodeId === "center") return ROUTES[2];
    return ROUTES[0];
  }

  function computePath(token, steps) {
    const fromId = token.at;
    const fromRoute = token.route || null;
    return advance(fromId, fromRoute, steps, token.idx);
  }

  function renderBoard() {
    el.board.innerHTML = "";
    drawLines();
    for (const id in BOARD) {
      const node = BOARD[id];
      const div = document.createElement("div");
      div.className = "node";
      if (node.type === "corner") div.classList.add("node-corner");
      if (node.type === "center") div.classList.add("node-center");
      if (node.type === "start") {
        div.classList.add("node-corner");
        div.classList.add("node-start");
      }
      div.style.left = node.x + "%";
      div.style.top = node.y + "%";
      div.dataset.node = id;
      const tokWrap = document.createElement("div");
      tokWrap.className = "node-tokens";
      div.appendChild(tokWrap);
      el.board.appendChild(div);
    }
    renderTokens();
  }

  function drawLines() {
    const seg = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const line = document.createElement("div");
      line.className = "board-line";
      line.style.left = x1 + "%";
      line.style.top = y1 + "%";
      line.style.width = len + "%";
      line.style.height = "2px";
      line.style.transform = `rotate(${ang}deg)`;
      line.style.transformOrigin = "0 50%";
      el.board.appendChild(line);
    };
    seg(92, 92, 92, 8); seg(92, 8, 8, 8); seg(8, 8, 8, 92); seg(8, 92, 92, 92);
    seg(92, 8, 8, 92); seg(8, 8, 92, 92);
  }

  function renderTokens() {
    document.querySelectorAll(".node-tokens").forEach((n) => (n.innerHTML = ""));
    document.querySelectorAll(".node.movable").forEach((n) => n.classList.remove("movable"));

    state.players.forEach((player, pIdx) => {
      player.tokens.forEach((tok) => {
        const nodeEl = el.board.querySelector(`.node[data-node="${tok.at}"] .node-tokens`);
        if (!nodeEl) return;
        const t = document.createElement("div");
        t.className = "board-token p" + pIdx;
        t.textContent = tok.stack > 1 ? tok.stack : "";
        nodeEl.appendChild(t);
      });
    });

    updateStats();
  }

  function updateStats() {
    state.players.forEach((p, i) => {
      document.getElementById("home-" + i).textContent = p.home;
      document.getElementById("done-" + i).textContent = p.done;
      const tray = document.getElementById("tray-" + i);
      tray.innerHTML = "";
      for (let k = 0; k < p.home; k++) {
        const li = document.createElement("li");
        li.className = "tray-token p" + i;
        tray.appendChild(li);
      }
    });
    document.getElementById("panel-0").classList.toggle("active", state.current === 0 && !state.gameOver);
    document.getElementById("panel-1").classList.toggle("active", state.current === 1 && !state.gameOver);
    renderRoster();
    const tw = document.getElementById("turn-who");
    tw.textContent = state.gameOver ? "" : turnLabel();
    tw.className = "turn-who p" + state.current;
  }

  function turnLabel() {
    if (NET.on) return isMyTurn() ? "🎯 내 차례예요! (" + actorFull(state.current) + ")" : "⏳ " + actorFull(state.current) + " 차례";
    return "👤 " + actorFull(state.current) + " 차례";
  }

  function renderRoster() {
    [0, 1].forEach((t) => {
      const ul = document.getElementById("roster-" + t);
      ul.innerHTML = "";
      ul.hidden = state.teamSize <= 1;
      for (let i = 0; i < state.teamSize; i++) {
        const li = document.createElement("li");
        li.textContent = state.names[t][i] || i + 1 + "번";
        if (i === state.member[t]) li.className = state.current === t ? "now" : "next";
        ul.appendChild(li);
      }
    });
  }

  /* =====================================================
   *  연출: 소리 · 윷 던지기 · 말 걷기
   * ===================================================== */
  const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const snd = { on: true, ctx: null, noise: null };
  try {
    if (localStorage.getItem("yut-sound") === "off") snd.on = false;
  } catch (e) {}

  function audio() {
    if (!snd.ctx) {
      try {
        snd.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (snd.ctx.state === "suspended") snd.ctx.resume();
    return snd.ctx;
  }

  function tone(c, t, f0, f1, dur, type, vol) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function click(c, t, dur, vol, hp) {
    if (!snd.noise) {
      const len = Math.floor(c.sampleRate * 0.2);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      snd.noise = buf;
    }
    const s = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = snd.noise;
    f.type = "highpass";
    f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(c.destination);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  function sfx(name) {
    if (!snd.on) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    if (name === "clack") {
      click(c, t, 0.05, 0.5, 1500);
      tone(c, t, 240, 110, 0.09, "triangle", 0.35);
    } else if (name === "soft") {
      click(c, t, 0.04, 0.22, 1800);
      tone(c, t, 220, 120, 0.07, "triangle", 0.16);
    } else if (name === "step") {
      tone(c, t, 320, 130, 0.1, "sine", 0.4);
      click(c, t, 0.03, 0.2, 2500);
    } else if (name === "catch") {
      tone(c, t, 180, 55, 0.3, "square", 0.2);
      click(c, t, 0.08, 0.5, 800);
    } else if (name === "out") {
      tone(c, t, 320, 70, 0.5, "sawtooth", 0.16);
      click(c, t, 0.1, 0.35, 700);
    } else if (name === "thud") {
      tone(c, t, 170, 38, 0.32, "sine", 0.85);
      click(c, t, 0.06, 0.55, 700);
    } else if (name === "boom") {
      tone(c, t, 120, 30, 0.5, "sawtooth", 0.4);
      click(c, t, 0.18, 0.7, 400);
    } else if (name === "ding") {
      tone(c, t, 660, 660, 0.35, "sine", 0.22);
    } else if (name === "fanfare") {
      [523, 659, 784, 1046].forEach((f, i) => tone(c, t + i * 0.11, f, f, 0.3, "triangle", 0.2));
    }
  }

  function syncSoundBtn() {
    el.soundBtn.setAttribute("aria-pressed", snd.on ? "true" : "false");
    el.soundBtn.querySelector(".sound-label").textContent = snd.on ? "소리 켬" : "소리 끔";
  }

  /* ---------- 윷 던지기 (큰 화면 연출) ---------- */
  const stickEls = [];
  let handEl = null;

  function buildThrowSticks() {
    el.throwSticks.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const s = document.createElement("div");
      s.className = "ys";
      s.innerHTML =
        '<span class="yf flat' + (i === 0 ? " marked" : "") + '"></span><span class="yf round"></span>';
      el.throwSticks.appendChild(s);
      stickEls.push(s);
    }
    handEl = document.createElement("div");
    handEl.className = "throw-hand";
    handEl.innerHTML = `<svg viewBox="0 0 360 330" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs><linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8d3ac"/><stop offset="1" stop-color="#e6a87c"/></linearGradient></defs>
<g class="h-sleeve"><path d="M118 262 L242 262 L250 296 L110 296 Z" fill="#f7f2e6" stroke="#b9ad92" stroke-width="4" stroke-linejoin="round"/><path d="M118 262 L242 262" stroke="#c0392b" stroke-width="10" stroke-linecap="round"/></g>
<g class="h-fist">
<rect x="112" y="228" width="136" height="48" rx="20" fill="url(#skin)" stroke="#b27a52" stroke-width="4"/>
<rect x="46" y="98" width="268" height="150" rx="52" fill="url(#skin)" stroke="#b27a52" stroke-width="4"/>
<g fill="url(#skin)" stroke="#b27a52" stroke-width="4"><rect x="58" y="108" width="244" height="36" rx="18"/><rect x="58" y="140" width="244" height="36" rx="18"/><rect x="58" y="172" width="244" height="36" rx="18"/><rect x="66" y="204" width="228" height="34" rx="17"/></g>
<path d="M40 150 C14 160 18 214 66 232 C96 226 98 190 78 172 Z" fill="url(#skin)" stroke="#b27a52" stroke-width="4" stroke-linejoin="round"/>
<g stroke="#c98d62" stroke-width="3" stroke-linecap="round" opacity=".8"><path d="M84 126h30M84 158h30M84 190h30M246 126h30M246 158h30M246 190h30"/></g>
</g>
<g class="h-open">
<rect x="104" y="150" width="152" height="118" rx="40" fill="url(#skin)" stroke="#b27a52" stroke-width="4"/>
<g fill="url(#skin)" stroke="#b27a52" stroke-width="4">
<rect x="96" y="40" width="30" height="132" rx="15" transform="rotate(-20 111 172)"/>
<rect x="132" y="12" width="30" height="150" rx="15" transform="rotate(-7 147 172)"/>
<rect x="170" y="6" width="30" height="156" rx="15" transform="rotate(5 185 172)"/>
<rect x="206" y="22" width="30" height="142" rx="15" transform="rotate(17 221 172)"/>
<rect x="36" y="128" width="30" height="110" rx="15" transform="rotate(-58 70 238)"/>
</g></g>
</svg>`;
    el.throwSticks.appendChild(handEl);
  }

  function tf(x, y, z, rx, ry, rz, sc) {
    return (
      "translate3d(" + x + "px," + y + "px," + z + "px) rotateX(" + rx + "deg) rotateY(" + ry +
      "deg) rotateZ(" + rz + "deg) scale(" + sc + ")"
    );
  }


  /* ---------- 타격감 연출 도구 ---------- */
  function shake(node, amp, dur) {
    if (REDUCED || !node || !node.animate) return;
    const fr = [{ transform: "translate(0,0)" }];
    for (let k = 1; k <= 7; k++) {
      const f = 1 - k / 8;
      fr.push({ transform: "translate(" + ((Math.random() * 2 - 1) * amp * f).toFixed(1) + "px," + ((Math.random() * 2 - 1) * amp * f).toFixed(1) + "px) rotate(" + ((Math.random() * 2 - 1) * amp * 0.06 * f).toFixed(2) + "deg)" });
    }
    fr.push({ transform: "translate(0,0)" });
    node.animate(fr, { duration: dur, easing: "ease-out" });
  }

  function burst(host, x, y, n, items, power) {
    if (REDUCED || !host) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "fx-p";
      const it = items[i % items.length];
      p.textContent = it;
      p.style.fontSize = 14 + Math.random() * 26 + "px";
      host.appendChild(p);
      const a = Math.random() * Math.PI * 2;
      const d = (60 + Math.random() * 160) * (power || 1);
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d - 60 * (power || 1);
      p.animate(
        [
          { transform: "translate(" + x + "px," + y + "px) scale(0.3) rotate(0deg)", opacity: 1 },
          { transform: "translate(" + (x + dx * 0.7) + "px," + (y + dy * 0.7) + "px) scale(1.2) rotate(" + (Math.random() * 360 - 180) + "deg)", opacity: 1, offset: 0.55 },
          { transform: "translate(" + (x + dx) + "px," + (y + dy + 80) + "px) scale(0.7) rotate(" + (Math.random() * 540 - 270) + "deg)", opacity: 0 },
        ],
        { duration: 700 + Math.random() * 500, easing: "cubic-bezier(.2,.7,.4,1)" }
      ).onfinish = () => p.remove();
    }
  }

  function flash(color, op) {
    if (REDUCED) return;
    const layer = document.getElementById("fx-layer");
    if (!layer) return;
    const f = document.createElement("div");
    f.className = "fx-flash";
    f.style.background = color;
    layer.appendChild(f);
    f.animate([{ opacity: op }, { opacity: 0 }], { duration: 420, easing: "ease-out" }).onfinish = () => f.remove();
  }

  function ringPulse(power) {
    const r = document.getElementById("fx-ring");
    if (!r || REDUCED) return;
    r.animate(
      [
        { transform: "scale(0.2)", opacity: 0.95 },
        { transform: "scale(" + (2.2 + 2.2 * power) + ")", opacity: 0 },
      ],
      { duration: 520, easing: "ease-out" }
    );
  }

  // 윷이 바닥에 닿는 순간
  function landingImpact(power) {
    const scene = el.throwStage.querySelector(".throw-scene");
    shake(scene, 8 + 20 * power, 420);
    ringPulse(power);
    const mat = el.throwStage.querySelector(".throw-mat");
    if (mat) {
      const hr = el.throwStage.getBoundingClientRect();
      const mr = mat.getBoundingClientRect();
      burst(document.getElementById("fx-layer"), mr.left - hr.left + mr.width / 2, mr.top - hr.top + 6, 12 + Math.round(10 * power), ["•", "·", "●"], 1 + power);
    }
    sfx("thud");
    try { if (navigator.vibrate) navigator.vibrate(25 + 40 * power); } catch (e) {}
  }

  function throwHandSwing(power) {
    if (!handEl || REDUCED) return;
    handEl.getAnimations().forEach((a) => a.cancel());
    const from = handEl.style.transform || "translateY(20px)";
    handEl.animate(
      [
        { transform: from, opacity: 1 },
        { transform: "translateY(-" + (50 + 70 * power) + "px) rotate(-10deg) scale(1.08)", opacity: 1, offset: 0.3 },
        { transform: "translateY(-" + (90 + 110 * power) + "px) rotate(6deg) scale(1.04)", opacity: 1, offset: 0.55 },
        { transform: "translateY(" + (120 + 60 * power) + "px) rotate(0deg) scale(1)", opacity: 0 },
      ],
      { duration: 900, easing: "cubic-bezier(.3,.8,.4,1)", fill: "forwards" }
    );
    setTimeout(() => { if (handEl) handEl.classList.add("open"); }, 150);
  }

  function boardPunch(amp) {
    shake(el.board, amp, 380);
  }

  /* ---------- 팀 · 친구 이름 ---------- */
  function actorFull(team) {
    const t = team === 0 ? "홍팀" : "청팀";
    const i = state.teamSize <= 1 ? 0 : state.member[team];
    const nm = state.names[team][i];
    if (nm) return t + " " + nm;
    return state.teamSize <= 1 ? t : t + " " + (i + 1) + "번 친구";
  }

  function actor() {
    return actorFull(state.current);
  }

  /* ---------- 힘 조절 (끌었다 놓아 던지기) ---------- */
  const POWER_MIN = 0.12;
  const POWER_LOW = 0.3; // 이보다 약하면 "약함"
  const POWER_SAFE = 0.68; // 이보다 세면 낙 위험
  const FACE_OUT = { name: "낙", steps: 0, out: true, animal: "윷이 판 밖으로 나갔어요", label: "이번 던지기는 무효" };
  let padAbort = null;

  function outChance(power) {
    if (power <= POWER_SAFE) return 0;
    return Math.min(0.9, ((power - POWER_SAFE) / (1 - POWER_SAFE)) * 0.9);
  }

  function heldPose(offset, i) {
    return tf((i - 1.5) * -5, offset, 0, 0, 0, (i - 1.5) * 4, 0.82);
  }

  // 타이밍 방식: 화면을 꾹 누르면 게이지가 오르락내리락하고, 손을 놓는 순간의 힘으로 던진다.
  function readyPad(epoch) {
    return new Promise((resolve) => {
      const st = el.throwStage;
      const fill = document.getElementById("gauge-fill");
      const msg = document.getElementById("pad-msg");
      let charging = false;
      let t0 = 0;
      let period = 1000;
      let raf = 0;
      let pw = 0;

      el.throwTitle.textContent = actor() + " 차례! 윷을 던져요";
      el.bigResult.innerHTML = "";
      el.bigResult.className = "big-result";
      el.throwHint.classList.remove("show");
      stickEls.forEach((s, i) => {
        s.getAnimations().forEach((a) => a.cancel());
        s.style.transform = heldPose(20, i);
      });
      if (handEl) {
        handEl.getAnimations().forEach((a) => a.cancel());
        handEl.classList.remove("open");
        handEl.style.opacity = "1";
        handEl.style.transform = "translateY(20px)";
      }
      st.classList.remove("out");
      st.classList.add("ready");
      st.hidden = false;
      fill.style.width = "0%";
      fill.className = "weak";
      msg.textContent = "화면을 꾹 누르고 있다가, 게이지가 초록색일 때 손을 놓으세요!";

      const paint = () => {
        fill.style.width = Math.round(pw * 100) + "%";
        fill.className = pw < POWER_LOW ? "weak" : pw > POWER_SAFE ? "over" : "good";
        stickEls.forEach((s, i) => { s.style.transform = heldPose(20 + pw * 40, i); });
        if (handEl) handEl.style.transform = "translateY(" + (20 + pw * 40) + "px) rotate(" + ((Math.random() - 0.5) * pw * 8) + "deg)";
        msg.textContent = pw < POWER_LOW ? "아직 약해요…" : pw > POWER_SAFE ? "너무 세요! 윷이 나갈 수 있어요" : "지금이에요! 손을 놓으세요!";
      };

      const tick = (now) => {
        if (!charging) return;
        const ph = ((now - t0) / period) % 1;
        pw = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
        paint();
        raf = requestAnimationFrame(tick);
      };

      const finish = (val) => {
        charging = false;
        cancelAnimationFrame(raf);
        st.removeEventListener("pointerdown", onDown);
        st.removeEventListener("pointerup", onUp);
        st.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("keydown", onKey);
        document.getElementById("pad-normal").onclick = null;
        document.getElementById("pad-cancel").onclick = null;
        st.classList.remove("ready");
        padAbort = null;
        resolve(val);
      };
      const onDown = (e) => {
        if (e.target.closest(".pad-btn") || charging) return;
        try { st.setPointerCapture(e.pointerId); } catch (err) {}
        charging = true;
        period = 800 + Math.random() * 600; // 던질 때마다 눈금 속도가 달라요
        t0 = performance.now();
        raf = requestAnimationFrame(tick);
      };
      const onUp = () => {
        if (!charging) return;
        charging = false;
        cancelAnimationFrame(raf);
        if (pw < POWER_MIN) {
          pw = 0;
          paint();
          msg.textContent = "너무 빨리 놓았어요! 다시 꾹 눌러 보세요";
          return;
        }
        finish(pw);
      };
      const onCancel = () => {
        charging = false;
        cancelAnimationFrame(raf);
        pw = 0;
        paint();
        msg.textContent = "화면을 꾹 누르고 있다가, 게이지가 초록색일 때 손을 놓으세요!";
      };
      const onKey = (e) => { if (e.key === "Escape") finish("cancel"); };

      st.addEventListener("pointerdown", onDown);
      st.addEventListener("pointerup", onUp);
      st.addEventListener("pointercancel", onCancel);
      document.addEventListener("keydown", onKey);
      document.getElementById("pad-normal").onclick = () => finish(0.25 + Math.random() * 0.65);
      document.getElementById("pad-cancel").onclick = () => finish("cancel");
      padAbort = () => finish("cancel");
    });
  }

  async function playThrow(flats, face, epoch, power, outSet) {
    const st = el.throwStage;
    el.throwTitle.textContent = actor() + " 던졌어요! (힘 " + Math.round(power * 100) + "%)";
    el.bigResult.innerHTML = "";
    el.bigResult.className = "big-result";
    el.throwHint.classList.remove("show");
    st.classList.remove("out", "ready");
    st.hidden = false;

    throwHandSwing(power);
    setTimeout(() => { if (epoch === state.epoch) landingImpact(power); }, REDUCED ? 100 : Math.round((1100 + 700 * power) * 0.72 + 120));
    const H = el.throwSticks.clientHeight || 220;
    const W = st.clientWidth || 400;
    const dur = REDUCED ? 350 : Math.round(1100 + 700 * power);
    const gap = REDUCED ? 0 : 80;
    const lift = 0.6 + 1.4 * power;
    const finals = [];

    stickEls.forEach((s, i) => {
      const flat = flats[i];
      const isOut = outSet.has(i);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const jx = Math.random() * 14 - 7;
      const jz = Math.random() * 10 - 5;
      const turns = 1 + Math.floor(power * 3) + (Math.random() < 0.5 ? 1 : 0);
      const spinX = turns * 360;
      const spinY = (flat ? 0 : 180) + (2 + Math.floor(power * 2) + (Math.random() < 0.5 ? 1 : 0)) * 360;
      const apex = -(H * lift + Math.random() * H * 0.25);
      const dx = (Math.random() * 40 - 20) * (0.6 + power);
      const start = tf(dx * 0.5, H * 0.45, 0, 0, 0, -10, 0.82);
      const bounce = H * (0.07 + 0.12 * power);
      let frames;
      if (isOut) {
        finals[i] = tf(dir * W * 0.95, H * 0.15, 0, 0, 0, dir * 60, 1);
        frames = [
          { offset: 0, transform: start, easing: "cubic-bezier(.15,.7,.35,1)" },
          { offset: 0.4, transform: tf(dx, apex, 140, spinX * 0.6, spinY * 0.6, jz * 3, 1.25), easing: "cubic-bezier(.55,0,.85,.45)" },
          { offset: 0.62, transform: tf(dir * W * 0.18, 0, 0, spinX, spinY, jz * 3, 1), easing: "cubic-bezier(.2,.6,.4,1)" },
          { offset: 0.8, transform: tf(dir * W * 0.45, -H * 0.18, 0, spinX * 1.2, spinY, jz * 8, 1), easing: "ease-in" },
          { offset: 1, transform: finals[i] },
        ];
      } else {
        const fin = tf(jx, 0, 0, spinX, spinY, jz, 1);
        finals[i] = tf(jx, 0, 0, 0, flat ? 0 : 180, jz, 1);
        frames = [
          { offset: 0, transform: start, easing: "cubic-bezier(.15,.7,.35,1)" },
          { offset: 0.42, transform: tf(dx, apex, 140, spinX * 0.62, spinY * 0.62, jz * 3, 1.25), easing: "cubic-bezier(.55,0,.85,.45)" },
          { offset: 0.72, transform: fin, easing: "cubic-bezier(.2,.6,.4,1)" },
          { offset: 0.84, transform: tf(jx, -bounce, 0, spinX, spinY, jz, 1), easing: "cubic-bezier(.5,0,.8,.5)" },
          { offset: 0.92, transform: fin, easing: "cubic-bezier(.2,.6,.4,1)" },
          { offset: 0.96, transform: tf(jx, -bounce * 0.3, 0, spinX, spinY, jz, 1), easing: "cubic-bezier(.5,0,.8,.5)" },
          { offset: 1, transform: fin },
        ];
      }
      s.animate(frames, { duration: dur, delay: i * gap, fill: "both", easing: "linear" });
      if (isOut) {
        setTimeout(() => { if (epoch === state.epoch) sfx("out"); }, i * gap + dur * 0.62);
      } else {
        setTimeout(() => { if (epoch === state.epoch) sfx("clack"); }, i * gap + dur * 0.72);
        setTimeout(() => { if (epoch === state.epoch) sfx("soft"); }, i * gap + dur * 0.92);
      }
    });

    await sleep(dur + 3 * gap + 80);
    if (epoch !== state.epoch) return;

    stickEls.forEach((s, i) => {
      s.style.transform = finals[i];
      s.getAnimations().forEach((a) => a.cancel());
    });

    el.bigResult.innerHTML =
      '<div class="br-row">' +
      (face.emoji ? '<span class="br-animal' + (face.again ? " again" : "") + '">' + face.emoji + "</span>" : face.out ? '<span class="br-animal">💨</span>' : "") +
      '<b class="br-name">' + face.name + (face.out ? "!" : "") + "</b></div>" +
      '<span class="br-sub">' + face.animal + " · " + face.label + "</span>" +
      (face.again ? '<em class="br-again">한 번 더!</em>' : "");
    {
      const sc = el.throwStage.querySelector(".throw-scene");
      const hr = el.throwStage.getBoundingClientRect();
      if (face.out) {
        flash("#ff3b2f", 0.45);
        shake(sc, 26, 520);
        sfx("boom");
      } else if (face.again) {
        flash("#ffe27a", 0.6);
        shake(sc, 22, 520);
        sfx("boom");
        burst(document.getElementById("fx-layer"), hr.width / 2, hr.height * 0.32, 34, ["🎉", "✨", "⭐", "🎊", "💫"], 1.6);
      } else {
        flash("#fff3c9", 0.3);
        shake(sc, 10, 360);
      }
    }
    el.bigResult.className = "big-result show" + (face.again ? " big" : "") + (face.out ? " bad" : "");
    el.throwHint.classList.add("show");
    sfx(face.out ? "out" : face.again ? "fanfare" : "ding");

    const hold = REDUCED ? 500 : face.out ? 1700 : face.again ? 1800 : 1250;
    await new Promise((res) => {
      const t = setTimeout(res, hold);
      st.onclick = () => { clearTimeout(t); res(); };
    });
    st.onclick = null;
    if (epoch !== state.epoch) return;
    st.classList.add("out");
    await sleep(230);
    if (epoch !== state.epoch) return;
    st.hidden = true;
  }

  async function throwYut() {
    if (state.gameOver || state.busy || el.throwBtn.disabled) return;
    if (NET.on && !isMyTurn()) return;
    audio();
    el.throwBtn.disabled = true;
    state.busy = true;
    const epoch = state.epoch;

    const power = await readyPad(epoch);
    if (epoch !== state.epoch) return;
    if (power === "cancel") {
      el.throwStage.hidden = true;
      state.busy = false;
      el.throwBtn.disabled = false;
      return;
    }

    const flats = [0, 0, 0, 0].map(() => Math.random() < 0.5);
    const isOut = Math.random() < outChance(power);
    const outSet = new Set();
    if (isOut) {
      const n = power > 0.92 && Math.random() < 0.5 ? 2 : 1;
      const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      for (let k = 0; k < n; k++) outSet.add(order[k]);
    }
    if (NET.on) netSend({ t: "throw", flats: flats, out: [...outSet], power: power });
    await resolveThrow(flats, outSet, power, epoch);
  }

  // 다른 친구가 던진 것을 똑같이 보여 주고 적용한다 (온라인)
  function remoteThrow(m) {
    audio();
    el.throwBtn.disabled = true;
    state.busy = true;
    return resolveThrow(m.flats, new Set(m.out || []), m.power, state.epoch);
  }

  async function resolveThrow(flats, outSet, power, epoch) {
    const isOut = outSet.size > 0;
    const face = isOut ? FACE_OUT : resolveFace(flats.filter(Boolean).length, flats);

    await playThrow(flats, face, epoch, power, outSet);
    if (epoch !== state.epoch) return;

    state.busy = false;
    if (isOut) {
      applyOut();
      return;
    }
    el.sticks.querySelectorAll(".stick").forEach((s, i) => {
      s.dataset.face = flats[i] ? "up" : "down";
    });
    applyFace(face);
  }

  // 낙: 윷이 판 밖으로 나가면 이번 던지기는 없던 일로 한다.
  function applyOut() {
    el.resultName.textContent = "낙";
    el.resultSteps.textContent = "이번 던지기는 무효";
    log(`${actor()} 윷이 판 밖으로 나갔어요! 낙 (이번 던지기는 무효)`, state.current);
    el.throwBtn.disabled = true;
    if (state.pendingMoves.length > 0 && hasAnyMove()) {
      highlightMovable();
      return;
    }
    state.pendingMoves = [];
    renderMovesQueue();
    finishOrBonus();
  }

  /* ---------- 말 걷기 (한 칸씩 폴짝) ---------- */
  function banner(text, kind) {
    const b = el.banner;
    b.textContent = text;
    b.className = "board-banner " + (kind || "");
    void b.offsetWidth;
    b.classList.add("show");
  }

  function placeAt(w, id) {
    w.style.left = BOARD[id].x + "%";
    w.style.top = BOARD[id].y + "%";
  }

  function makeWalker(pIdx, stack, id) {
    const w = document.createElement("div");
    w.className = "walker";
    w.innerHTML =
      '<i class="walker-shadow"></i><b class="walker-body p' + pIdx + '">' + (stack > 1 ? stack : "") + "</b>";
    placeAt(w, id);
    el.board.appendChild(w);
    return w;
  }

  function ripple(id) {
    const n = el.board.querySelector('.node[data-node="' + id + '"]');
    if (!n) return;
    n.classList.remove("land");
    void n.offsetWidth;
    n.classList.add("land");
    setTimeout(() => n.classList.remove("land"), 500);
  }

  async function hop(w, fromId, toId) {
    const a = BOARD[fromId];
    const b = BOARD[toId];
    const dur = REDUCED ? 80 : 340;
    const h = Math.round((el.board.clientHeight || 400) * 0.075);
    const body = w.querySelector(".walker-body");
    const sh = w.querySelector(".walker-shadow");
    w.animate(
      [{ left: a.x + "%", top: a.y + "%" }, { left: b.x + "%", top: b.y + "%" }],
      { duration: dur, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }
    );
    body.animate(
      [
        { transform: "translateY(0) scale(1.12,.86)" },
        { transform: "translateY(" + -h + "px) scale(.94,1.1)", offset: 0.45 },
        { transform: "translateY(0) scale(1.18,.82)", offset: 0.9 },
        { transform: "translateY(0) scale(1,1)" },
      ],
      { duration: dur + 90, easing: "ease-out" }
    );
    sh.animate(
      [
        { transform: "scale(1)", opacity: 0.4 },
        { transform: "scale(.55)", opacity: 0.15, offset: 0.45 },
        { transform: "scale(1.12)", opacity: 0.45, offset: 0.9 },
        { transform: "scale(1)", opacity: 0.4 },
      ],
      { duration: dur + 90 }
    );
    await sleep(dur);
    placeAt(w, toId);
    w.getAnimations().forEach((x) => x.cancel());
    sfx("step");
    ripple(toId);
    await sleep(REDUCED ? 20 : 90);
  }

  // 남은 말 칸에서 판 위 출발점까지 날아와 놓이는 동작
  async function fly(w, from, toId) {
    const b = BOARD[toId];
    const dur = REDUCED ? 100 : 600;
    const h = Math.round((el.board.clientHeight || 400) * 0.16);
    const body = w.querySelector(".walker-body");
    const sh = w.querySelector(".walker-shadow");
    placeAt(w, toId);
    w.animate(
      [{ left: from.x + "%", top: from.y + "%" }, { left: b.x + "%", top: b.y + "%" }],
      { duration: dur, easing: "cubic-bezier(.35,0,.55,1)", fill: "forwards" }
    );
    body.animate(
      [
        { transform: "translateY(0) scale(.48)" },
        { transform: "translateY(" + -h + "px) scale(1.15)", offset: 0.5 },
        { transform: "translateY(0) scale(1.18,.84)", offset: 0.92 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: dur + 90, easing: "ease-out" }
    );
    sh.animate([{ opacity: 0 }, { opacity: 0.4, offset: 0.8 }, { opacity: 0.4 }], { duration: dur + 90 });
    await sleep(dur);
    placeAt(w, toId);
    w.getAnimations().forEach((x) => x.cancel());
    sfx("step");
    ripple(toId);
    await sleep(REDUCED ? 20 : 120);
  }

  async function runMove(startId, result, stackCount, fromHome, fromPos, usedSteps) {
    const epoch = state.epoch;
    const pIdx = state.current;
    state.busy = true;
    const w = makeWalker(pIdx, stackCount, startId);
    const body = w.querySelector(".walker-body");

    if (fromHome && fromPos) {
      await fly(w, fromPos, startId);
      if (epoch !== state.epoch) return;
    } else if (fromHome) {
      body.animate(
        [
          { transform: "translateY(-70px) scale(1.5)", opacity: 0 },
          { transform: "translateY(0) scale(1.15,.85)", opacity: 1, offset: 0.7 },
          { transform: "translateY(0) scale(1)", opacity: 1 },
        ],
        { duration: REDUCED ? 80 : 380, easing: "ease-in" }
      );
      await sleep(REDUCED ? 80 : 400);
      sfx("step");
      ripple(startId);
      await sleep(REDUCED ? 20 : 90);
    }

    let prev = startId;
    for (const id of result.nodes) {
      if (id !== prev) {
        await hop(w, prev, id);
        if (epoch !== state.epoch) return;
      }
      prev = id;
    }

    const player = state.players[pIdx];
    if (result.finished) {
      if (prev !== "o0") await hop(w, prev, "o0");
      if (epoch !== state.epoch) return;
      banner("완주!", "done");
      sfx("fanfare");
      body.animate(
        [
          { transform: "translateY(0) scale(1)", opacity: 1 },
          { transform: "translateY(-30px) scale(1.7)", opacity: 0 },
        ],
        { duration: REDUCED ? 80 : 600, fill: "forwards", easing: "ease-out" }
      );
      await sleep(REDUCED ? 100 : 700);
    } else {
      const dest = result.dest;
      const opp = state.players[1 - pIdx];
      if (opp.tokens.some((t) => t.at === dest)) {
        banner("잡았다!", "catch");
        sfx("catch");
        el.board.querySelectorAll('.node[data-node="' + dest + '"] .board-token').forEach((v) => {
          v.animate(
            [
              { transform: "none", opacity: 1 },
              { transform: "translate(-20px,-46px) rotate(300deg) scale(1.3)", opacity: 0 },
            ],
            { duration: REDUCED ? 80 : 650, fill: "forwards", easing: "ease-in" }
          );
        });
        await sleep(REDUCED ? 100 : 750);
      } else if (player.tokens.some((t) => t.at === dest)) {
        banner("업었다!", "stack");
        sfx("ding");
        await sleep(REDUCED ? 100 : 450);
      }
    }
    if (epoch !== state.epoch) return;

    w.remove();
    state.busy = false;
    finalizeMove(result, stackCount, usedSteps);
  }

  function resolveFace(upCount, flats) {
    if (upCount === 0) return YUT_FACES.mo;
    if (upCount === 4) return YUT_FACES.yut;
    if (upCount === 1) {
      const markedUp = flats[0];
      return markedUp ? YUT_FACES.backdo : YUT_FACES.do;
    }
    if (upCount === 2) return YUT_FACES.gae;
    return YUT_FACES.geol;
  }

  function applyFace(face) {
    el.resultName.innerHTML = '<span class="res-animal">' + (face.emoji || "") + "</span>" + face.name;
    el.resultSteps.textContent = face.steps > 0 ? `+${face.steps}칸` : `${face.steps}칸`;
    log(`${actor()} ${face.name}${face.again ? " (한 번 더!)" : ""}`, state.current);

    state.pendingMoves.push(face.steps);
    renderMovesQueue();

    if (face.again) {
      enableThrow("한 번 더 던지기!");
      log(`${who(state.current)} 한 번 더 던지세요.`, state.current);
      return;
    }

    el.throwBtn.disabled = true;

    if (hasAnyMove()) {
      highlightMovable();
    } else {
      log("움직일 수 있는 말이 없어 차례를 넘깁니다.", null);
      state.pendingMoves = [];
      renderMovesQueue();
      finishOrBonus();
    }
  }

  function hasAnyMove() {
    return state.pendingMoves.some((s) => listMovableTokens(s).length > 0);
  }

  function listMovableTokens(steps) {
    const player = state.players[state.current];
    const result = [];
    if (steps > 0 && player.home > 0) {
      result.push({ kind: "home" });
    }
    const seen = {};
    player.tokens.forEach((tok) => {
      if (seen[tok.at]) return;
      seen[tok.at] = true;
      result.push({ kind: "board", at: tok.at });
    });
    return result;
  }

  function renderMovesQueue() {
    el.movesQueue.innerHTML = "";
    state.pendingMoves.forEach((s) => {
      const chip = document.createElement("div");
      chip.className = "move-chip";
      chip.innerHTML = '<span class="mc-a">' + (STEP_EMOJI[s] || "") + "</span>" + (STEP_NAME[s] || "") + " " + (s > 0 ? "+" + s : s);
      el.movesQueue.appendChild(chip);
    });
  }

  const STEP_EMOJI = { "-1": "🔙", 1: "🐖", 2: "🐕", 3: "🐑", 4: "🐄", 5: "🐎" };
  const STEP_NAME = { "-1": "백도", 1: "도", 2: "개", 3: "걸", 4: "윷", 5: "모" };
  const guideEl = document.getElementById("guide");

  function setGuide(text) {
    guideEl.textContent = text || "";
    guideEl.classList.toggle("on", !!text);
  }

  function nodeEl(id) {
    return el.board.querySelector('.node[data-node="' + id + '"]');
  }

  function pieceSources() {
    const player = state.players[state.current];
    const list = [];
    if (player.home > 0 && state.pendingMoves.some((s) => s > 0)) list.push({ kind: "home" });
    const seen = {};
    player.tokens.forEach((t) => {
      if (!seen[t.at]) {
        seen[t.at] = true;
        list.push({ kind: "board", at: t.at });
      }
    });
    return list;
  }

  function sameSrc(a, b) {
    return !!a && !!b && a.kind === b.kind && a.at === b.at;
  }

  function previewMove(src, steps) {
    const player = state.players[state.current];
    let r;
    if (src.kind === "home") {
      if (steps <= 0 || player.home <= 0) return null;
      r = advance("o0", ROUTES[0], steps, 0);
    } else {
      const tok = player.tokens.find((t) => t.at === src.at);
      if (!tok) return null;
      r = computePath(tok, steps);
    }
    return { finished: !!r.finished, atEnd: !!r.atEnd, dest: r.finished ? "o0" : r.dest, nodes: r.nodes || [] };
  }

  // 던진 뒤 말을 고르는 단계: 말 누르기 → 갈 수 있는 칸이 미리 보임 → 칸 누르기
  function highlightMovable() {
    state.selected = null;
    refreshChoices();
  }

  function refreshChoices() {
    clearHighlights(true);
    if (state.busy) return;
    if (NET.on && !isMyTurn()) {
      state.selected = null;
      setGuide("👀 " + actor() + " 차례예요. 말이 움직이는 걸 지켜봐요!");
      return;
    }
    const srcs = pieceSources();
    if (srcs.length === 0) return;
    if (!state.selected || !srcs.some((x) => sameSrc(x, state.selected))) {
      state.selected = srcs.length === 1 ? srcs[0] : null;
    }
    srcs.forEach((src) => {
      if (src.kind === "home") {
        const tray = document.getElementById("tray-" + state.current);
        tray.classList.add("home-ready");
        tray.onclick = () => selectPiece(src);
      } else {
        const n = nodeEl(src.at);
        if (n) {
          n.classList.add("movable");
          n.onclick = () => selectPiece(src);
        }
      }
    });
    const info = showDestinations(srcs);
    // 고를 수 있는 게 하나뿐이면(예: 처음 말 놓기) 잠깐 보여 준 뒤 저절로 움직인다.
    if (info && srcs.length === 1 && info.count === 1) {
      const sel = state.selected;
      const st = info.steps;
      setGuide("움직일 수 있는 말이 하나뿐이에요. 저절로 움직여요! (칸을 눌러도 돼요)");
      state.autoTimer = setTimeout(() => {
        state.autoTimer = null;
        if (!state.busy && sameSrc(state.selected, sel)) executeMove(sel, st);
      }, REDUCED ? 150 : 1300);
    }
  }

  function selectPiece(src) {
    if (state.busy) return;
    state.selected = sameSrc(state.selected, src) ? null : src;
    refreshChoices();
  }

  function showDestinations(srcs) {
    const sel = state.selected;
    if (!sel) {
      const hasHome = srcs.some((x) => x.kind === "home");
      setGuide(
        hasHome
          ? "👆 통통 뛰는 말을 눌러 고르세요. '남은 말'을 누르면 새 말을 판에 놓아요."
          : "👆 통통 뛰는 말을 눌러 고르세요."
      );
      return null;
    }
    if (sel.kind === "home") {
      document.getElementById("tray-" + state.current).classList.add("selected");
    } else {
      const sn = nodeEl(sel.at);
      if (sn) sn.classList.add("selected");
    }

    const player = state.players[state.current];
    const opp = state.players[1 - state.current];
    const list = [];
    [...new Set(state.pendingMoves)].forEach((st) => {
      const pv = previewMove(sel, st);
      if (!pv) return;
      const same = list.find((x) => x.pv.dest === pv.dest && x.pv.finished === pv.finished);
      if (!same) list.push({ steps: st, pv });
      else if (pv.finished && st < same.steps) {
        same.steps = st;
        same.pv = pv;
      }
    });
    const byNode = new Map();
    list.forEach((o) => {
      if (!byNode.has(o.pv.dest)) byNode.set(o.pv.dest, []);
      byNode.get(o.pv.dest).push(o);
    });
    const opts = { size: list.length, values: () => list };

    byNode.forEach((group, destId) => {
      const n = nodeEl(destId);
      if (!n) return;
      group.forEach((o) => {
        o.pv.nodes.forEach((pid) => {
          if (pid === destId) return;
          const pn = nodeEl(pid);
          if (pn) pn.classList.add("on-path");
        });
      });
      n.classList.add("dest");
      const m = document.createElement("div");
      m.className = "dest-marker p" + state.current;
      const wrap = document.createElement("div");
      wrap.className = "dest-labels";
      group.forEach((o) => {
        let label = STEP_NAME[o.steps] || "";
        if (o.pv.finished) label += " · 완주!";
        else if (opp.tokens.some((t) => t.at === destId)) label += " · 잡기!";
        else if (o.pv.atEnd) label += " · 결승 칸 도착";
        else if (player.tokens.some((t) => t.at === destId && !(sel.kind === "board" && sel.at === destId))) label += " · 업기";
        const sp = document.createElement("span");
        sp.className = "dest-label";
        sp.textContent = label;
        if (group.length > 1) {
          sp.classList.add("pick");
          sp.style.pointerEvents = "auto";
          sp.onclick = (ev) => { ev.stopPropagation(); executeMove(sel, o.steps); };
        }
        wrap.appendChild(sp);
      });
      m.appendChild(wrap);
      n.appendChild(m);
      if (group.length === 1) n.onclick = () => executeMove(sel, group[0].steps);
    });

    setGuide(
      opts.size > 1
        ? "가고 싶은 칸을 누르세요. 초록색 칸마다 쓸 윷 결과가 적혀 있어요."
        : "초록색으로 반짝이는 칸을 누르면 말이 움직여요."
    );
    const only = opts.size === 1 ? list[0] : null;
    return { count: opts.size, steps: only ? only.steps : 0 };
  }

  function executeMove(src, steps) {
    if (state.busy) return;
    if (NET.on) {
      if (!isMyTurn()) return;
      netSend({ t: "move", src: { kind: src.kind, at: src.at || null }, steps: steps });
    }
    doMove(src, steps);
  }

  function doMove(src, steps) {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    if (src.kind === "home") enterFromHome(steps);
    else moveToken(src.at, steps);
  }

  function clearChipHandlers() {
    el.movesQueue.querySelectorAll(".move-chip").forEach((chip) => {
      chip.onclick = null;
      chip.style.cursor = "";
      chip.style.outlineColor = "";
    });
  }

  function consumeMove(steps) {
    const idx = state.pendingMoves.indexOf(steps);
    if (idx !== -1) state.pendingMoves.splice(idx, 1);
    renderMovesQueue();
  }

  function enterFromHome(steps) {
    const player = state.players[state.current];
    let fromPos = null;
    const lastTk = document.getElementById("tray-" + state.current).lastElementChild;
    if (lastTk) {
      const r = lastTk.getBoundingClientRect();
      const br = el.board.getBoundingClientRect();
      fromPos = {
        x: ((r.left + r.width / 2 - br.left) / br.width) * 100,
        y: ((r.top + r.height / 2 - br.top) / br.height) * 100,
      };
    }
    player.home -= 1;
    consumeMove(steps);
    clearChipHandlers();
    clearHighlights();
    renderTokens();
    // 출발점(o0)에서 윷 결과만큼 앞으로: 도=첫째 칸, 모=모서리
    const result = advance("o0", ROUTES[0], steps, 0);
    runMove("o0", result, 1, true, fromPos, steps);
  }

  function moveToken(at, steps) {
    const player = state.players[state.current];
    const group = player.tokens.filter((t) => t.at === at);
    if (group.length === 0) return;
    const token = group[0];
    const result = computePath(token, steps);
    const stackCount = token.stack;
    player.tokens = player.tokens.filter((t) => t !== token);
    consumeMove(steps);
    clearChipHandlers();
    clearHighlights();
    renderTokens();
    runMove(at, result, stackCount, false, null, steps);
  }

  function clearHighlights(keepSelected) {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    document.querySelectorAll(".dest-marker").forEach((m) => m.remove());
    document.querySelectorAll(".node").forEach((n) => {
      n.classList.remove("movable", "selected", "dest", "on-path");
      n.onclick = null;
    });
    state.players.forEach((_, i) => {
      const tray = document.getElementById("tray-" + i);
      tray.classList.remove("home-ready", "selected");
      tray.onclick = null;
    });
    if (!keepSelected) state.selected = null;
    setGuide("");
  }

  function finalizeMove(result, stackCount, usedSteps) {
    clearChipHandlers();
    clearHighlights();

    const player = state.players[state.current];

    if (result.finished) {
      player.done += stackCount;
      log(`${who(state.current)} 말 ${stackCount}개 완주!`, state.current);
      afterMove();
      return;
    }

    const dest = result.dest;
    captured(dest, usedSteps);

    const existing = player.tokens.filter((t) => t.at === dest);
    if (existing.length > 0) {
      existing[0].stack += stackCount;
      existing[0].route = result.route;
      existing[0].idx = result.idx;
      log(`${who(state.current)} 말을 업었습니다.`, state.current);
    } else {
      player.tokens.push({ at: dest, stack: stackCount, route: result.route, idx: result.idx });
    }

    renderTokens();
    afterMove();
  }

  // 잡기 보너스: 윷·모로 잡으면 (윷·모로 이미 받은 '한 번 더'와 합쳐) 따로 더 주지 않는다.
  // 도·개·걸로 잡으면 한 번 더. 한 번에 여러 말을 잡거나 잡으면서 업어도 한 번만.
  function captured(dest, usedSteps) {
    const opp = state.players[1 - state.current];
    const victims = opp.tokens.filter((t) => t.at === dest);
    if (victims.length > 0) {
      let count = 0;
      victims.forEach((v) => (count += v.stack));
      opp.tokens = opp.tokens.filter((t) => t.at !== dest);
      opp.home += count;
      boardPunch(18);
      sfx("boom");
      try {
        const nb = nodeEl(dest);
        if (nb) {
          const br = el.board.getBoundingClientRect(), r2 = nb.getBoundingClientRect();
          burst(el.board, r2.left - br.left + r2.width / 2, r2.top - br.top + r2.height / 2, 18, ["💥", "⭐", "✨"], 1.2);
        }
      } catch (e) {}
      if (usedSteps >= 4) {
        log(`${who(state.current)} 상대 말 ${count}개를 잡았습니다! (윷·모로 잡아서 '한 번 더'는 이미 받았어요)`, state.current);
      } else {
        state.bonusThrows += 1;
        log(`${who(state.current)} 상대 말 ${count}개를 잡았습니다! (한 번 더)`, state.current);
      }
    }
  }

  function afterMove() {
    renderTokens();

    if (checkWin()) return;

    renderMovesQueue();

    if (state.pendingMoves.length > 0) {
      if (hasAnyMove()) {
        el.throwBtn.disabled = true;
        highlightMovable();
        return;
      }
      log("남은 이동을 사용할 말이 없습니다.", null);
      state.pendingMoves = [];
      renderMovesQueue();
    }

    finishOrBonus();
  }

  // 말을 다 움직인 뒤: 남은 던질 기회가 있으면 던지게 하고, 없으면 차례를 넘긴다.
  function finishOrBonus() {
    if (state.bonusThrows > 0) {
      state.bonusThrows -= 1;
      enableThrow("한 번 더 던지기!");
      log(`${who(state.current)} 잡아서 한 번 더! 윷을 던지세요.`, state.current);
      return;
    }
    if (!el.throwBtn.disabled) {
      log(`${who(state.current)} 한 번 더 던지세요.`, state.current);
      return;
    }
    endTurn();
  }

  function enableThrow(label) {
    el.throwBtn.disabled = false;
    document.getElementById("throw-label").textContent =
      NET.on && !isMyTurn() ? "기다려요…" : label || "윷 던지기";
    el.throwBtn.classList.toggle("waiting", NET.on && !isMyTurn());
  }

  function checkWin() {
    const p = state.players[state.current];
    if (p.done >= 4) {
      state.gameOver = true;
      showWin(state.current);
      return true;
    }
    return false;
  }

  function endTurn() {
    if (state.teamSize > 1) state.member[state.current] = (state.member[state.current] + 1) % state.teamSize;
    state.current = 1 - state.current;
    state.pendingMoves = [];
    renderMovesQueue();
    el.resultName.textContent = `${actorFull(state.current)} 차례`;
    el.resultSteps.textContent = "";
    state.bonusThrows = 0;
    enableThrow("윷 던지기");
    updateStats();
  }

  function showWin(winner) {
    el.winEmblem.className = "win-emblem p" + winner;
    document.getElementById("win-title").textContent = `${who(winner)} 승리!`;
    el.winText.textContent = `${who(winner)}이(가) 말 4개를 모두 완주했습니다.`;
    el.winModal.hidden = false;
    el.throwBtn.disabled = true;
  }

  function who(idx) {
    return idx === 0 ? "홍" : "청";
  }

  function log(msg, playerIdx) {
    const li = document.createElement("li");
    if (playerIdx === 0) {
      li.innerHTML = `<span class="who-red">●</span> ${msg}`;
    } else if (playerIdx === 1) {
      li.innerHTML = `<span class="who-blue">●</span> ${msg}`;
    } else {
      li.textContent = msg;
    }
    el.logList.prepend(li);
    while (el.logList.children.length > 40) {
      el.logList.removeChild(el.logList.lastChild);
    }
  }

  function restart() {
    if (padAbort) padAbort();
    state.current = 0;
    state.member = [0, 0];
    state.players = [newPlayer(), newPlayer()];
    state.pendingMoves = [];
    state.gameOver = false;
    state.bonusThrows = 0;
    state.epoch += 1;
    state.busy = false;
    state.selected = null;
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    setGuide("");
    el.throwStage.hidden = true;
    el.throwStage.onclick = null;
    el.banner.className = "board-banner";
    el.winModal.hidden = true;
    enableThrow("윷 던지기");
    el.resultName.textContent = "윷을 던지세요";
    el.resultSteps.textContent = "";
    el.logList.innerHTML = "";
    el.sticks.querySelectorAll(".stick").forEach((s) => (s.dataset.face = "up"));
    renderBoard();
    renderMovesQueue();
    log(`새 게임을 시작합니다. ${actorFull(0)} 차례!`, 0);
  }

  /* =====================================================
   *  놀이 방법 안내 (초등 3학년용 그림 카드)
   * ===================================================== */
  function sticks(pattern) {
    // f=평평한 쪽(배), r=둥근 쪽(등), F=표시(×)가 있는 평평한 쪽
    let h = '<span class="mst">';
    pattern.split("").forEach((c) => {
      h += '<i class="ms ' + (c === "r" ? "r" : "f") + (c === "F" ? " m" : "") + '"></i>';
    });
    return h + "</span>";
  }

  function miniBoard(mode) {
    const lo = 30, hi = 170, gap = 28;
    let g = '<svg viewBox="0 0 200 200" class="hp-svg" aria-hidden="true">';
    g += '<defs><marker id="ah' + mode + '" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#c0392b"/></marker></defs>';
    g += '<rect x="30" y="30" width="140" height="140" rx="4" fill="#ecdcb8" stroke="#7a5c3a" stroke-width="3"/>';
    if (mode === "short") {
      g += '<line x1="170" y1="30" x2="30" y2="170" stroke="#2e9e57" stroke-width="4" stroke-linecap="round"/>';
      g += '<line x1="30" y1="30" x2="170" y2="170" stroke="#2e9e57" stroke-width="4" stroke-linecap="round"/>';
    }
    const pts = [];
    for (let k = 1; k <= 4; k++) {
      pts.push([hi, hi - gap * k], [hi - gap * k, lo], [lo, lo + gap * k], [lo + gap * k, hi]);
    }
    pts.forEach((q) => { g += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="6" fill="#f3e7cd" stroke="#7a5c3a" stroke-width="2"/>'; });
    if (mode === "short") {
      for (let k = 1; k <= 2; k++) {
        const d = (70 / 3) * k;
        [[hi - d, lo + d], [lo + d, hi - d], [lo + d, lo + d], [hi - d, hi - d]].forEach((q) => {
          g += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="6" fill="#f3e7cd" stroke="#7a5c3a" stroke-width="2"/>';
        });
      }
    }
    [[lo, lo], [hi, lo], [lo, hi]].forEach((q) => {
      g += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="11" fill="#f7eccf" stroke="' + (mode === "short" ? "#2e9e57" : "#7a5c3a") + '" stroke-width="3"/>';
    });
    if (mode === "short") g += '<circle cx="100" cy="100" r="11" fill="#f7eccf" stroke="#2e9e57" stroke-width="3"/>';
    g += '<circle cx="' + hi + '" cy="' + hi + '" r="11" fill="#fff3c9" stroke="#c99b3f" stroke-width="4"/>';
    g += '<text x="' + hi + '" y="' + (hi + 28) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#7a5a1e">출발</text>';
    if (mode === "path") {
      const ar = (x1, y1, x2, y2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#c0392b" stroke-width="4" stroke-linecap="round" marker-end="url(#ah' + mode + ')"/>';
      g += ar(186, 150, 186, 56) + ar(150, 14, 56, 14) + ar(14, 50, 14, 144) + ar(50, 186, 144, 186);
    }
    return g + "</svg>";
  }

  const HELP = [
    {
      title: "윷놀이, 이렇게 해요!",
      body:
        '<div class="hp-art">' + sticks("frfr") + "</div>" +
        '<p class="hp-big">옛날에는 <b>설날</b>이나 <b>정월 대보름</b> 같은 명절에<br>가족과 이웃이 모여 윷놀이를 했어요.</p>' +
        '<p>홍팀과 청팀이 말을 <b>4개</b>씩 가지고,<br>먼저 <b>한 바퀴</b> 돌려 보내는 팀이 이겨요.</p>' +
        '<p class="hp-tip">1:1부터 4:4까지 할 수 있어요.<br>팀 친구들이 <b>자기 차례에</b> 윷을 던지고 말을 옮겨요.</p>',
    },
    {
      title: "① 윷을 던져요",
      body:
        '<p class="hp-sm">윷 4개를 던져 <b>평평한 쪽(밝은 색)</b>이 몇 개 나왔는지 봐요.</p>' +
        '<ul class="hp-rt">' +
        "<li>" + sticks("rfrr") + "<b>도</b><span>1칸 · 돼지</span></li>" +
        "<li>" + sticks("ffrr") + "<b>개</b><span>2칸 · 개</span></li>" +
        "<li>" + sticks("fffr") + "<b>걸</b><span>3칸 · 양</span></li>" +
        "<li>" + sticks("ffff") + "<b>윷</b><span>4칸 · 소 · <em>한 번 더!</em></span></li>" +
        "<li>" + sticks("rrrr") + "<b>모</b><span>5칸 · 말 · <em>한 번 더!</em></span></li>" +
        "<li>" + sticks("Frrr") + "<b>백도</b><span>×표 윷만 평평하면 1칸 뒤로</span></li>" +
        "</ul>" +
        '<p class="hp-tip">던질 때는 화면을 <b>꾹 누르고</b> 있다가 게이지가 <b>초록색</b>일 때 손을 놓아요.<br>너무 세게 던지면 윷이 판 밖으로 나가 <b>낙</b>! (그 던지기는 없던 일이 돼요)</p>',
    },
    {
      title: "② 말을 움직여요",
      body:
        '<div class="hp-art">' + miniBoard("path") + "</div>" +
        '<p>말은 처음에 옆의 <b>남은 말</b>에 있어요.<br>던진 칸 수만큼 <b>출발</b>에서 <b>화살표 방향</b>으로 한 칸씩 가요.</p>' +
        '<p class="hp-tip">고를 수 있는 게 하나뿐이면 <b>저절로 움직여요!</b><br>말이 여러 개면 <b>통통 뛰는 말</b>을 누르고,<br><b>초록색으로 반짝이는 칸</b>을 눌러요.</p>',
    },
    {
      title: "③ 잡기와 업기",
      body:
        '<div class="hp-two">' +
        '<div><div class="hp-art"><span class="hp-tk p0">홍</span><span class="hp-arrow">→</span><span class="hp-tk p1">청</span></div><b>잡기</b><p>상대 말이 있는 칸에 멈추면 잡아요.<br>잡힌 말은 <b>남은 말</b>로 돌아가고,<br>나는 <b>한 번 더</b> 던져요!<br><span class="hp-sm">(윷·모로 잡으면 이미 받은 “한 번 더”와 합쳐서 한 번만이에요.)</span></p></div>' +
        '<div><div class="hp-art"><span class="hp-tk p0">홍</span><span class="hp-plus">+</span><span class="hp-tk p0">홍</span><span class="hp-arrow">=</span><span class="hp-tk p0 big2">2</span></div><b>업기</b><p>내 말끼리 한 칸에 만나면<br>함께 업고 가요. 숫자가 말의 개수예요.</p></div>' +
        "</div>",
    },
    {
      title: "④ 지름길",
      body:
        '<div class="hp-art">' + miniBoard("short") + "</div>" +
        '<p><b>큰 동그라미(모서리·가운데)</b>에 멈추면<br>다음 차례에 <b>초록색 지름길</b>로 갈 수 있어요.</p>' +
        '<p class="hp-tip">지름길로 가면 더 빨리 돌아올 수 있어요!</p>',
    },
    {
      title: "⑤ 이기는 방법",
      body:
        '<div class="hp-art"><span class="hp-tk p0">홍</span><span class="hp-tk p0">홍</span><span class="hp-tk p0">홍</span><span class="hp-tk p0">홍</span></div>' +
        '<p class="hp-big">말 <b>4개</b>를 모두 한 바퀴 돌려<br><b>출발점을 지나가면</b> 승리!</p>' +
        '<p class="hp-tip">출발점에 딱 맞게 서면 아직 안 난 거예요.<br>한 칸 더 가야 나요! (가운데 점에 서면 결승으로 가는 지름길로 가요)</p>',
    },
  ];

  const helpState = { i: 0 };

  function renderHelp() {
    const slide = HELP[helpState.i];
    document.getElementById("help-body").innerHTML = '<h2 class="hp-title">' + slide.title + "</h2>" + slide.body;
    const dots = document.getElementById("help-dots");
    dots.innerHTML = "";
    HELP.forEach((_, k) => {
      const d = document.createElement("i");
      if (k === helpState.i) d.className = "on";
      dots.appendChild(d);
    });
    document.getElementById("help-prev").disabled = helpState.i === 0;
    document.getElementById("help-next").textContent = helpState.i === HELP.length - 1 ? "놀이 시작!" : "다음 ▶";
  }

  function openHelp() {
    helpState.i = 0;
    renderHelp();
    document.getElementById("help-modal").hidden = false;
  }

  let helpAutoSetup = true;

  function closeHelp() {
    const m = document.getElementById("help-modal");
    if (m.hidden) return;
    m.hidden = true;
    if (helpAutoSetup) {
      helpAutoSetup = false;
      openSetup(true);
    }
  }

  /* ---------- 게임 설정 (1:1 ~ 4:4) ---------- */
  const setupUI = { n: 1, fromStart: true };

  function cleanName(v) {
    return String(v || "").replace(/[<>&"'`]/g, "").trim().slice(0, 6);
  }

  function buildNames() {
    const box = document.getElementById("names");
    box.innerHTML = "";
    [0, 1].forEach((t) => {
      const col = document.createElement("div");
      col.className = "names-col p" + t;
      const h = document.createElement("b");
      h.textContent = t === 0 ? "홍팀" : "청팀";
      col.appendChild(h);
      for (let i = 0; i < setupUI.n; i++) {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.maxLength = 6;
        inp.placeholder = i + 1 + "번 이름 (안 써도 돼요)";
        inp.dataset.team = t;
        inp.dataset.idx = i;
        inp.value = state.names[t][i] || "";
        col.appendChild(inp);
      }
      box.appendChild(col);
    });
  }

  function syncSizeButtons() {
    document.querySelectorAll(".size-btn").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.n) === setupUI.n);
    });
  }

  function openSetup(fromStart) {
    setupUI.fromStart = fromStart;
    setupUI.n = state.teamSize;
    document.getElementById("opt-border-back").checked = state.borderBack;
    document.getElementById("setup-cancel").hidden = fromStart;
    syncSizeButtons();
    buildNames();
    document.getElementById("setup-modal").hidden = false;
  }

  document.querySelectorAll(".size-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#names input").forEach((inp) => {
        state.names[Number(inp.dataset.team)][Number(inp.dataset.idx)] = cleanName(inp.value);
      });
      setupUI.n = Number(b.dataset.n);
      syncSizeButtons();
      buildNames();
    });
  });
  document.getElementById("setup-cancel").addEventListener("click", () => {
    document.getElementById("setup-modal").hidden = true;
  });
  document.getElementById("setup-start").addEventListener("click", () => {
    const names = [[], []];
    document.querySelectorAll("#names input").forEach((inp) => {
      names[Number(inp.dataset.team)][Number(inp.dataset.idx)] = cleanName(inp.value);
    });
    state.names = names;
    state.teamSize = setupUI.n;
    state.borderBack = document.getElementById("opt-border-back").checked;
    document.getElementById("setup-modal").hidden = true;
    restart();
  });

  document.getElementById("help-btn").addEventListener("click", openHelp);
  document.getElementById("help-skip").addEventListener("click", closeHelp);
  document.getElementById("help-prev").addEventListener("click", () => {
    if (helpState.i > 0) { helpState.i -= 1; renderHelp(); }
  });
  document.getElementById("help-next").addEventListener("click", () => {
    if (helpState.i >= HELP.length - 1) closeHelp();
    else { helpState.i += 1; renderHelp(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("help-modal").hidden) closeHelp();
  });

  el.soundBtn.addEventListener("click", () => {
    snd.on = !snd.on;
    try { localStorage.setItem("yut-sound", snd.on ? "on" : "off"); } catch (e) {}
    syncSoundBtn();
    if (snd.on) { audio(); sfx("ding"); }
  });

  buildThrowSticks();
  syncSoundBtn();
  el.throwBtn.addEventListener("click", throwYut);
  el.restartBtn.addEventListener("click", () => { if (!onlineRestart()) openSetup(false); });
  el.winRestart.addEventListener("click", () => { if (!onlineRestart()) restart(); });

  /* =====================================================
   *  온라인 방 (방번호로 만나서 함께 하기)
   *  - 같은 서버(분수 대결과 같은 방식)를 쓰고, 던진 결과와 말 고르기만 주고받아요.
   * ===================================================== */
  const SUPA_URL = "https://erzdvlcbjneabxqwnwfy.supabase.co";
  const SUPA_KEY = "sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz";
  const MOCK = new URLSearchParams(location.search).get("mock") === "1";
  const $ = (id) => document.getElementById(id);

  function isMyTurn() {
    if (!NET.on || !NET.me) return true;
    if (state.current !== NET.me.team) return false;
    return state.teamSize <= 1 ? true : state.member[NET.me.team] === NET.me.idx;
  }

  function Transport(code, onMsg, onStatus) {
    const room = "yut" + code;
    const H = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY };
    const base = SUPA_URL + "/rest/v1/battle_msgs";
    let last = 0, alive = false, fails = 0, bc = null, timer = null;
    async function poll() {
      if (!alive) return;
      try {
        const r = await fetch(base + "?room=eq." + room + "&id=gt." + last + "&order=id.asc&limit=80&select=id,body", { headers: H, cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const rows = await r.json();
        fails = 0;
        for (const x of rows) {
          last = Math.max(last, x.id);
          if (x.body && x.body._s !== NET.pid) onMsg(x.body);
        }
      } catch (e) {
        fails++;
        if (fails >= 15) { alive = false; onStatus("closed"); return; }
      }
      if (alive) timer = setTimeout(poll, 450);
    }
    this.open = async function () {
      if (MOCK) {
        bc = new BroadcastChannel("yut-" + code);
        bc.onmessage = (e) => { if (e.data && e.data._s !== NET.pid) onMsg(e.data); };
        alive = true;
        setTimeout(() => onStatus("ok"), 30);
        return;
      }
      try {
        const r = await fetch(base + "?room=eq." + room + "&order=id.desc&limit=1&select=id,created_at", { headers: H, cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const rows = await r.json();
        last = rows.length ? rows[0].id : 0;
        this.lastAge = rows.length ? Date.now() - new Date(rows[0].created_at).getTime() : Infinity;
        alive = true;
        onStatus("ok");
        poll();
      } catch (e) {
        onStatus("error");
      }
    };
    let q = Promise.resolve();
    this.send = function (o) {
      const body = Object.assign({ _s: NET.pid }, o);
      if (bc) { bc.postMessage(body); return; }
      q = q.then(async () => {
        for (let k = 0; k < 3; k++) {
          try {
            const r = await fetch(base, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, H), body: JSON.stringify({ room: room, body: body }), keepalive: true });
            if (r.ok) return;
          } catch (e) {}
          await sleep(400);
        }
      });
    };
    this.close = () => { alive = false; clearTimeout(timer); try { if (bc) bc.close(); } catch (e) {} };
  }

  function netSend(o) {
    if (!NET.net) return;
    o.q = NET.q;
    NET.q += 1;
    NET.net.send(o);
  }

  /* ---------- 게임 중 주고받기 ---------- */
  function onGameMsg(m) {
    if (m.t === "throw" || m.t === "move") {
      if (m.q >= NET.q) NET.queue[m.q] = m;
    } else if (m.t === "again" && !NET.host) {
      beginGame(NET.cfg);
    } else if (m.t === "bye") {
      banner((m.name || "친구") + " 친구가 나갔어요", "bad");
    }
  }

  setInterval(() => {
    if (!NET.on || state.gameOver) return;
    const m = NET.queue[NET.q];
    if (!m || state.busy) return;
    if (m.t === "throw" && !el.throwBtn.disabled) {
      delete NET.queue[NET.q];
      NET.q += 1;
      remoteThrow(m);
    } else if (m.t === "move" && el.throwBtn.disabled && state.pendingMoves.length > 0) {
      delete NET.queue[NET.q];
      NET.q += 1;
      doMove(m.src, m.steps);
    }
  }, 90);

  function beginGame(cfg) {
    NET.cfg = cfg;
    NET.on = true;
    NET.q = 0;
    NET.queue = {};
    clearInterval(NET.hb);
    NET.me = null;
    cfg.slots.forEach((col, t) => col.forEach((sl, i) => { if (sl && sl.id === NET.pid) NET.me = { team: t, idx: i }; }));
    state.teamSize = cfg.size;
    state.names = cfg.slots.map((col) => col.map((sl) => (sl && sl.name) || ""));
    state.borderBack = !!cfg.bb;
    $("room-modal").hidden = true;
    restart();
    updateStats();
    const chip = $("net-chip");
    chip.hidden = false;
    chip.textContent = "🌐 방번호 " + NET.code + " · 나는 " + (NET.me.team === 0 ? "홍팀" : "청팀") + (cfg.size > 1 ? " " + (NET.me.idx + 1) + "번" : "");
    chip.className = "net-chip p" + NET.me.team;
  }

  function leaveRoom(silent) {
    if (NET.net && NET.on && !silent) netSend({ t: "bye", name: NET.me ? state.names[NET.me.team][NET.me.idx] : "" });
    else if (NET.net && !silent) NET.net.send({ t: "bye", id: NET.pid });
    clearInterval(NET.hb);
    clearInterval(NET.wantTimer);
    if (NET.net) setTimeout(((n) => () => n.close())(NET.net), 600);
    NET.net = null;
    NET.on = false;
    NET.host = false;
    NET.me = null;
    NET.queue = {};
    $("net-chip").hidden = true;
    $("room-modal").hidden = true;
    restart();
    updateStats();
  }

  /* ---------- 방 만들기 · 들어가기 (대기실) ---------- */
  let roomSize = 1;
  const lobby = { slots: null, status: "" };

  function showRoomHome() {
    $("room-home").hidden = false;
    $("room-lobby").hidden = true;
    $("room-modal").hidden = false;
    $("room-err").textContent = "";
    try { $("room-name").value = localStorage.getItem("yut-name") || ""; } catch (e) {}
    document.querySelectorAll("#room-size .size-btn").forEach((b) => b.classList.toggle("on", Number(b.dataset.n) === roomSize));
  }

  function myName() {
    const v = ($("room-name").value || "").trim().slice(0, 8) || "친구";
    try { localStorage.setItem("yut-name", v); } catch (e) {}
    return v;
  }

  function emptySlots(n) {
    return [Array(n).fill(null), Array(n).fill(null)];
  }

  function renderLobby() {
    const sl = lobby.slots;
    $("room-code").textContent = NET.code;
    let filled = 0;
    [0, 1].forEach((t) => {
      const col = $("slots-" + t);
      col.innerHTML = "";
      sl[t].forEach((x, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "slot-btn" + (x ? " full" : "");
        if (x) {
          filled++;
          b.textContent = (x.id === NET.pid ? "⭐ " : "🙂 ") + x.name + (x.id === NET.pid ? " (나)" : "");
          if (x.id === NET.pid) b.classList.add("me");
        } else {
          b.textContent = "＋ 여기 앉기";
          b.onclick = () => wantSeat(t, i);
        }
        col.appendChild(b);
      });
    });
    const total = lobby.size * 2;
    $("room-status").textContent = filled + " / " + total + "명 모였어요";
    const st = $("room-start");
    st.hidden = !NET.host;
    st.disabled = filled < total;
    $("room-wait").hidden = NET.host;
    $("room-wait").textContent = filled < total ? "친구들을 기다려요…" : "방장이 시작하면 게임이 열려요!";
    st.textContent = filled < total ? "모두 모이면 시작할 수 있어요" : "🎲 게임 시작!";
  }

  function hostBroadcast() {
    NET.net.send({ t: "lobby", size: lobby.size, slots: lobby.slots });
  }

  function hostPlace(id, name, team, idx) {
    const sl = lobby.slots;
    // 이미 앉아 있으면 이름만 갱신 (자리를 옮기려는 게 아니면)
    let cur = null;
    sl.forEach((col, t) => col.forEach((x, i) => { if (x && x.id === id) cur = { t, i }; }));
    if (team == null) {
      if (cur) { sl[cur.t][cur.i].name = name; return; }
      const order = [0, 1].sort((a, b) => sl[a].filter(Boolean).length - sl[b].filter(Boolean).length);
      for (const t of order) { const i = sl[t].findIndex((x) => !x); if (i >= 0) { sl[t][i] = { id, name }; return; } }
      return;
    }
    if (sl[team][idx]) return;
    if (cur) sl[cur.t][cur.i] = null;
    sl[team][idx] = { id, name };
  }

  function onLobbyMsg(m) {
    if (NET.host) {
      if (m.t === "want") {
        hostPlace(m.id, m.name, m.team, m.idx);
        renderLobby();
        hostBroadcast();
      } else if (m.t === "bye" && m.id) {
        lobby.slots.forEach((col, t) => col.forEach((x, i) => { if (x && x.id === m.id) col[i] = null; }));
        renderLobby();
        hostBroadcast();
      }
      return;
    }
    if (m.t === "lobby") {
      lobby.size = m.size;
      lobby.slots = m.slots;
      NET.gotLobby = true;
      const inIt = m.slots.some((col) => col.some((x) => x && x.id === NET.pid));
      if (!inIt && NET.wantSent > 3 && m.slots.every((col) => col.every(Boolean))) {
        $("room-err").textContent = "자리가 모두 찼어요.";
      }
      $("room-home").hidden = true;
      $("room-lobby").hidden = false;
      renderLobby();
    } else if (m.t === "start") {
      NET.cfg = { size: m.size, slots: m.slots, bb: m.bb };
      if (m.slots.some((col) => col.some((x) => x && x.id === NET.pid))) beginGame(NET.cfg);
      else { $("room-err").textContent = "이미 시작된 방이에요."; leaveRoom(true); showRoomHome(); }
    }
  }

  function wantSeat(team, idx) {
    if (NET.host) {
      hostPlace(NET.pid, myName(), team, idx);
      renderLobby();
      hostBroadcast();
    } else {
      NET.net.send({ t: "want", id: NET.pid, name: myName(), team: team, idx: idx });
    }
  }

  function onNetMsg(m) {
    if (NET.on) onGameMsg(m);
    else onLobbyMsg(m);
  }

  async function createRoom() {
    const name = myName();
    $("room-err").textContent = "";
    let code = "", tries = 0, tp = null;
    while (tries++ < 6) {
      code = String(Math.floor(1000 + Math.random() * 9000));
      tp = new Transport(code, onNetMsg, () => {});
      await tp.open();
      if (MOCK || tp.lastAge === undefined || tp.lastAge > 20 * 60 * 1000) break;
      tp.close();
      tp = null;
    }
    if (!tp) { $("room-err").textContent = "방을 만들지 못했어요. 다시 눌러 주세요."; return; }
    NET.net = tp;
    NET.code = code;
    NET.host = true;
    NET.on = false;
    lobby.size = roomSize;
    lobby.slots = emptySlots(roomSize);
    lobby.slots[0][0] = { id: NET.pid, name: name };
    $("room-home").hidden = true;
    $("room-lobby").hidden = false;
    renderLobby();
    hostBroadcast();
    NET.hb = setInterval(hostBroadcast, 2000);
  }

  async function joinRoom() {
    const code = ($("room-code-in").value || "").replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) { $("room-err").textContent = "방번호 4자리를 써 주세요."; return; }
    const name = myName();
    $("room-err").textContent = "방을 찾는 중…";
    const tp = new Transport(code, onNetMsg, (st) => {
      if (st === "error") $("room-err").textContent = "서버에 연결하지 못했어요. 인터넷을 확인해 주세요.";
      if (st === "closed" && NET.net === tp) $("room-err").textContent = "연결이 끊겼어요.";
    });
    NET.net = tp;
    NET.code = code;
    NET.host = false;
    NET.on = false;
    NET.gotLobby = false;
    NET.wantSent = 0;
    await tp.open();
    const ask = () => {
      NET.net.send({ t: "want", id: NET.pid, name: name });
      NET.wantSent += 1;
      if (NET.wantSent >= 5 && !NET.gotLobby) $("room-err").textContent = "그 방번호의 방을 찾지 못했어요. 번호를 다시 확인해 주세요.";
    };
    ask();
    NET.wantTimer = setInterval(() => {
      const inIt = lobby.slots && lobby.slots.some((col) => col.some((x) => x && x.id === NET.pid));
      if (NET.on || inIt) { clearInterval(NET.wantTimer); return; }
      if (NET.wantSent < 40) ask();
    }, 1500);
  }

  function hostStart() {
    const total = lobby.size * 2;
    const filled = lobby.slots.reduce((a, c) => a + c.filter(Boolean).length, 0);
    if (filled < total) return;
    clearInterval(NET.hb);
    const cfg = { size: lobby.size, slots: lobby.slots, bb: $("room-border").checked };
    NET.net.send({ t: "start", size: cfg.size, slots: cfg.slots, bb: cfg.bb });
    beginGame(cfg);
  }

  $("online-btn").addEventListener("click", () => {
    if (NET.on) { if (confirm("온라인 방에서 나갈까요?")) leaveRoom(); return; }
    showRoomHome();
  });
  document.querySelectorAll("#room-size .size-btn").forEach((b) => {
    b.addEventListener("click", () => {
      roomSize = Number(b.dataset.n);
      document.querySelectorAll("#room-size .size-btn").forEach((x) => x.classList.toggle("on", x === b));
    });
  });
  $("room-create").addEventListener("click", createRoom);
  $("room-join").addEventListener("click", joinRoom);
  $("room-start").addEventListener("click", hostStart);
  $("room-leave").addEventListener("click", () => leaveRoom());
  $("room-close").addEventListener("click", () => { if (!NET.on && NET.net) leaveRoom(true); $("room-modal").hidden = true; });

  // 온라인 중 '새 게임': 방장만 같은 사람들로 다시 시작
  function onlineRestart() {
    if (!NET.on) return false;
    if (!NET.host) { banner("방장만 다시 시작할 수 있어요", "bad"); return true; }
    NET.net.send({ t: "again" });
    beginGame(NET.cfg);
    return true;
  }

  restart();
  openHelp();
})();
