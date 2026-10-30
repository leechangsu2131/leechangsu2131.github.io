(function () {
  "use strict";

  const BOARD = buildBoard();
  const ROUTES = buildRoutes();
  const YUT_FACES = {
    backdo: { name: "백도", steps: -1, animal: "뒷도", label: "한 칸 뒤로" },
    do: { name: "도", steps: 1, animal: "돼지", label: "한 칸" },
    gae: { name: "개", steps: 2, animal: "개", label: "두 칸" },
    geol: { name: "걸", steps: 3, animal: "양", label: "세 칸" },
    yut: { name: "윷", steps: 4, again: true, animal: "소", label: "네 칸" },
    mo: { name: "모", steps: 5, again: true, animal: "말", label: "다섯 칸" },
  };

  const state = {
    current: 0,
    players: [newPlayer(), newPlayer()],
    pendingMoves: [],
    captureBonus: false,
    gameOver: false,
    busy: false,
    epoch: 0,
  };

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
    add("o1", 92, 73.6); add("o2", 92, 55.2); add("o3", 92, 36.8); add("o4", 92, 18.4);
    add("c_tr", 92, 8, "corner");
    add("t1", 73.6, 8); add("t2", 55.2, 8); add("t3", 36.8, 8); add("t4", 18.4, 8);
    add("c_tl", 8, 8, "corner");
    add("l1", 8, 18.4); add("l2", 8, 36.8); add("l3", 8, 55.2); add("l4", 8, 73.6);
    add("c_bl", 8, 92, "corner");
    add("b1", 26.8, 92); add("b2", 45.6, 92); add("b3", 64.4, 92); add("b4", 83.2, 92);

    add("d1", 73.2, 26.8); add("d2", 57.6, 42.4);
    add("center", 50, 50, "center");
    add("d3", 42.4, 57.6); add("d4", 26.8, 73.2);
    add("e1", 26.8, 26.8); add("e2", 42.4, 42.4);
    add("e3", 57.6, 57.6); add("e4", 73.2, 73.2);

    return nodes;
  }

  function buildRoutes() {
    const outerLoop = [
      "o0", "o1", "o2", "o3", "o4",
      "c_tr", "t1", "t2", "t3", "t4",
      "c_tl", "l1", "l2", "l3", "l4",
      "c_bl", "b1", "b2", "b3", "b4",
    ];
    const OUTER = outerLoop.concat(["FIN"]);

    const tr = outerLoop.indexOf("c_tr");
    const tl = outerLoop.indexOf("c_tl");
    const bl = outerLoop.indexOf("c_bl");

    const SC_TR = outerLoop.slice(0, tr + 1)
      .concat(["d1", "d2", "center", "d3", "d4"])
      .concat(outerLoop.slice(bl))
      .concat(["FIN"]);

    const SC_TL = outerLoop.slice(0, tl + 1)
      .concat(["e1", "e2", "center", "e3", "e4", "FIN"]);

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

  function advance(fromId, fromRoute, steps) {
    let route = fromRoute;
    let idx;
    if (route) {
      idx = route.indexOf(fromId);
      if (idx === -1) {
        route = null;
      }
    }
    // 모서리 칸에 멈춰 있던 말은 앞으로 갈 때 지름길(대각선)로 들어간다.
    if (steps > 0 && (fromId === "c_tr" || fromId === "c_tl")) {
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

    const target = idx + steps;
    if (target >= route.length - 1) {
      return { finished: true, nodes: route.slice(idx + 1, route.length - 1) };
    }
    if (target < 0) {
      return { finished: false, dest: "o0", route: ROUTES[0], nodes: ["o0"] };
    }
    const nodes = steps > 0 ? route.slice(idx + 1, target + 1) : [route[target]];
    return { finished: false, dest: route[target], route, nodes };
  }

  function isShortcutJunction(nodeId) {
    return nodeId === "c_tr" || nodeId === "c_tl" || nodeId === "center";
  }

  function preferShortcut(nodeId) {
    if (nodeId === "c_tr") return ROUTES[1];
    if (nodeId === "c_tl") return ROUTES[2];
    if (nodeId === "center") return ROUTES[1];
    return ROUTES[0];
  }

  function computePath(token, steps) {
    const fromId = token.at;
    const fromRoute = token.route || null;
    return advance(fromId, fromRoute, steps);
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
  }

  function tf(x, y, z, rx, ry, rz, sc) {
    return (
      "translate3d(" + x + "px," + y + "px," + z + "px) rotateX(" + rx + "deg) rotateY(" + ry +
      "deg) rotateZ(" + rz + "deg) scale(" + sc + ")"
    );
  }

  async function playThrow(flats, face, epoch) {
    const st = el.throwStage;
    el.throwTitle.textContent = (state.current === 0 ? "홍(紅)" : "청(靑)") + "팀이 윷을 던집니다!";
    el.bigResult.innerHTML = "";
    el.bigResult.className = "big-result";
    el.throwHint.classList.remove("show");
    stickEls.forEach((s) => {
      s.getAnimations().forEach((a) => a.cancel());
      s.style.transform = tf(0, 400, 0, 0, 0, 0, 0.7);
    });
    st.classList.remove("out");
    st.hidden = false;

    const H = el.throwSticks.clientHeight || 220;
    const dur = REDUCED ? 350 : 1500;
    const gap = REDUCED ? 0 : 85;
    const finals = [];

    stickEls.forEach((s, i) => {
      const flat = flats[i];
      const jx = Math.random() * 14 - 7;
      const jz = Math.random() * 10 - 5;
      const spinX = (2 + Math.floor(Math.random() * 2)) * 360;
      const spinY = (flat ? 0 : 180) + (3 + Math.floor(Math.random() * 2)) * 360;
      const apex = -(H * 1.5 + Math.random() * H * 0.35);
      const dx = Math.random() * 40 - 20;
      const fin = tf(jx, 0, 0, spinX, spinY, jz, 1);
      finals[i] = tf(jx, 0, 0, 0, flat ? 0 : 180, jz, 1);
      const frames = [
        { offset: 0, transform: tf(dx * 2, H * 0.9, 0, 0, 0, -25, 0.7), easing: "cubic-bezier(.15,.7,.35,1)" },
        { offset: 0.42, transform: tf(dx, apex, 140, spinX * 0.62, spinY * 0.62, jz * 3, 1.25), easing: "cubic-bezier(.55,0,.85,.45)" },
        { offset: 0.72, transform: fin, easing: "cubic-bezier(.2,.6,.4,1)" },
        { offset: 0.84, transform: tf(jx, -H * 0.14, 0, spinX, spinY, jz, 1), easing: "cubic-bezier(.5,0,.8,.5)" },
        { offset: 0.92, transform: fin, easing: "cubic-bezier(.2,.6,.4,1)" },
        { offset: 0.96, transform: tf(jx, -H * 0.04, 0, spinX, spinY, jz, 1), easing: "cubic-bezier(.5,0,.8,.5)" },
        { offset: 1, transform: fin },
      ];
      s.animate(frames, { duration: dur, delay: i * gap, fill: "both", easing: "linear" });
      setTimeout(() => { if (epoch === state.epoch) sfx("clack"); }, i * gap + dur * 0.72);
      setTimeout(() => { if (epoch === state.epoch) sfx("soft"); }, i * gap + dur * 0.92);
    });

    await sleep(dur + 3 * gap + 80);
    if (epoch !== state.epoch) return;

    stickEls.forEach((s, i) => {
      s.style.transform = finals[i];
      s.getAnimations().forEach((a) => a.cancel());
    });

    el.bigResult.innerHTML =
      '<b class="br-name">' + face.name + "</b>" +
      '<span class="br-sub">' + face.animal + " · " + face.label + "</span>" +
      (face.again ? '<em class="br-again">한 번 더!</em>' : "");
    el.bigResult.className = "big-result show" + (face.again ? " big" : "");
    el.throwHint.classList.add("show");
    sfx(face.again ? "fanfare" : "ding");

    const hold = REDUCED ? 500 : face.again ? 1800 : 1250;
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
    audio();
    el.throwBtn.disabled = true;
    state.busy = true;
    const epoch = state.epoch;

    const flats = [0, 0, 0, 0].map(() => Math.random() < 0.5);
    const face = resolveFace(flats.filter(Boolean).length, flats);

    await playThrow(flats, face, epoch);
    if (epoch !== state.epoch) return;

    state.busy = false;
    el.sticks.querySelectorAll(".stick").forEach((s, i) => {
      s.dataset.face = flats[i] ? "up" : "down";
    });
    applyFace(face);
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

  async function runMove(startId, result, stackCount, fromHome) {
    const epoch = state.epoch;
    const pIdx = state.current;
    state.busy = true;
    const w = makeWalker(pIdx, stackCount, startId);
    const body = w.querySelector(".walker-body");

    if (fromHome) {
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
      await hop(w, prev, "o0");
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
    finalizeMove(result, stackCount);
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
    el.resultName.textContent = face.name;
    el.resultSteps.textContent = face.steps > 0 ? `+${face.steps}칸` : `${face.steps}칸`;
    log(`${who(state.current)} ${face.name}${face.again ? " (한 번 더!)" : ""}`, state.current);

    state.pendingMoves.push(face.steps);
    renderMovesQueue();

    if (face.again) {
      el.throwBtn.disabled = false;
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
      endTurn();
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
      chip.textContent = s > 0 ? "+" + s : s;
      el.movesQueue.appendChild(chip);
    });
  }

  function highlightMovable() {
    clearHighlights();
    const steps = state.pendingMoves;
    const player = state.players[state.current];
    const reachableNodes = new Set();
    const canHome = steps.some((s) => s > 0) && player.home > 0;

    steps.forEach((s) => {
      listMovableTokens(s).forEach((m) => {
        if (m.kind === "board") reachableNodes.add(m.at);
      });
    });

    reachableNodes.forEach((at) => {
      const nodeEl = el.board.querySelector(`.node[data-node="${at}"]`);
      if (nodeEl) {
        nodeEl.classList.add("movable");
        nodeEl.onclick = () => chooseToken(at);
      }
    });

    if (canHome) {
      const tray = document.getElementById("tray-" + state.current);
      tray.classList.add("home-ready");
      tray.onclick = () => chooseHomeEntry();
    }
  }

  function chooseHomeEntry() {
    if (state.busy) return;
    const usable = state.pendingMoves.filter((s) => s > 0);
    if (usable.length === 0) return;
    if (usable.length === 1 || new Set(usable).size === 1) {
      enterFromHome(usable[0]);
    } else {
      pickMove(usable, (s) => enterFromHome(s));
    }
  }

  function chooseToken(at) {
    if (state.busy) return;
    const usable = state.pendingMoves.slice();
    if (usable.length === 0) return;
    if (new Set(usable).size === 1) {
      moveToken(at, usable[0]);
    } else {
      pickMove(usable, (s) => moveToken(at, s));
    }
  }

  function pickMove(options, cb) {
    const unique = [...new Set(options)];
    highlightChips(unique, cb);
    log("사용할 윷 결과를 선택하세요.", null);
  }

  function highlightChips(options, cb) {
    const chips = el.movesQueue.querySelectorAll(".move-chip");
    chips.forEach((chip, idx) => {
      const val = state.pendingMoves[idx];
      if (options.indexOf(val) !== -1 && !chip.classList.contains("used")) {
        chip.style.cursor = "pointer";
        chip.style.outlineColor = "var(--gold)";
        chip.onclick = () => {
          clearChipHandlers();
          cb(val);
        };
      }
    });
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
    player.home -= 1;
    consumeMove(steps);
    clearChipHandlers();
    clearHighlights();
    renderTokens();
    // 출발점(o0)에서 윷 결과만큼 앞으로: 도=첫째 칸, 모=모서리
    const result = advance("o0", ROUTES[0], steps);
    runMove("o0", result, 1, true);
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
    runMove(at, result, stackCount, false);
  }

  function clearHighlights() {
    document.querySelectorAll(".node.movable").forEach((n) => {
      n.classList.remove("movable");
      n.onclick = null;
    });
    state.players.forEach((_, i) => {
      const tray = document.getElementById("tray-" + i);
      tray.classList.remove("home-ready");
      tray.onclick = null;
    });
  }

  function finalizeMove(result, stackCount) {
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
    captured(dest);

    const existing = player.tokens.filter((t) => t.at === dest);
    if (existing.length > 0) {
      existing[0].stack += stackCount;
      existing[0].route = result.route;
      log(`${who(state.current)} 말을 업었습니다.`, state.current);
    } else {
      player.tokens.push({ at: dest, stack: stackCount, route: result.route });
    }

    renderTokens();
    afterMove();
  }

  function captured(dest) {
    const opp = state.players[1 - state.current];
    const victims = opp.tokens.filter((t) => t.at === dest);
    if (victims.length > 0) {
      let count = 0;
      victims.forEach((v) => (count += v.stack));
      opp.tokens = opp.tokens.filter((t) => t.at !== dest);
      opp.home += count;
      log(`${who(state.current)} 상대 말 ${count}개를 잡았습니다! (한 번 더)`, state.current);
      state.captureBonus = true;
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

    if (state.captureBonus) {
      state.captureBonus = false;
      el.throwBtn.disabled = false;
      log(`${who(state.current)} 보너스! 한 번 더 던지세요.`, state.current);
      return;
    }

    if (!el.throwBtn.disabled) {
      log(`${who(state.current)} 한 번 더 던지세요.`, state.current);
      return;
    }

    endTurn();
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
    state.current = 1 - state.current;
    state.pendingMoves = [];
    renderMovesQueue();
    el.resultName.textContent = `${who(state.current)} 차례`;
    el.resultSteps.textContent = "";
    el.throwBtn.disabled = false;
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
    state.current = 0;
    state.players = [newPlayer(), newPlayer()];
    state.pendingMoves = [];
    state.gameOver = false;
    state.captureBonus = false;
    state.epoch += 1;
    state.busy = false;
    el.throwStage.hidden = true;
    el.throwStage.onclick = null;
    el.banner.className = "board-banner";
    el.winModal.hidden = true;
    el.throwBtn.disabled = false;
    el.resultName.textContent = "윷을 던지세요";
    el.resultSteps.textContent = "";
    el.logList.innerHTML = "";
    el.sticks.querySelectorAll(".stick").forEach((s) => (s.dataset.face = "up"));
    renderBoard();
    renderMovesQueue();
    log("새 게임을 시작합니다. 홍 차례!", 0);
  }

  el.soundBtn.addEventListener("click", () => {
    snd.on = !snd.on;
    try { localStorage.setItem("yut-sound", snd.on ? "on" : "off"); } catch (e) {}
    syncSoundBtn();
    if (snd.on) { audio(); sfx("ding"); }
  });

  buildThrowSticks();
  syncSoundBtn();
  el.throwBtn.addEventListener("click", throwYut);
  el.restartBtn.addEventListener("click", restart);
  el.winRestart.addEventListener("click", restart);

  restart();
})();
