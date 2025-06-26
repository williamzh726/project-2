const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BALL_RADIUS = 6;
const BRICK_ROWS = 7;
const BRICK_COLS = 8;
const BRICK_WIDTH = 44;
const BRICK_HEIGHT = 24;
const BRICK_PADDING = 6;
const BRICK_OFFSET_TOP = 60;
const BRICK_OFFSET_LEFT = 10;
const BALL_SPEED = 6;
const POWERUP_RADIUS = 10;

let balls = [];
let bricks = [];
let powerups = [];
let numBalls = 1;
let aiming = true;
let aimAngle = Math.PI / 2;
let turn = 1;
let gameOver = false;
let launchX = WIDTH / 2;
let launchY = HEIGHT - 20;
let ballsToAdd = 0;
let lastBallEndX = launchX;
let lastBallEndY = launchY;
let speedMultiplier = 1;
let speedButtonsVisible = false;
let speedButtonTimeout = null;
let splitNextTurn = false;
let speed10xTimeout = null;

function resetBalls() {
  let totalBalls = numBalls;
  if (splitNextTurn) {
    totalBalls *= 2;
    splitNextTurn = false;
  }
  balls = [];
  for (let i = 0; i < totalBalls; i++) {
    balls.push({
      x: lastBallEndX,
      y: lastBallEndY,
      dx: 0,
      dy: 0,
      active: false
    });
  }
}

function createBricks() {
  // Place bricks, never fill the row completely
  let brickPositions = [];
  let maxBricks = BRICK_COLS - 1; // always leave at least one gap
  let bricksThisRow = 0;
  let brickCols = Array.from({length: BRICK_COLS}, (_, i) => i);
  // Shuffle columns
  for (let i = brickCols.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [brickCols[i], brickCols[j]] = [brickCols[j], brickCols[i]];
  }
  let bricksThisLevel = 0;
  // Bomb powerup: only place if this is a bomb level
  let bombThisLevel = (turn % (5 + Math.floor(Math.random()*6)) === 0);
  let bombPlaced = false;
  let bombCol = null;
  if (bombThisLevel) {
    bombCol = Math.floor(Math.random() * BRICK_COLS);
  }
  // Exponential health scaling if arena is empty
  let prevBricks = bricks.length;
  let expFactor = 1;
  if (prevBricks === 0 && turn > 5) {
    expFactor = 1 + Math.pow(1.08, turn - 5 + Math.floor(numBalls/10));
  } else if (turn > 10) {
    expFactor = 1 + Math.pow(1.04, turn - 10 + Math.floor(numBalls/10));
  }
  for (let idx = 0; idx < BRICK_COLS && bricksThisRow < maxBricks; idx++) {
    let c = brickCols[idx];
    if (Math.random() < 0.7) {
      let x = BRICK_OFFSET_LEFT + c * (BRICK_WIDTH + BRICK_PADDING);
      let y = BRICK_OFFSET_TOP;
      // Health: randomize from the start, scale with balls and exponentially if arena is empty
      let base = 1 + Math.floor((turn - 1) / 2);
      let extra = Math.floor(Math.random() * (1 + Math.floor(turn / 5)));
      let ballFactor = Math.floor(numBalls / 10);
      let health = Math.floor((base + extra + ballFactor) * expFactor);
      // Cap health to 3x the max possible balls (current + available +1 ball powerups)
      let availableBallPowerups = powerups.filter(p => !p.collected && p.type === 'ball').length;
      let maxPossibleBalls = numBalls + availableBallPowerups;
      let maxHealth = Math.max(1, 3 * maxPossibleBalls);
      health = Math.min(health, maxHealth);
      bricks.push({
        x,
        y,
        hits: health
      });
      brickPositions.push(c);
      bricksThisRow++;
      bricksThisLevel++;
    }
  }
  // Place bomb powerup in a column without a brick
  if (bombThisLevel && bombCol !== null && !brickPositions.includes(bombCol)) {
    let bx = BRICK_OFFSET_LEFT + bombCol * (BRICK_WIDTH + BRICK_PADDING) + BRICK_WIDTH/2;
    let by = BRICK_OFFSET_TOP + BRICK_HEIGHT/2;
    powerups.push({ x: bx, y: by, collected: false, type: 'bomb' });
  }
  // Ball powerup: ensure it never overlaps a brick or bomb
  if (Math.random() < 0.5) {
    let tries = 0;
    let placed = false;
    while (!placed && tries < 20) {
      let col = Math.floor(Math.random() * BRICK_COLS);
      let rowOffset = 1 + Math.floor(Math.random() * 2); // 1 or 2 rows below the top
      let px = BRICK_OFFSET_LEFT + col * (BRICK_WIDTH + BRICK_PADDING) + BRICK_WIDTH/2;
      let py = BRICK_OFFSET_TOP + rowOffset * (BRICK_HEIGHT + BRICK_PADDING) + BRICK_HEIGHT/2;
      // Check overlap with all bricks and bombs
      let overlap = bricks.some(b =>
        px + POWERUP_RADIUS > b.x && px - POWERUP_RADIUS < b.x + BRICK_WIDTH &&
        py + POWERUP_RADIUS > b.y && py - POWERUP_RADIUS < b.y + BRICK_HEIGHT
      ) || powerups.some(p => Math.hypot(px - p.x, py - p.y) < POWERUP_RADIUS*2);
      if (!overlap) {
        powerups.push({ x: px, y: py, collected: false, type: 'ball' });
        placed = true;
      }
      tries++;
    }
  }
  // Add more powerups: multi-ball (split), horizontal laser, vertical laser
  if (Math.random() < 0.25) {
    let tries = 0;
    let placed = false;
    while (!placed && tries < 20) {
      let col = Math.floor(Math.random() * BRICK_COLS);
      let rowOffset = 2 + Math.floor(Math.random() * 2); // 2 or 3 rows below the top
      let px = BRICK_OFFSET_LEFT + col * (BRICK_WIDTH + BRICK_PADDING) + BRICK_WIDTH/2;
      let py = BRICK_OFFSET_TOP + rowOffset * (BRICK_HEIGHT + BRICK_PADDING) + BRICK_HEIGHT/2;
      let overlap = bricks.some(b =>
        px + POWERUP_RADIUS > b.x && px - POWERUP_RADIUS < b.x + BRICK_WIDTH &&
        py + POWERUP_RADIUS > b.y && py - POWERUP_RADIUS < b.y + BRICK_HEIGHT
      ) || powerups.some(p => Math.hypot(px - p.x, py - p.y) < POWERUP_RADIUS*2);
      if (!overlap) {
        // Randomly pick a type
        let types = ['split', 'laser', 'vlaser'];
        let type = types[Math.floor(Math.random()*types.length)];
        powerups.push({ x: px, y: py, collected: false, type });
        placed = true;
      }
      tries++;
    }
  }
}

function moveBricksDown() {
  for (let brick of bricks) {
    brick.y += BRICK_HEIGHT + BRICK_PADDING;
    if (brick.y + BRICK_HEIGHT >= HEIGHT - 20) {
      gameOver = true;
      document.getElementById('gameOver').style.display = 'block';
    }
  }
  for (let p of powerups) {
    p.y += BRICK_HEIGHT + BRICK_PADDING;
  }
}

function drawBricks() {
  for (let brick of bricks) {
    ctx.fillStyle = `hsl(${brick.hits * 20}, 70%, 55%)`;
    ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(brick.hits, brick.x + BRICK_WIDTH/2, brick.y + BRICK_HEIGHT/2 + 6);
  }
}

function drawPowerups() {
  for (let p of powerups) {
    if (!p.collected) {
      ctx.beginPath();
      if (p.type === 'bomb') {
        ctx.arc(p.x, p.y, POWERUP_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#e53935';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('💣', p.x, p.y + 6);
      } else if (p.type === 'split') {
        ctx.arc(p.x, p.y, POWERUP_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#2196f3';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('⨉2', p.x, p.y + 6);
      } else if (p.type === 'laser') {
        ctx.arc(p.x, p.y, POWERUP_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffeb3b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.fillText('—', p.x, p.y + 6);
      } else if (p.type === 'vlaser') {
        ctx.arc(p.x, p.y, POWERUP_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#ab47bc';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('|', p.x, p.y + 6);
      } else {
        ctx.arc(p.x, p.y, POWERUP_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#4caf50';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('+1', p.x, p.y + 6);
      }
    }
  }
}

function drawBalls() {
  for (let ball of balls) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.stroke();
  }
}

function drawAim() {
  if (aiming) {
    ctx.save();
    ctx.strokeStyle = '#4caf50';
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(lastBallEndX, lastBallEndY);
    ctx.lineTo(lastBallEndX + Math.cos(aimAngle) * 120, lastBallEndY - Math.sin(aimAngle) * 120);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function updateBalls() {
  let allStopped = true;
  let lastActiveBall = null;
  for (let ball of balls) {
    if (ball.active) {
      ball.x += ball.dx;
      ball.y += ball.dy;
      // Wall bounce
      if (ball.x < BALL_RADIUS || ball.x > WIDTH - BALL_RADIUS) {
        ball.dx *= -1;
        ball.x = Math.max(BALL_RADIUS, Math.min(WIDTH - BALL_RADIUS, ball.x));
      }
      if (ball.y < BALL_RADIUS) {
        ball.dy *= -1;
        ball.y = BALL_RADIUS;
      }
      // Brick collision (AABB with radius, side detection)
      for (let brick of bricks) {
        let closestX = Math.max(brick.x, Math.min(ball.x, brick.x + BRICK_WIDTH));
        let closestY = Math.max(brick.y, Math.min(ball.y, brick.y + BRICK_HEIGHT));
        let distX = ball.x - closestX;
        let distY = ball.y - closestY;
        if (distX * distX + distY * distY < BALL_RADIUS * BALL_RADIUS) {
          // Determine collision side
          let overlapLeft = Math.abs((ball.x + BALL_RADIUS) - brick.x);
          let overlapRight = Math.abs((ball.x - BALL_RADIUS) - (brick.x + BRICK_WIDTH));
          let overlapTop = Math.abs((ball.y + BALL_RADIUS) - brick.y);
          let overlapBottom = Math.abs((ball.y - BALL_RADIUS) - (brick.y + BRICK_HEIGHT));
          let minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft || minOverlap === overlapRight) {
            ball.dx *= -1;
          } else {
            ball.dy *= -1;
          }
          brick.hits--;
          if (brick.hits <= 0) {
            bricks = bricks.filter(b => b !== brick);
          }
          break;
        }
      }
      // Powerup collision
      for (let p of powerups) {
        if (!p.collected && Math.hypot(ball.x - p.x, ball.y - p.y) < BALL_RADIUS + POWERUP_RADIUS) {
          p.collected = true;
          if (p.type === 'bomb') {
            // Bomb: destroy all bricks in 3x3 radius
            for (let b of bricks.slice()) {
              let bx = b.x + BRICK_WIDTH/2;
              let by = b.y + BRICK_HEIGHT/2;
              if (Math.abs(bx - p.x) <= (BRICK_WIDTH + BRICK_PADDING)*2.5 && Math.abs(by - p.y) <= (BRICK_HEIGHT + BRICK_PADDING)*2.5) {
                bricks = bricks.filter(br => br !== b);
              }
            }
          } else if (p.type === 'split') {
            // Split: double the number of balls next turn (only for one turn)
            splitNextTurn = true;
          } else if (p.type === 'laser') {
            // Laser: destroy all bricks in the same row as the powerup
            let py = p.y;
            bricks = bricks.filter(b => Math.abs((b.y + BRICK_HEIGHT/2) - py) > BRICK_HEIGHT/2);
          } else if (p.type === 'vlaser') {
            // Vertical laser: destroy all bricks in the same column as the powerup
            let px = p.x;
            bricks = bricks.filter(b => Math.abs((b.x + BRICK_WIDTH/2) - px) > BRICK_WIDTH/2);
          } else {
            ballsToAdd++;
          }
        }
      }
      // Floor
      if (ball.y > HEIGHT - BALL_RADIUS) {
        ball.active = false;
        ball.y = HEIGHT - BALL_RADIUS;
      } else {
        allStopped = false;
      }
    }
    if (!ball.active) {
      lastActiveBall = ball;
    }
  }
  // Set last ball end position for next turn
  if (allStopped && lastActiveBall) {
    lastBallEndX = lastActiveBall.x;
    lastBallEndY = lastActiveBall.y;
  }
  return allStopped;
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBricks();
  drawPowerups();
  drawBalls();
  drawAim();
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText('Balls: ' + numBalls, 10, 30);
  ctx.fillText('Turn: ' + turn, 10, 52);
}

function setSpeed(mult) {
  speedMultiplier = mult;
}

function showSpeedButtons() {
  if (!speedButtonsVisible) {
    speedButtonsVisible = true;
    const btn2x = document.createElement('button');
    btn2x.id = 'speed2x';
    btn2x.textContent = '2x Speed';
    btn2x.style.margin = '10px';
    btn2x.onclick = () => setSpeed(2);
    document.body.appendChild(btn2x);
    const btn4x = document.createElement('button');
    btn4x.id = 'speed4x';
    btn4x.textContent = '4x Speed';
    btn4x.style.margin = '10px';
    btn4x.onclick = () => setSpeed(4);
    document.body.appendChild(btn4x);
    const btn10x = document.createElement('button');
    btn10x.id = 'speed10x';
    btn10x.textContent = '10x Speed';
    btn10x.style.margin = '10px';
    btn10x.onclick = () => setSpeed(10);
    document.body.appendChild(btn10x);
  }
}

function hideSpeedButtons() {
  speedMultiplier = 1;
  speedButtonsVisible = false;
  const btn2x = document.getElementById('speed2x');
  const btn4x = document.getElementById('speed4x');
  const btn10x = document.getElementById('speed10x');
  if (btn2x) btn2x.remove();
  if (btn4x) btn4x.remove();
  if (btn10x) btn10x.remove();
  if (speed10xTimeout) {
    clearTimeout(speed10xTimeout);
    speed10xTimeout = null;
  }
}

function gameLoop() {
  if (gameOver) return;
  draw();
  if (!aiming) {
    if (!speedButtonsVisible && !speedButtonTimeout) {
      speedButtonTimeout = setTimeout(showSpeedButtons, 5000);
    }
    for (let i = 0; i < speedMultiplier; i++) {
      let allStopped = updateBalls();
      if (allStopped) {
        // Next turn
        numBalls += ballsToAdd;
        ballsToAdd = 0;
        moveBricksDown();
        turn++;
        createBricks();
        resetBalls();
        aiming = true;
        hideSpeedButtons();
        speedMultiplier = 1; // Reset speed multiplier after each turn
        if (speedButtonTimeout) {
          clearTimeout(speedButtonTimeout);
          speedButtonTimeout = null;
        }
        break;
      }
    }
  } else {
    hideSpeedButtons();
    if (speedButtonTimeout) {
      clearTimeout(speedButtonTimeout);
      speedButtonTimeout = null;
    }
  }
  requestAnimationFrame(gameLoop);
}

canvas.addEventListener('mousemove', e => {
  if (aiming) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    aimAngle = Math.atan2(launchY - my, mx - launchX);
    if (aimAngle < 0.2) aimAngle = 0.2;
    if (aimAngle > Math.PI - 0.2) aimAngle = Math.PI - 0.2;
  }
});

canvas.addEventListener('click', e => {
  if (aiming && !gameOver) {
    for (let i = 0; i < balls.length; i++) {
      setTimeout(() => {
        balls[i].dx = Math.cos(aimAngle) * BALL_SPEED;
        balls[i].dy = -Math.sin(aimAngle) * BALL_SPEED;
        balls[i].active = true;
      }, i * 80);
    }
    aiming = false;
  }
});

function startGame() {
  createBricks();
  resetBalls();
  gameLoop();
}

function addAttribution() {
  const div = document.createElement('div');
  div.style.position = 'fixed';
  div.style.bottom = '10px';
  div.style.left = '0';
  div.style.width = '100%';
  div.style.textAlign = 'center';
  div.style.color = '#aaa';
  div.style.fontSize = '1em';
  div.innerHTML = 'By: <a href="https://github.com/williamzh726" target="_blank" style="color:#4cafef;text-decoration:underline;">William Zhou</a>';
  document.body.appendChild(div);
}

window.onload = function() {
  addAttribution();
};

startGame();
