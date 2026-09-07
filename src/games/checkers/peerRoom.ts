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
  type Cell,
  type Sq,
  type Step,
  applyMove,
  allSideMoves,
  captureMoves,
  clone,
  isB,
  isW,
  same,
  startBoard,
} from './engine'

export type { PlayerInfo, LobbyListing, BoardRoom }

export type CheckersNetState = {
  board: Cell[][]
  turn: 'w' | 'b'
  chainFrom: Sq | null
  over: boolean
  result: 'none' | 'white' | 'black'
  statusHost: string
  statusGuest: string
  /** Last applied step for optional animation on clients */
  lastStep: Step | null
}

export type CheckersAction = {
  type: 'step'
  from: Sq
  to: Sq
  mid?: Sq
}

const GAME = 'checkers'

function sideStatus(white: boolean, board: Cell[][], chain: Sq | null): string {
  const you = white ? 'белые' : 'чёрные'
  if (chain) return 'Продолжайте бить этой шашкой'
  const moves = allSideMoves(board, white)
  if (moves.some((m) => m.mid)) return `Ваш ход · нужно бить`
  return `Вы — ${you}. Ваш ход`
}

function applyCheckersAction(
  state: CheckersNetState,
  action: CheckersAction,
  by: 'host' | 'guest',
): CheckersNetState | null {
  if (state.over || action.type !== 'step') return null
  const white = by === 'host'
  const turnWhite = state.turn === 'w'
  if (white !== turnWhite) return null

  const piece = state.board[action.from.r]?.[action.from.c]
  if (!piece) return null
  if (white ? !isW(piece) : !isB(piece)) return null

  if (state.chainFrom && !same(state.chainFrom, action.from)) return null

  const legal = state.chainFrom
    ? captureMoves(state.board, state.chainFrom)
    : allSideMoves(state.board, white)
  const match = legal.find(
    (m) =>
      m.from.r === action.from.r &&
      m.from.c === action.from.c &&
      m.to.r === action.to.r &&
      m.to.c === action.to.c &&
      (!!m.mid === !!action.mid) &&
      (!m.mid || (m.mid.r === action.mid!.r && m.mid.c === action.mid!.c)),
  )
  if (!match) return null

  const after = applyMove(state.board, match)
  let chainFrom: Sq | null = null
  let turn = state.turn
  let statusHost = state.statusHost
  let statusGuest = state.statusGuest
  let over = false
  let result: CheckersNetState['result'] = 'none'

  if (match.mid) {
    const more = captureMoves(after, match.to)
    if (more.length) {
      chainFrom = match.to
      statusHost = white ? sideStatus(true, after, chainFrom) : 'Ход соперника…'
      statusGuest = !white ? sideStatus(false, after, chainFrom) : 'Ход соперника…'
      return {
        board: after,
        turn,
        chainFrom,
        over,
        result,
        statusHost,
        statusGuest,
        lastStep: match,
      }
    }
  }

  // Turn passes
  turn = white ? 'b' : 'w'
  chainFrom = null
  const oppMoves = allSideMoves(after, !white)
  if (!oppMoves.length) {
    over = true
    result = white ? 'white' : 'black'
    statusHost = white ? 'Победа!' : 'Поражение'
    statusGuest = white ? 'Поражение' : 'Победа!'
  } else {
    statusHost = turn === 'w' ? sideStatus(true, after, null) : 'Ход соперника…'
    statusGuest = turn === 'b' ? sideStatus(false, after, null) : 'Ход соперника…'
  }

  return {
    board: after,
    turn,
    chainFrom,
    over,
    result,
    statusHost,
    statusGuest,
    lastStep: match,
  }
}

const checkersNet: BoardGameNet<CheckersNetState, CheckersAction> = {
  createInitial: () => ({
    board: clone(startBoard()),
    turn: 'w',
    chainFrom: null,
    over: false,
    result: 'none',
    statusHost: 'Вы — белые. Ваш ход',
    statusGuest: 'Вы — чёрные. Ход соперника…',
    lastStep: null,
  }),
  applyAction: applyCheckersAction,
}

export function watchCheckersLobby(onChange: (rooms: LobbyListing[]) => void) {
  return watchBoardLobby(GAME, onChange)
}

export function hostCheckersRoom(
  you: PlayerInfo,
  handlers: { onUpdate: (room: BoardRoom<CheckersNetState>) => void },
) {
  return hostBoardRoom(GAME, you, checkersNet, handlers)
}

export function joinCheckersRoom(
  code: string,
  you: PlayerInfo,
  handlers: { onUpdate: (room: BoardRoom<CheckersNetState>) => void },
) {
  return joinBoardRoom<CheckersNetState>(GAME, code, you, handlers)
}
