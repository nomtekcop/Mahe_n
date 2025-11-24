// public/client.js

// DOM 요소
const profileScreen = document.getElementById('profile-screen');
const gameScreen = document.getElementById('game-screen');

const nicknameInput = document.getElementById('nickname-input');
const colorSelect = document.getElementById('color-select');
const avatarDrop = document.getElementById('avatar-drop');
const avatarInput = document.getElementById('avatar-input');
const avatarDropText = document.getElementById('avatar-drop-text');
const enterGameBtn = document.getElementById('enter-game-btn');

const myNameSpan = document.getElementById('my-name');
const myAvatarImg = document.getElementById('my-avatar');
const myScoreSpan = document.getElementById('my-score');
const myEggInfoSpan = document.getElementById('my-egg-info');

const turnIndicator = document.getElementById('turn-indicator');
const rollBtn = document.getElementById('roll-btn');
const stopBtn = document.getElementById('stop-btn');

const diceRow = document.getElementById('dice-row');
const diceSumSpan = document.getElementById('dice-sum');

const boardContainer = document.getElementById('board');
const faceUpCardSpan = document.getElementById('faceup-card');
const remainingEggsSpan = document.getElementById('remaining-eggs');

const playerListArea = document.getElementById('player-list');
const logArea = document.getElementById('log-area');

const startGameBtn = document.getElementById('start-game-btn');

const gameOverPanel = document.getElementById('game-over-panel');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverList = document.getElementById('game-over-list');
const restartBtn = document.getElementById('restart-btn');

// 소리(원하면 index.html에서 주석 풀고 연결)
const bgm = document.getElementById('bgm');
const sfxRoll = document.getElementById('sfx-roll');
const sfxBust = document.getElementById('sfx-bust');
const sfxEgg = document.getElementById('sfx-egg');
const sfxWin = document.getElementById('sfx-win');

// 상태
let socket = null;
let myId = null;
let players = [];
let boardSize = 21;
let gameStarted = false;
let currentPlayerId = null;
let faceUpCard = null;
let remainingEggs = 0;
let bonus7Available = false;

let currentDice = [];
let currentSum = 0;

// 간단 로그
function addLog(text) {
  if (!logArea) return;
  const div = document.createElement('div');
  div.textContent = text;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

// 아바타 이미지 읽기
function readAvatarFile(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// 프로필 영역
avatarDrop.addEventListener('click', () => {
  avatarInput.click();
});

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files[0];
  if (!file) return;
  const dataUrl = await readAvatarFile(file);
  if (!dataUrl) return;

  avatarDropText.style.display = 'none';
  avatarDrop.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  avatarDrop.appendChild(img);
});

// 입장 버튼
enterGameBtn.addEventListener('click', async () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    alert('닉네임을 입력해줘!');
    return;
  }

  const profile = {
    name: nickname,
    color: colorSelect.value,
    avatar: null,
  };

  if (avatarInput.files[0]) {
    profile.avatar = await readAvatarFile(avatarInput.files[0]);
  }

  profileScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  connectSocket(profile);
});

// 소켓 연결
function connectSocket(myProfile) {
  socket = io();

  socket.on('connect', () => {
    addLog('서버에 연결되었습니다.');
  });

  socket.on('roomFull', () => {
    alert('방이 꽉 찼습니다.');
  });

  socket.on('awaitProfile', () => {
    socket.emit('registerProfile', myProfile);
  });

  socket.on('playerInfo', (info) => {
    myId = info.id;
    myNameSpan.textContent = info.name;
    myAvatarImg.src = info.avatar || 'default-avatar.png';
    updateMyScore(info);
  });

  socket.on('playerList', (list) => {
    players = list;
    renderPlayerList();

    // 호스트 여부
    const me = players.find((p) => p.id === myId);
    const isHost = me && me.index === 1;

    if (!gameStarted && isHost && players.length >= 2 && players.length <= 4) {
      startGameBtn.disabled = false;
    } else if (!gameStarted) {
      startGameBtn.disabled = true;
    }
  });

  socket.on('readyToStart', ({ hostId }) => {
    const me = players.find((p) => p.id === myId);
    if (!me) return;
    const isHost = me.index === 1;

    if (isHost && myId === hostId) {
      addLog('모두 입장! 호스트가 [게임 시작]을 누를 수 있어요.');
      startGameBtn.disabled = false;
    } else {
      addLog('모두 입장! 호스트가 게임을 시작할 때까지 기다려요.');
      startGameBtn.disabled = true;
    }
  });

  socket.on('gameStarted', (state) => {
    gameStarted = true;
    boardSize = state.boardSize || 21;
    faceUpCard = state.faceUpCard;
    remainingEggs = state.remainingEggs;

    gameOverPanel.classList.add('hidden');
    startGameBtn.disabled = true;

    currentDice = [];
    currentSum = 0;
    renderDice();
    renderBoard();
    updateCardInfo();

    addLog('게임 시작!');
  });

  socket.on('gameState', (state) => {
    gameStarted = state.gameStarted;
    currentPlayerId = state.currentPlayerId;
    players = state.players || players;
    boardSize = state.boardSize || 21;
    faceUpCard = state.faceUpCard;
    remainingEggs = state.remainingEggs;
    bonus7Available = state.bonus7Available;

    renderPlayerList();
    renderBoard();
    updateCardInfo();
    updateTurnUI();
    updateMyScoreFromState();
  });

  socket.on('turnChanged', ({ currentPlayerId: pid, currentPlayerName }) => {
    currentPlayerId = pid;
    currentDice = [];
    currentSum = 0;
    renderDice();
    updateTurnUI();
    if (pid === myId) {
      addLog(`내 차례! (현재: ${currentPlayerName})`);
    } else {
      addLog(`${currentPlayerName}의 차례`);
    }
  });

  socket.on('rollResult', ({ playerId, dice, sum, busted }) => {
    currentDice = dice;
    currentSum = sum;
    renderDice();

    const p = players.find((pl) => pl.id === playerId);
    const name = p ? p.name : '플레이어';

    if (busted) {
      addLog(`${name} 버스트! (합계 ${sum} > 7)`);
      if (playerId === myId && sfxBust) {
        sfxBust.currentTime = 0;
        sfxBust.play().catch(() => {});
      }
    } else {
      addLog(`${name} 주사위: [${dice.join(', ')}], 합계: ${sum}`);
      if (playerId === myId && sfxRoll) {
        sfxRoll.currentTime = 0;
        sfxRoll.play().catch(() => {});
      }
    }
  });

  socket.on('moveResolved', (payload) => {
    const {
      playerId,
      distance,
      newPosition,
      crossedFinish,
      eggAward,
      newFaceUpCard,
      remainingEggs: rem,
      bonus7Available: b7,
    } = payload;

    faceUpCard = newFaceUpCard;
    remainingEggs = rem;
    bonus7Available = b7;

    const p = players.find((pl) => pl.id === playerId);
    const name = p ? p.name : '플레이어';

    addLog(
      `${name}가 ${distance}칸 이동하여 위치 ${newPosition}번 칸에 도착`
    );

    if (crossedFinish && eggAward != null) {
      addLog(`${name}가 알 카드 ${eggAward}점을 획득!`);
      if (sfxEgg) {
        sfxEgg.currentTime = 0;
        sfxEgg.play().catch(() => {});
      }
    } else if (crossedFinish && eggAward == null && bonus7Available) {
      addLog('이제부터 한 바퀴 완주하면 7점 보너스 레이스!');
    }

    renderBoard();
    updateCardInfo();
  });

  socket.on('bonus7Ready', () => {
    addLog('모든 알 카드가 소진됨! 이제 한 바퀴 완주하는 플레이어가 7점을 먹고 게임이 끝납니다.');
  });

  socket.on('bonus7Taken', ({ playerId, playerName }) => {
    addLog(`${playerName}가 7점 보너스를 획득! 게임이 곧 종료됩니다.`);
  });

  socket.on('forcedStop', (msg) => {
    addLog(`게임이 중단되었습니다: ${msg}`);
  });

  socket.on('gameOver', ({ reason, players: finalPlayers, winnerId, winnerName }) => {
    if (sfxWin) {
      sfxWin.currentTime = 0;
      sfxWin.play().catch(() => {});
    }

    gameStarted = false;
    startGameBtn.disabled = false;

    gameOverTitle.textContent =
      reason === 'bonus7'
        ? '게임 종료 (7점 보너스 확정!)'
        : '게임 종료';

    gameOverList.innerHTML = '';
    finalPlayers.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'game-over-row';
      if (p.id === winnerId) {
        row.classList.add('winner');
      }
      row.textContent = `${idx + 1}위 - ${p.name}: ${
        p.finalScore
      }점 (알 카드 합 ${p.eggsTotal}, 장수 ${p.eggsCount}장, 보너스 ${p.bonus7}점)`;
      gameOverList.appendChild(row);
    });

    gameOverPanel.classList.remove('hidden');
    addLog(`우승: ${winnerName}`);
  });

  // 버튼들
  startGameBtn.addEventListener('click', () => {
    if (!socket) return;
    startGameBtn.disabled = true;
    socket.emit('startGame');
  });

  rollBtn.addEventListener('click', () => {
    if (!socket || !gameStarted) return;
    socket.emit('rollDice');
  });

  stopBtn.addEventListener('click', () => {
    if (!socket || !gameStarted) return;
    socket.emit('stopAndMove');
  });

  restartBtn.addEventListener('click', () => {
    gameOverPanel.classList.add('hidden');
    const me = players.find((p) => p.id === myId);
    const isHost = me && me.index === 1;
    if (isHost) {
      startGameBtn.disabled = false;
      addLog('호스트가 [게임 시작]을 누르면 새 게임이 시작됩니다.');
    } else {
      addLog('호스트가 다시 시작할 때까지 기다려주세요.');
    }
  });
}

// UI 렌더링 함수들
function renderPlayerList() {
  if (!playerListArea) return;
  playerListArea.innerHTML = '';

  players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'player-row';
    div.dataset.playerId = p.id;

    const mark = p.id === myId ? ' (나)' : '';
    const score = (p.eggsTotal + p.bonus7) || 0;

    div.textContent = `${p.index}번 - ${p.name}${mark} : ${score}점 (알 ${p.eggsTotal} / ${p.eggsCount}장, 보너스 ${p.bonus7})`;

    playerListArea.appendChild(div);
  });
}

function renderBoard() {
  if (!boardContainer) return;
  boardContainer.innerHTML = '';

  // 0 ~ boardSize-1
  for (let i = 0; i < boardSize; i++) {
    const cell = document.createElement('div');
    cell.className = 'board-cell';

    const label = document.createElement('div');
    label.className = 'cell-label';
    if (i === 0) {
      label.textContent = '0 (완주)';
      cell.classList.add('cell-start');
    } else {
      label.textContent = String(i);
    }
    cell.appendChild(label);

    const tokenArea = document.createElement('div');
    tokenArea.className = 'cell-tokens';

    // 이 칸에 있는 플레이어들
    players
      .filter((p) => p.position === i)
      .forEach((p) => {
        const token = document.createElement('div');
        token.className = 'token';
        token.dataset.playerId = p.id;

        switch (p.color) {
          case 'red':
            token.style.background = '#f87171';
            break;
          case 'green':
            token.style.background = '#4ade80';
            break;
          case 'blue':
            token.style.background = '#60a5fa';
            break;
          case 'yellow':
            token.style.background = '#facc15';
            break;
          default:
            token.style.background = '#e5e7eb';
        }

        token.title = p.name;
        tokenArea.appendChild(token);
      });

    cell.appendChild(tokenArea);
    boardContainer.appendChild(cell);
  }
}

function renderDice() {
  diceRow.innerHTML = '';

  currentDice.forEach((v) => {
    const d = document.createElement('div');
    d.className = 'die';
    d.textContent = v;
    diceRow.appendChild(d);
  });

  diceSumSpan.textContent = currentSum;

  // 첫 번째 주사위 전에는 stop 금지
  if (currentDice.length === 0) {
    stopBtn.disabled = true;
  } else {
    stopBtn.disabled = false;
  }
}

function updateCardInfo() {
  if (faceUpCard != null) {
    faceUpCardSpan.textContent = `${faceUpCard}점`;
  } else if (bonus7Available) {
    faceUpCardSpan.textContent = '모든 알 소진! (이제 한 바퀴 완주 시 7점)';
  } else {
    faceUpCardSpan.textContent = '-';
  }

  remainingEggsSpan.textContent = String(remainingEggs);
}

function updateTurnUI() {
  const isMyTurn = myId && currentPlayerId === myId;

  if (!currentPlayerId) {
    turnIndicator.textContent = '대기 중…';
    rollBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  const curP = players.find((p) => p.id === currentPlayerId);
  const name = curP ? curP.name : '플레이어';

  if (isMyTurn) {
    turnIndicator.textContent = `내 차례 (${name})`;
    rollBtn.disabled = false;
    // stop 버튼은 renderDice에서 제어(첫 주사위 전에는 막기)
  } else {
    turnIndicator.textContent = `${name}의 차례`;
    rollBtn.disabled = true;
    stopBtn.disabled = true;
  }
}

function updateMyScore(info) {
  const total = (info.eggsTotal || 0) + (info.bonus7 || 0);
  myScoreSpan.textContent = `${total}점`;
  myEggInfoSpan.textContent = `알 합계 ${info.eggsTotal || 0}, 장수 ${
    info.eggsCount || 0
  }장, 보너스 ${info.bonus7 || 0}`;
}

function updateMyScoreFromState() {
  const me = players.find((p) => p.id === myId);
  if (!me) return;
  updateMyScore(me);
}
