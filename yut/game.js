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
    bonusThrows: 0,
    gameOver: false,
    busy: false,
    epoch: 0,
    selected: null,
    autoTimer: null,
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
    el.resultName.textContent = face.name;
    el.resultSteps.textContent = face.steps > 0 ? `+${face.steps}칸` : `${face.steps}칸`;
    log(`${who(state.current)} ${face.name}${face.again ? " (한 번 더!)" : ""}`, state.current);

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
      chip.textContent = s > 0 ? "+" + s : s;
      el.movesQueue.appendChild(chip);
    });
  }

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
      r = advance("o0", ROUTES[0], steps);
    } else {
      const tok = player.tokens.find((t) => t.at === src.at);
      if (!tok) return null;
      r = computePath(tok, steps);
    }
    return { finished: !!r.finished, dest: r.finished ? "o0" : r.dest, nodes: r.nodes || [] };
  }

  // 던진 뒤 말을 고르는 단계: 말 누르기 → 갈 수 있는 칸이 미리 보임 → 칸 누르기
  function highlightMovable() {
    state.selected = null;
    refreshChoices();
  }

  function refreshChoices() {
    clearHighlights(true);
    if (state.busy) return;
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
    const opts = new Map();
    [...new Set(state.pendingMoves)].forEach((st) => {
      const pv = previewMove(sel, st);
      if (!pv) return;
      const prev = opts.get(pv.dest);
      if (!prev || (pv.finished && st < prev.steps)) opts.set(pv.dest, { steps: st, pv });
    });

    opts.forEach((o, destId) => {
      const n = nodeEl(destId);
      if (!n) return;
      o.pv.nodes.forEach((pid) => {
        if (pid === destId) return;
        const pn = nodeEl(pid);
        if (pn) pn.classList.add("on-path");
      });
      n.classList.add("dest");
      let label = STEP_NAME[o.steps] || "";
      if (o.pv.finished) label += " · 완주";
      else if (opp.tokens.some((t) => t.at === destId)) label += " · 잡기!";
      else if (player.tokens.some((t) => t.at === destId && !(sel.kind === "board" && sel.at === destId))) label += " · 업기";
      const m = document.createElement("div");
      m.className = "dest-marker p" + state.current;
      m.innerHTML = '<span class="dest-label">' + label + "</span>";
      n.appendChild(m);
      n.onclick = () => executeMove(sel, o.steps);
    });

    setGuide(
      opts.size > 1
        ? "가고 싶은 칸을 누르세요. 초록색 칸마다 쓸 윷 결과가 적혀 있어요."
        : "초록색으로 반짝이는 칸을 누르면 말이 움직여요."
    );
    const only = opts.size === 1 ? [...opts.values()][0] : null;
    return { count: opts.size, steps: only ? only.steps : 0 };
  }

  function executeMove(src, steps) {
    if (state.busy) return;
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
    const result = advance("o0", ROUTES[0], steps);
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
      log(`${who(state.current)} 말을 업었습니다.`, state.current);
    } else {
      player.tokens.push({ at: dest, stack: stackCount, route: result.route });
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
    document.getElementById("throw-label").textContent = label || "윷 던지기";
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
    state.current = 0;
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
    log("새 게임을 시작합니다. 홍 차례!", 0);
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
        '<p>홍팀과 청팀이 말을 <b>4개</b>씩 가지고,<br>먼저 <b>한 바퀴</b> 돌려 보내는 팀이 이겨요.</p>',
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
        "</ul>",
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
        '<p class="hp-tip">잡히지 않게 조심하고, 잡을 수 있으면 잡아 보세요.</p>',
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

  function closeHelp() {
    document.getElementById("help-modal").hidden = true;
  }

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
    if (e.key === "Escape") closeHelp();
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
  el.restartBtn.addEventListener("click", restart);
  el.winRestart.addEventListener("click", restart);

  restart();
  openHelp();
})();
