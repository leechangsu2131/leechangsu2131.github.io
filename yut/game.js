(function () {
  "use strict";

  const BOARD = buildBoard();
  const ROUTES = buildRoutes();
  const YUT_FACES = {
    backdo: { name: "백도", steps: -1 },
    do: { name: "도", steps: 1 },
    gae: { name: "개", steps: 2 },
    geol: { name: "걸", steps: 3 },
    yut: { name: "윷", steps: 4, again: true },
    mo: { name: "모", steps: 5, again: true },
  };

  const state = {
    current: 0,
    players: [newPlayer(), newPlayer()],
    pendingMoves: [],
    captureBonus: false,
    gameOver: false,
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
      return { finished: true };
    }
    if (target < 0) {
      return { finished: false, dest: "o0", route: ROUTES[0] };
    }
    return { finished: false, dest: route[target], route };
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

  function throwYut() {
    if (state.gameOver) return;
    if (el.throwBtn.disabled) return;
    el.throwBtn.disabled = true;
    el.sticks.classList.add("rolling");

    const flats = [0, 0, 0, 0].map(() => Math.random() < 0.5);
    const upCount = flats.filter(Boolean).length;
    let face = resolveFace(upCount, flats);

    setTimeout(() => {
      el.sticks.classList.remove("rolling");
      el.sticks.querySelectorAll(".stick").forEach((s, i) => {
        s.dataset.face = flats[i] ? "up" : "down";
      });
      applyFace(face);
    }, 520);
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
    const usable = state.pendingMoves.filter((s) => s > 0);
    if (usable.length === 0) return;
    if (usable.length === 1 || new Set(usable).size === 1) {
      enterFromHome(usable[0]);
    } else {
      pickMove(usable, (s) => enterFromHome(s));
    }
  }

  function chooseToken(at) {
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
    const result = advance("o0", ROUTES[0], steps - 1);
    finalizeMove(result, 1);
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
    finalizeMove(result, stackCount);
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

  el.throwBtn.addEventListener("click", throwYut);
  el.restartBtn.addEventListener("click", restart);
  el.winRestart.addEventListener("click", restart);

  restart();
})();
