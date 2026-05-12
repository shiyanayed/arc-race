/* ========================================
   ARC RACE – HTML5 Canvas Game Engine
   4-lane sprint race with energy pickups
   ======================================== */

const ArcGame = (() => {
  // ─── Constants ───
  const LANE_COUNT = 4;
  const TRACK_LENGTH = 3000;        // total race distance
  const BASE_SPEED = 1.8;
  const MAX_SPEED = 5.5;
  const ENERGY_BOOST = 0.6;
  const ENERGY_DECAY = 0.004;
  const PICKUP_INTERVAL = 45;       // frames between spawns
  const FINISH_SCORE = [100, 60, 35, 15]; // score by position

  const RUNNER_COLORS = ['#00ffff', '#a855f7', '#ec4899', '#fbbf24'];
  const RUNNER_NAMES = ['YOU', 'CPU-1', 'CPU-2', 'CPU-3'];

  // ─── State ───
  let canvas, ctx, W, H;
  let gameState = 'idle'; // idle | countdown | running | finished
  let frameId = null;
  let frameCount = 0;

  // runners
  let runners = [];
  // pickups
  let pickups = [];
  // results
  let finishOrder = [];
  let raceStartTime = 0;

  // input
  let keys = {};

  // HUD callbacks
  let onHudUpdate = null;
  let onGameEnd = null;

  // ─── Runner factory ───
  function createRunner(index, isPlayer) {
    return {
      index,
      name: RUNNER_NAMES[index],
      color: RUNNER_COLORS[index],
      isPlayer,
      lane: index,
      distance: 0,
      speed: BASE_SPEED,
      energy: 50,
      maxEnergy: 100,
      y: 0,             // visual y on canvas (computed)
      animFrame: 0,
      finished: false,
      finishTime: 0,
      targetLane: index, // for AI lane switching
      laneChangeCD: 0,
    };
  }

  // ─── Pickup factory ───
  function spawnPickup() {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    const dist = runners[0].distance + 300 + Math.random() * 200;
    const type = Math.random() < 0.25 ? 'bolt' : 'food'; // bolt = big, food = small
    pickups.push({ lane, distance: dist, type, collected: false });
  }

  // ─── Initialize ───
  function init(canvasEl, hudCb, endCb) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    onHudUpdate = hudCb;
    onGameEnd = endCb;

    window.addEventListener('keydown', e => {
      keys[e.key] = true;
      // prevent arrow key scrolling
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { keys[e.key] = false; });

    // Touch controls for mobile
    let touchStartX = 0;
    canvas.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 30) {
        if (dx < 0) movePlayerLane(-1);
        else movePlayerLane(1);
      }
      e.preventDefault();
    }, { passive: false });
  }

  // ─── Resize ───
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width = rect.width;
    H = canvas.height = rect.height;
  }

  // ─── Start Race ───
  function startRace() {
    resize();
    gameState = 'countdown';
    frameCount = 0;
    finishOrder = [];
    pickups = [];
    keys = {};

    runners = [];
    for (let i = 0; i < LANE_COUNT; i++) {
      runners.push(createRunner(i, i === 0));
    }

    // Countdown sequence
    let count = 3;
    const cdText = document.getElementById('countdown-text');
    const cdOverlay = document.getElementById('countdown-overlay');
    cdOverlay.classList.remove('hidden');
    cdText.textContent = count;

    const cdInterval = setInterval(() => {
      count--;
      if (count > 0) {
        cdText.textContent = count;
        // Re-trigger animation
        cdText.style.animation = 'none';
        cdText.offsetHeight; // reflow
        cdText.style.animation = '';
      } else if (count === 0) {
        cdText.textContent = 'GO!';
        cdText.style.color = '#22c55e';
        cdText.style.animation = 'none';
        cdText.offsetHeight;
        cdText.style.animation = '';
      } else {
        clearInterval(cdInterval);
        cdOverlay.classList.add('hidden');
        cdText.style.color = '';
        gameState = 'running';
        raceStartTime = Date.now();
        loop();
      }
    }, 800);
  }

  // ─── Main Loop ───
  function loop() {
    if (gameState !== 'running' && gameState !== 'paused') return;
    if (gameState === 'paused') {
      frameId = requestAnimationFrame(loop);
      return;
    }

    frameId = requestAnimationFrame(loop);
    frameCount++;

    update();
    draw();
    updateHUD();

    // Check if all runners finished
    if (finishOrder.length >= LANE_COUNT) {
      gameState = 'finished';
      cancelAnimationFrame(frameId);
      onGameEnd && onGameEnd(getResults());
    }
  }

  // ─── Pause / Resume ───
  function pause() {
    if (gameState === 'running') gameState = 'paused';
  }
  function resume() {
    if (gameState === 'paused') {
      gameState = 'running';
    }
  }
  function stop() {
    gameState = 'idle';
    if (frameId) cancelAnimationFrame(frameId);
  }

  // ─── Player lane control ───
  function movePlayerLane(dir) {
    const p = runners[0];
    if (!p || p.finished) return;
    const newLane = p.lane + dir;
    if (newLane >= 0 && newLane < LANE_COUNT) {
      p.lane = newLane;
    }
  }

  // ─── Update ───
  function update() {
    const player = runners[0];

    // Player input
    if (!player.finished) {
      if ((keys['ArrowLeft'] || keys['a'] || keys['A']) && player.laneChangeCD <= 0) {
        movePlayerLane(-1);
        player.laneChangeCD = 10;
      }
      if ((keys['ArrowRight'] || keys['d'] || keys['D']) && player.laneChangeCD <= 0) {
        movePlayerLane(1);
        player.laneChangeCD = 10;
      }
    }

    // Update runners
    for (const r of runners) {
      if (r.finished) continue;

      if (r.laneChangeCD > 0) r.laneChangeCD--;

      // AI logic
      if (!r.isPlayer) {
        updateAI(r);
      }

      // Energy decay
      r.energy = Math.max(0, r.energy - ENERGY_DECAY * 60);

      // Speed calculation
      const energyMult = 1 + (r.energy / r.maxEnergy) * 0.8;
      const progressMult = 1 + (r.distance / TRACK_LENGTH) * 0.3;
      r.speed = BASE_SPEED * energyMult * progressMult;
      if (r.speed > MAX_SPEED) r.speed = MAX_SPEED;

      // Add some variation for AI
      if (!r.isPlayer) {
        r.speed *= (0.92 + Math.random() * 0.16);
      }

      r.distance += r.speed;
      r.animFrame++;

      // Finish check
      if (r.distance >= TRACK_LENGTH) {
        r.distance = TRACK_LENGTH;
        r.finished = true;
        r.finishTime = Date.now() - raceStartTime;
        finishOrder.push(r.index);
      }
    }

    // Spawn pickups
    if (frameCount % PICKUP_INTERVAL === 0) {
      spawnPickup();
    }

    // Check pickup collection
    for (const p of pickups) {
      if (p.collected) continue;
      for (const r of runners) {
        if (r.finished) continue;
        if (r.lane === p.lane && Math.abs(r.distance - p.distance) < 20) {
          p.collected = true;
          const boost = p.type === 'bolt' ? 25 : 12;
          r.energy = Math.min(r.maxEnergy, r.energy + boost);
          r.speed += ENERGY_BOOST;
        }
      }
    }

    // Cleanup old pickups
    const minDist = Math.min(...runners.map(r => r.distance)) - 100;
    pickups = pickups.filter(p => !p.collected && p.distance > minDist);
  }

  // ─── AI Logic ───
  function updateAI(r) {
    if (r.laneChangeCD > 0) return;

    // Look for nearby pickups
    let bestPickup = null;
    let bestDist = 200;
    for (const p of pickups) {
      if (p.collected) continue;
      const ahead = p.distance - r.distance;
      if (ahead > 0 && ahead < bestDist) {
        bestDist = ahead;
        bestPickup = p;
      }
    }

    if (bestPickup && bestPickup.lane !== r.lane) {
      const dir = bestPickup.lane > r.lane ? 1 : -1;
      r.lane += dir;
      r.laneChangeCD = 15 + Math.floor(Math.random() * 10);
    } else if (Math.random() < 0.01) {
      // Random lane change
      const dir = Math.random() < 0.5 ? -1 : 1;
      const newLane = r.lane + dir;
      if (newLane >= 0 && newLane < LANE_COUNT) {
        r.lane = newLane;
        r.laneChangeCD = 20;
      }
    }
  }

  // ─── Draw ───
  function draw() {
    ctx.clearRect(0, 0, W, H);

    const playerDist = runners[0].distance;
    const laneWidth = W / LANE_COUNT;
    const viewOffset = H * 0.75; // player position on screen

    // ── Background track ──
    // Dark gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d0d1a');
    grad.addColorStop(1, '#111128');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Lane lines
    ctx.strokeStyle = 'rgba(0,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = i * laneWidth;
      ctx.beginPath();
      ctx.setLineDash([12, 8]);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Track markers (distance lines scrolling)
    ctx.fillStyle = 'rgba(0,255,255,0.04)';
    const markerSpacing = 80;
    const offset = (playerDist * 3) % markerSpacing;
    for (let y = -markerSpacing + offset; y < H + markerSpacing; y += markerSpacing) {
      ctx.fillRect(0, y, W, 1);
    }

    // ── Finish line ──
    const finishY = viewOffset - (TRACK_LENGTH - playerDist) * 3;
    if (finishY > -20 && finishY < H + 20) {
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.15)';
      ctx.fillRect(0, finishY - 15, W, 30);
      // Checkered pattern
      const sq = 10;
      for (let x = 0; x < W; x += sq) {
        for (let row = 0; row < 3; row++) {
          if ((Math.floor(x / sq) + row) % 2 === 0) {
            ctx.fillStyle = 'rgba(34,197,94,0.4)';
          } else {
            ctx.fillStyle = 'rgba(34,197,94,0.1)';
          }
          ctx.fillRect(x, finishY - 15 + row * sq, sq, sq);
        }
      }
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 10px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏁 FINISH', W / 2, finishY - 20);
      ctx.restore();
    }

    // ── Pickups ──
    for (const p of pickups) {
      if (p.collected) continue;
      const px = p.lane * laneWidth + laneWidth / 2;
      const py = viewOffset - (p.distance - playerDist) * 3;
      if (py < -30 || py > H + 30) continue;

      ctx.save();
      if (p.type === 'bolt') {
        // Lightning bolt
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 12;
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', px, py + 7);
      } else {
        // Food / energy orb
        ctx.fillStyle = '#22c55e';
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+', px, py + 4);
      }
      ctx.restore();
    }

    // ── Runners ──
    // Sort by distance for z-order (furthest first)
    const sorted = [...runners].sort((a, b) => b.distance - a.distance);
    for (const r of sorted) {
      const rx = r.lane * laneWidth + laneWidth / 2;
      const ry = viewOffset - (r.distance - playerDist) * 3;
      if (ry < -50 || ry > H + 50) continue;

      drawRunner(rx, ry, r);
    }

    // ── Track edges glow ──
    const edgeGrad = ctx.createLinearGradient(0, 0, 12, 0);
    edgeGrad.addColorStop(0, 'rgba(0,255,255,0.12)');
    edgeGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, 12, H);

    const edgeGrad2 = ctx.createLinearGradient(W, 0, W - 12, 0);
    edgeGrad2.addColorStop(0, 'rgba(0,255,255,0.12)');
    edgeGrad2.addColorStop(1, 'transparent');
    ctx.fillStyle = edgeGrad2;
    ctx.fillRect(W - 12, 0, 12, H);
  }

  // ─── Draw a single runner (pixel art style) ───
  function drawRunner(x, y, r) {
    const s = 3; // pixel size
    const bob = r.finished ? 0 : Math.sin(r.animFrame * 0.3) * 3;
    const legSwap = r.finished ? false : (Math.floor(r.animFrame / 6) % 2 === 0);

    ctx.save();
    ctx.translate(x, y + bob);

    const c = r.color;
    const darker = shadeColor(c, -40);

    // Head
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = r.isPlayer ? 14 : 6;
    ctx.fillRect(-2 * s, -8 * s, 4 * s, 4 * s);

    // Body
    ctx.fillStyle = darker;
    ctx.shadowBlur = 0;
    ctx.fillRect(-2 * s, -4 * s, 4 * s, 5 * s);

    // Arms
    if (legSwap) {
      ctx.fillRect(-3 * s, -3 * s, s, 3 * s);
      ctx.fillRect(2 * s, -4 * s, s, 3 * s);
    } else {
      ctx.fillRect(-3 * s, -4 * s, s, 3 * s);
      ctx.fillRect(2 * s, -3 * s, s, 3 * s);
    }

    // Legs
    if (legSwap) {
      ctx.fillRect(-2 * s, s, 2 * s, 3 * s);
      ctx.fillRect(0, s + s, 2 * s, 3 * s);
    } else {
      ctx.fillRect(-2 * s, s + s, 2 * s, 3 * s);
      ctx.fillRect(0, s, 2 * s, 3 * s);
    }

    // Name label
    ctx.fillStyle = c;
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(r.name, 0, -10 * s);

    ctx.restore();
  }

  function shadeColor(hex, percent) {
    let r = parseInt(hex.slice(1,3)||'ff',16), g = parseInt(hex.slice(3,5)||'ff',16), b = parseInt(hex.slice(5,7)||'ff',16);
    // Handle named/css colors — fallback
    if (isNaN(r)) return hex;
    r = Math.max(0, Math.min(255, r + percent));
    g = Math.max(0, Math.min(255, g + percent));
    b = Math.max(0, Math.min(255, b + percent));
    return `rgb(${r},${g},${b})`;
  }

  // ─── HUD Update ───
  function updateHUD() {
    if (!onHudUpdate) return;

    const player = runners[0];
    const progress = Math.min(100, (player.distance / TRACK_LENGTH) * 100);

    // Calculate current position
    const sorted = [...runners].filter(r => !r.finished).sort((a, b) => b.distance - a.distance);
    const finishedCount = finishOrder.length;
    let position;
    if (player.finished) {
      position = finishOrder.indexOf(0) + 1;
    } else {
      const posInRunning = sorted.findIndex(r => r.index === 0);
      position = finishedCount + posInRunning + 1;
    }

    onHudUpdate({
      position,
      progress,
      speed: player.speed.toFixed(1),
      energy: player.energy,
      maxEnergy: player.maxEnergy
    });
  }

  // ─── Results ───
  function getResults() {
    const player = runners[0];
    const playerPos = finishOrder.indexOf(0) + 1;
    const score = FINISH_SCORE[playerPos - 1] || 0;
    const time = player.finishTime ? (player.finishTime / 1000).toFixed(2) : '—';
    const energyCollected = Math.round(player.energy);

    const podium = finishOrder.map((idx, rank) => ({
      name: RUNNER_NAMES[idx],
      rank: rank + 1,
      isPlayer: idx === 0,
      color: RUNNER_COLORS[idx]
    }));

    return { position: playerPos, score, time, energyCollected, podium };
  }

  // ─── Preview Animation (homepage) ───
  let previewId = null;
  function startPreview(previewCanvas) {
    const pctx = previewCanvas.getContext('2d');
    const pw = previewCanvas.width;
    const ph = previewCanvas.height;
    let tick = 0;

    const previewRunners = RUNNER_COLORS.map((c, i) => ({
      color: c, name: RUNNER_NAMES[i], lane: i, y: 0, speed: 0.5 + Math.random() * 0.5, animFrame: 0
    }));

    function drawPreview() {
      previewId = requestAnimationFrame(drawPreview);
      tick++;

      pctx.clearRect(0, 0, pw, ph);

      // BG
      const g = pctx.createLinearGradient(0, 0, 0, ph);
      g.addColorStop(0, '#0d0d1a');
      g.addColorStop(1, '#111128');
      pctx.fillStyle = g;
      pctx.fillRect(0, 0, pw, ph);

      // Lane lines
      const lw = pw / 4;
      pctx.strokeStyle = 'rgba(0,255,255,0.08)';
      pctx.setLineDash([8, 6]);
      for (let i = 1; i < 4; i++) {
        pctx.beginPath();
        pctx.moveTo(i * lw, 0);
        pctx.lineTo(i * lw, ph);
        pctx.stroke();
      }
      pctx.setLineDash([]);

      // Scrolling markers
      const mOff = (tick * 2) % 60;
      pctx.fillStyle = 'rgba(0,255,255,0.03)';
      for (let y = -60 + mOff; y < ph + 60; y += 60) {
        pctx.fillRect(0, y, pw, 1);
      }

      // Runners bobbing up and down
      for (const r of previewRunners) {
        r.animFrame++;
        const rx = r.lane * lw + lw / 2;
        const baseY = ph * 0.55 + Math.sin(tick * 0.02 + r.lane) * 40;
        const bob = Math.sin(r.animFrame * 0.25) * 2;

        const s = 2;
        pctx.save();
        pctx.translate(rx, baseY + bob);

        // Head
        pctx.fillStyle = r.color;
        pctx.shadowColor = r.color;
        pctx.shadowBlur = 8;
        pctx.fillRect(-2*s, -7*s, 4*s, 3*s);

        // Body
        pctx.shadowBlur = 0;
        pctx.fillRect(-2*s, -4*s, 4*s, 4*s);

        // Legs
        const swap = Math.floor(r.animFrame / 6) % 2 === 0;
        if (swap) {
          pctx.fillRect(-2*s, 0, 2*s, 3*s);
          pctx.fillRect(0, s, 2*s, 3*s);
        } else {
          pctx.fillRect(-2*s, s, 2*s, 3*s);
          pctx.fillRect(0, 0, 2*s, 3*s);
        }

        // Label
        pctx.fillStyle = r.color;
        pctx.font = '6px "Press Start 2P", monospace';
        pctx.textAlign = 'center';
        pctx.fillText(r.name, 0, -9*s);

        pctx.restore();
      }

      // Edge glow
      const eg1 = pctx.createLinearGradient(0,0,8,0);
      eg1.addColorStop(0,'rgba(0,255,255,0.1)');
      eg1.addColorStop(1,'transparent');
      pctx.fillStyle = eg1;
      pctx.fillRect(0,0,8,ph);

      const eg2 = pctx.createLinearGradient(pw,0,pw-8,0);
      eg2.addColorStop(0,'rgba(0,255,255,0.1)');
      eg2.addColorStop(1,'transparent');
      pctx.fillStyle = eg2;
      pctx.fillRect(pw-8,0,8,ph);
    }

    drawPreview();
  }

  function stopPreview() {
    if (previewId) cancelAnimationFrame(previewId);
  }

  // ─── Public API ───
  return {
    init,
    resize,
    startRace,
    pause,
    resume,
    stop,
    startPreview,
    stopPreview,
    getState: () => gameState,
  };
})();
