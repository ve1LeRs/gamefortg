import {
  type BoardGameNet,
  type BoardRoom,
  type LobbyListing,
  type PlayerInfo,
  hostBoardRoom,
  joinBoardRoom,
  watchBoardLobby,
} from '../../net/boardPeerRoom'
import {
  type Castle,
  type Color,
  type Piece,
  type Sq,
  START,
  START_CASTLE,
  allMoves,
  clone,
  isInCheck,
  isWhite,
  legalMoves,
  playMove,
} from './engine'

export type { PlayerInfo, LobbyListing, BoardRoom }

export type ChessNetState = {
  board: Piece[][]
  castle: Castle
  turn: Color
  over: boolean
  /** Result from white's perspective helper for UI */
  result: 'none' | 'white' | 'black' | 'draw'
  statusHost: string
  statusGuest: string
}

export type ChessAction = {
  type: 'move'
  from: Sq
  to: Sq
}

const GAME = 'chess'

function statusFor(color: Color, board: Piece[][], over: boolean, result: ChessNetState['result']): string {
  if (over) {
    if (result === 'draw') return 'Пат. Ничья.'
    if (result === 'white') return color === 'w' ? 'Шах и мат! Победа.' : 'Мат. Поражение.'
    if (result === 'black') return color === 'b' ? 'Шах и мат! Победа.' : 'Мат. Поражение.'
  }
  const side = color === 'w' ? 'белые' : 'чёрные'
  return isInCheck(board, color === 'w') ? `Шах! Ваш ход (${side}).` : `Вы — ${side}. Ваш ход`
}

function waitStatus(color: Color): string {
  return color === 'w' ? 'Ход соперника…' : 'Ход соперника…'
}

function finishTurn(board: Piece[][], castle: Castle, nextTurn: Color): Pick<ChessNetState, 'over' | 'result' | 'statusHost' | 'statusGuest'> {
  const moves = allMoves(board, nextTurn === 'w', castle)
  if (moves.length === 0) {
    const mated = isInCheck(board, nextTurn === 'w')
    if (!mated) {
      return {
        over: true,
        result: 'draw',
        statusHost: 'Пат. Ничья.',
        statusGuest: 'Пат. Ничья.',
      }
    }
    const winner: 'white' | 'black' = nextTurn === 'w' ? 'black' : 'white'
    return {
      over: true,
      result: winner,
      statusHost: statusFor('w', board, true, winner),
      statusGuest: statusFor('b', board, true, winner),
    }
  }
  return {
    over: false,
    result: 'none',
    statusHost: nextTurn === 'w' ? statusFor('w', board, false, 'none') : waitStatus('w'),
    statusGuest: nextTurn === 'b' ? statusFor('b', board, false, 'none') : waitStatus('b'),
  }
}

function applyChessAction(state: ChessNetState, action: ChessAction, by: 'host' | 'guest'): ChessNetState | null {
  if (state.over || action.type !== 'move') return null
  const color: Color = by === 'host' ? 'w' : 'b'
  if (state.turn !== color) return null
  const piece = state.board[action.from.r]?.[action.from.c]
  if (!piece || isWhite(piece) !== (color === 'w')) return null
  const legal = legalMoves(state.board, action.from, state.castle)
  if (!legal.some((m) => m.r === action.to.r && m.c === action.to.c)) return null
  const played = playMove(state.board, action.from, action.to, state.castle)
  const nextTurn: Color = color === 'w' ? 'b' : 'w'
  const fin = finishTurn(played.board, played.castle, nextTurn)
  return {
    board: played.board,
    castle: played.castle,
    turn: nextTurn,
    ...fin,
  }
}

const chessNet: BoardGameNet<ChessNetState, ChessAction> = {
  createInitial: () => ({
    board: clone(START),
    castle: { ...START_CASTLE },
    turn: 'w',
    over: false,
    result: 'none',
    statusHost: 'Вы — белые. Ваш ход',
    statusGuest: 'Вы — чёрные. Ход соперника…',
  }),
  applyAction: applyChessAction,
}

export function watchChessLobby(onChange: (rooms: LobbyListing[]) => void) {
  return watchBoardLobby(GAME, onChange)
}

export function hostChessRoom(you: PlayerInfo, handlers: { onUpdate: (room: BoardRoom<ChessNetState>) => void }) {
  return hostBoardRoom(GAME, you, chessNet, handlers)
}

export function joinChessRoom(
  code: string,
  you: PlayerInfo,
  handlers: { onUpdate: (room: BoardRoom<ChessNetState>) => void },
) {
  return joinBoardRoom<ChessNetState>(GAME, code, you, handlers)
}
