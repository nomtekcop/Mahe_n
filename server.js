// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// =====================
// 게임 상수
// =====================
const BOARD_SIZE = 21;          // 0 ~ 20, 0이 뗏목/완주 지점
const MAX_DICE_PER_TURN = 3;    // 최대 3번 굴림
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

// =====================
// 전역 상태
// =====================
let players = [];   // { id, name, avatar, color, index, position, eggsTotal, eggsCount, bonus7 }
let gameStarted = false;
let currentPlayerId = null;

// 알 카드 덱
let eggDeck = [];        // 사용 가능한 알 카드 (앞에서 뽑음)
let faceUpCard = null;   // 현재 공개된 알 카드 (없으면 null)
let bonus7Available = false;   // 알 카드 다 쓰고 나서 7점 보너스가 남았는지
let bonus7WinnerId = null;

// 현재 턴의 주사위 상태
let rollState = null;    // { playerId, dice, sum, busted, finished }

// =====================
// 유틸 함수
// =====================
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function createEggDeck() {
  const cards = [];
  for (let v = 1; v <= 6; v++) {
    for (let i = 0; i < 4; i++) {
      cards.push(v);
    }
  }
  shuffle(cards);

  // 상위 4장 제거
  const removed = cards.splice(0, 4);
  console.log('제거된 알 카드 4장(게임 미사용):', removed);

  return cards; // 남은 20장
}

function drawEggCard() {
  if (eggDeck.length === 0) return null;
  return eggDeck.shift();  // 맨 앞에서 하나 뽑기
}

function getPlayersView() {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    index: p.index,
    position: p.position,
    eggsTotal: p.eggsTotal,
    eggsCount: p.eggsCount,
    bonus7: p.bonus7,
  }));
}

function broadcastGameState() {
  io.emit('gameState', {
    gameStarted,
    currentPlayerId,
    players: getPlayersView(),
    boardSize: BOARD_SIZE,
    faceUpCard,
    remainingEggs: eggDeck.length + (faceUpCard !== null ? 1 : 0),
    bonus7Available,
  });
}

function nextPlayerTurn() {
  if (!gameStarted || players.length < MIN_PLAYERS) {
    currentPlayerId = null;
    rollState = null;
    broadcastGameState();
    return;
  }

  if (!currentPlayerId) {
    // 게임 처음 시작할 때
    currentPlayerId = players[0].id;
  } else {
    const curIndex = players.findIndex((p) => p.id === currentPlayerId);
    if (curIndex === -1) {
      // 혹시 나간 플레이어였다면 0번부터
      currentPlayerId = players[0]?.id || null;
    } else {
      const next = players[(curIndex + 1) % players.length];
      currentPlayerId = next.id;
    }
  }

  rollState = {
    playerId: currentPlayerId,
    dice: [],
    sum: 0,
    busted: false,
    finished: false,
  };

  const curPlayer = players.find((p) => p.id === currentPlayerId);
  io.emit('turnChanged', {
    currentPlayerId,
    currentPlayerName: curPlayer ? curPlayer.name : null,
  });
  broadcastGameState();
}

// 거리만큼 이동시키고, 한 바퀴를 완주했는지 여부 리턴
function movePlayerAndCheckLap(player, distance) {
  const prevPos = player.position;
  let pos = prevPos;
  let crossedFinish = false;

  for (let step = 0; step < distance; step++) {
    pos = (pos + 1) % BOARD_SIZE;
    if (pos === 0) crossedFinish = true; // 0번 칸이 완주 지점
  }

  player.position = pos;
  return crossedFinish;
}

function endGame(reason) {
  gameStarted = false;

  // 최종 점수 = 알 카드 총합 + 보너스7
  players.forEach((p) => {
    p.finalScore = p.eggsTotal + p.bonus7;
  });

  const sorted = [...players].sort((a, b) => {
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore;
    }
    // 동점이면 알 카드 장수 많은 사람이 우승
    if (b.eggsCount !== a.eggsCount) {
      return b.eggsCount - a.eggsCount;
    }
    // 그래도 같으면 좌석(index)가 앞선 사람이 이긴 걸로
    return a.index - b.index;
  });

  const winner = sorted[0] || null;

  io.emit('gameOver', {
    reason,
    players: sorted.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      eggsTotal: p.eggsTotal,
      eggsCount: p.eggsCount,
      bonus7: p.bonus7,
      finalScore: p.finalScore,
    })),
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null,
  });

  // 게임 끝나도 플레이어는 방에 남아 있음(다시 시작 가능)
  currentPlayerId = null;
  rollState = null;
  broadcastGameState();
}

// =====================
// 소켓 처리
// =====================
io.on('connection', (socket) => {
  console.log('새 유저 접속:', socket.id);

  if (players.length >= MAX_PLAYERS) {
    socket.emit('roomFull');
    return;
  }

  const playerIndex = players.length + 1;
  const player = {
    id: socket.id,
    name: null,
    avatar: null,
    color: null,
    index: playerIndex,
    position: 0,
    eggsTotal: 0,
    eggsCount: 0,
    bonus7: 0,
  };
  players.push(player);

  socket.emit('awaitProfile', {
    suggestedName: `Player ${playerIndex}`,
  });

  // 프로필 등록
  socket.on('registerProfile', (data) => {
    const nameFromClient = data?.name ?? '';
    const requestedColor = data?.color || null;
    const avatar = data?.avatar || null;

    const usedColors = players
      .filter((pl) => pl.id !== player.id)
      .map((pl) => pl.color)
      .filter(Boolean);

    const allColors = ['red', 'green', 'blue', 'yellow'];
    let finalColor = requestedColor;
    if (!finalColor || usedColors.includes(finalColor)) {
      finalColor = allColors.find((c) => !usedColors.includes(c)) || 'red';
    }

    player.name = nameFromClient.trim() || `Player ${player.index}`;
    player.avatar = avatar;
    player.color = finalColor;

    socket.emit('playerInfo', {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      index: player.index,
      eggsTotal: player.eggsTotal,
      eggsCount: player.eggsCount,
      bonus7: player.bonus7,
    });

    io.emit('playerList', getPlayersView());

    // 시작 조건 체크
    if (
      players.length >= MIN_PLAYERS &&
      players.length <= MAX_PLAYERS &&
      !gameStarted
    ) {
      io.emit('readyToStart', {
        hostId: players[0].id,
      });
    }
  });

  // 게임 시작
  socket.on('startGame', () => {
    if (gameStarted) return;
    if (players.length < MIN_PLAYERS) return;
    if (socket.id !== players[0].id) return; // 호스트만 가능

    console.log('게임 시작!');

    // 상태 초기화
    gameStarted = true;
    currentPlayerId = null;
    rollState = null;
    bonus7Available = false;
    bonus7WinnerId = null;

    // 덱 생성
    eggDeck = createEggDeck();
    faceUpCard = drawEggCard();

    // 플레이어 초기화
    players.forEach((p) => {
      p.position = 0;
      p.eggsTotal = 0;
      p.eggsCount = 0;
      p.bonus7 = 0;
    });

    io.emit('gameStarted', {
      boardSize: BOARD_SIZE,
      faceUpCard,
      remainingEggs: eggDeck.length + (faceUpCard !== null ? 1 : 0),
    });

    nextPlayerTurn();
  });

  // 주사위 굴리기
  socket.on('rollDice', () => {
    if (!gameStarted) return;
    if (socket.id !== currentPlayerId) return;
    if (!rollState || rollState.playerId !== socket.id) return;
    if (rollState.busted || rollState.finished) return;
    if (rollState.dice.length >= MAX_DICE_PER_TURN) return;

    // 첫 번째 주사위는 반드시 굴려야 하는 규칙은
    // 클라이언트에서 "stop" 버튼을 처음에는 비활성화하는 식으로 처리
    const value = Math.floor(Math.random() * 6) + 1;
    rollState.dice.push(value);
    rollState.sum += value;

    let busted = false;
    if (rollState.sum > 7) {
      busted = true;
      rollState.busted = true;
      rollState.finished = true;
    }

    io.emit('rollResult', {
      playerId: socket.id,
      dice: rollState.dice,
      sum: rollState.sum,
      busted,
    });

    if (busted) {
      // 버스트 → 해당 플레이어 뗏목으로 복귀
      const p = players.find((pl) => pl.id === socket.id);
      if (p) {
        p.position = 0;
      }
      broadcastGameState();

      // 다음 플레이어로
      setTimeout(() => {
        nextPlayerTurn();
      }, 800);
    }
  });

  // "멈추고 이동하기" 버튼
  socket.on('stopAndMove', () => {
    if (!gameStarted) return;
    if (socket.id !== currentPlayerId) return;
    if (!rollState || rollState.playerId !== socket.id) return;
    if (rollState.busted || rollState.finished) return;
    if (rollState.dice.length === 0) return; // 한 번도 안 굴렸으면 안 됨

    rollState.finished = true;

    const diceCount = rollState.dice.length;
    const sum = rollState.sum;
    const distance = sum * diceCount;

    const p = players.find((pl) => pl.id === socket.id);
    if (!p) return;

    const crossedFinish = movePlayerAndCheckLap(p, distance);

    let eggAward = null;
    let bonus7Award = false;

    if (crossedFinish) {
      // 한 바퀴 완주
      if (faceUpCard !== null) {
        // 아직 알 카드가 남아있는 경우 → 공개된 알 카드 획득
        eggAward = faceUpCard;
        p.eggsTotal += faceUpCard;
        p.eggsCount += 1;

        faceUpCard = drawEggCard(); // 다음 카드 뒤집기

        if (faceUpCard === null && eggDeck.length === 0) {
          // 이제 알 카드가 전부 사용됨 → 7점 보너스 준비
          bonus7Available = true;
          io.emit('bonus7Ready');
        }
      } else if (bonus7Available) {
        // 7점 보너스 레이스 단계
        bonus7Award = true;
        bonus7Available = false;
        bonus7WinnerId = p.id;
        p.bonus7 += 7;

        io.emit('bonus7Taken', {
          playerId: p.id,
          playerName: p.name,
        });

        // 즉시 게임 종료
        endGame('bonus7');
        return;
      }
    }

    io.emit('moveResolved', {
      playerId: p.id,
      distance,
      newPosition: p.position,
      crossedFinish,
      eggAward,
      newFaceUpCard: faceUpCard,
      remainingEggs: eggDeck.length + (faceUpCard !== null ? 1 : 0),
      bonus7Available,
    });

    broadcastGameState();

    setTimeout(() => {
      nextPlayerTurn();
    }, 800);
  });

  socket.on('disconnect', () => {
    console.log('유저 나감:', socket.id);
    const wasCurrent = socket.id === currentPlayerId;

    players = players.filter((p) => p.id !== socket.id);

    if (players.length < MIN_PLAYERS) {
      // 인원 부족 → 게임 강제 종료
      gameStarted = false;
      currentPlayerId = null;
      rollState = null;
      io.emit('forcedStop', '플레이어 수가 부족해져서 게임이 중단되었습니다.');
      broadcastGameState();
      return;
    }

    io.emit('playerList', getPlayersView());

    if (!gameStarted) {
      // 대기 상태면 그냥 호스트 정보만 갱신
      if (players.length >= MIN_PLAYERS) {
        io.emit('readyToStart', {
          hostId: players[0].id,
        });
      }
      return;
    }

    // 게임 중일 때 나간 경우
    if (wasCurrent) {
      // 현재 턴 주인이 나갔으면 바로 다음 턴
      nextPlayerTurn();
    } else {
      // 그냥 상태만 갱신
      broadcastGameState();
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
