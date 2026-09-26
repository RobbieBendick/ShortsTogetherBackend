import { createServer } from 'http'
import { WebSocketServer, type WebSocket } from 'ws'

type Role = 'watcher' | 'bridge'

type Member = {
  clientId: string
  name: string
  role: Role
}

type RoomState = {
  id: string
  videoId: string | null
  feedOwnerId: string | null
  history: string[]
  updatedAt: number
}

type Client = {
  ws: WebSocket
  roomId: string | null
  clientId: string | null
  name: string
  role: Role
}

type InMessage =
  | { type: 'create-room'; clientId: string; name?: string; role?: Role }
  | { type: 'join-room'; roomId: string; clientId: string; name?: string; role?: Role }
  | { type: 'set-video'; videoId: string }
  | { type: 'set-feed-owner'; clientId: string }
  | { type: 'request-navigate'; direction: 'next' | 'prev' }
  | { type: 'leave-room' }

const rooms = new Map<string, RoomState>()
const clients = new Map<WebSocket, Client>()

function roomCode(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 6; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
}

function cleanName(name: unknown, fallback: string): string {
  const value = typeof name === 'string' ? name.trim().slice(0, 24) : ''
  return value || fallback
}

function cleanRole(role: unknown): Role {
  return role === 'bridge' ? 'bridge' : 'watcher'
}

function getOrCreate(id: string): RoomState {
  let room = rooms.get(id)
  if (!room) {
    room = {
      id,
      videoId: null,
      feedOwnerId: null,
      history: [],
      updatedAt: Date.now(),
    }
    rooms.set(id, room)
  }
  return room
}

function membersIn(roomId: string): Member[] {
  const list: Member[] = []
  const seen = new Set<string>()
  for (const client of clients.values()) {
    if (client.roomId !== roomId || !client.clientId) continue
    const key = `${client.clientId}:${client.role}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ clientId: client.clientId, name: client.name, role: client.role })
  }
  return list
}

function bridgesIn(roomId: string): Member[] {
  return membersIn(roomId).filter((m) => m.role === 'bridge')
}

function findClientsById(roomId: string, clientId: string): WebSocket[] {
  const out: WebSocket[] = []
  for (const [ws, client] of clients) {
    if (client.roomId === roomId && client.clientId === clientId) out.push(ws)
  }
  return out
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function broadcast(roomId: string, payload: unknown, except?: WebSocket) {
  for (const [ws, client] of clients) {
    if (client.roomId === roomId && ws !== except) {
      send(ws, payload)
    }
  }
}

function ensureFeedOwner(room: RoomState) {
  const bridges = bridgesIn(room.id)
  if (bridges.length) {
    if (!room.feedOwnerId || !bridges.some((b) => b.clientId === room.feedOwnerId)) {
      room.feedOwnerId = bridges[0].clientId
    }
    return
  }
  const members = membersIn(room.id)
  if (!members.length) {
    room.feedOwnerId = null
    return
  }
  if (!room.feedOwnerId || !members.some((m) => m.clientId === room.feedOwnerId)) {
    room.feedOwnerId = members[0].clientId
  }
}

function roomPayload(room: RoomState) {
  ensureFeedOwner(room)
  const members = membersIn(room.id)
  return {
    type: 'room-state' as const,
    roomId: room.id,
    videoId: room.videoId,
    feedOwnerId: room.feedOwnerId,
    members,
    bridges: bridgesIn(room.id),
    historyLength: room.history.length,
    updatedAt: room.updatedAt,
    viewers: members.filter((m) => m.role === 'watcher').length || members.length,
  }
}

function leaveRoom(client: Client) {
  if (!client.roomId) return
  const prev = client.roomId
  client.roomId = null
  const room = rooms.get(prev)
  if (room) {
    ensureFeedOwner(room)
    broadcast(prev, roomPayload(room))
    if (membersIn(prev).length === 0) {
      setTimeout(() => {
        if (membersIn(prev).length === 0) rooms.delete(prev)
      }, 60_000)
    }
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify({ ok: true, service: 'shortstogether' }))
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  clients.set(ws, {
    ws,
    roomId: null,
    clientId: null,
    name: 'Friend',
    role: 'watcher',
  })
  send(ws, { type: 'hello' })

  ws.on('message', (raw) => {
    let msg: InMessage
    try {
      msg = JSON.parse(String(raw)) as InMessage
    } catch {
      return
    }

    const client = clients.get(ws)
    if (!client) return

    if (msg.type === 'create-room') {
      const clientId = msg.clientId?.trim()
      if (!clientId) {
        send(ws, { type: 'error', message: 'Missing client id' })
        return
      }
      let id = roomCode()
      while (rooms.has(id)) id = roomCode()
      const room = getOrCreate(id)
      leaveRoom(client)
      client.clientId = clientId
      client.name = cleanName(msg.name, 'Host')
      client.role = cleanRole(msg.role)
      client.roomId = id
      if (client.role === 'bridge') room.feedOwnerId = clientId
      send(ws, roomPayload(room))
      return
    }

    if (msg.type === 'join-room') {
      const id = msg.roomId?.trim().toLowerCase()
      const clientId = msg.clientId?.trim()
      if (!id || !clientId) {
        send(ws, { type: 'error', message: 'Missing room or client id' })
        return
      }
      leaveRoom(client)
      const room = getOrCreate(id)
      client.clientId = clientId
      client.name = cleanName(msg.name, client.role === 'bridge' ? 'YouTube' : 'Friend')
      client.role = cleanRole(msg.role)
      client.roomId = id
      if (client.role === 'bridge' && !room.feedOwnerId) {
        room.feedOwnerId = clientId
      }
      broadcast(id, roomPayload(room))
      return
    }

    if (msg.type === 'leave-room') {
      leaveRoom(client)
      send(ws, { type: 'left' })
      return
    }

    if (msg.type === 'set-feed-owner') {
      if (!client.roomId) return
      const room = rooms.get(client.roomId)
      if (!room) return
      const nextOwner = msg.clientId?.trim()
      const bridges = bridgesIn(room.id)
      const members = membersIn(room.id)
      const allowed = bridges.length ? bridges : members
      if (!nextOwner || !allowed.some((m) => m.clientId === nextOwner)) {
        send(ws, {
          type: 'error',
          message: bridges.length
            ? 'Pick a connected YouTube feed'
            : 'That person is not in the room',
        })
        return
      }
      room.feedOwnerId = nextOwner
      room.updatedAt = Date.now()
      broadcast(client.roomId, roomPayload(room))
      return
    }

    if (msg.type === 'request-navigate') {
      if (!client.roomId) return
      const room = rooms.get(client.roomId)
      if (!room) return
      ensureFeedOwner(room)

      if (msg.direction === 'prev') {
        const prevId = room.history.pop()
        if (!prevId) return
        room.videoId = prevId
        room.updatedAt = Date.now()
        broadcast(client.roomId, roomPayload(room))
        return
      }

      if (!room.feedOwnerId) {
        send(ws, {
          type: 'error',
          message: 'Connect a YouTube feed via the extension first',
        })
        return
      }

      const ownerSockets = findClientsById(client.roomId, room.feedOwnerId)
      const bridgeSockets = ownerSockets.filter((socket) => {
        const c = clients.get(socket)
        return c?.role === 'bridge'
      })
      const targets = bridgeSockets.length ? bridgeSockets : ownerSockets

      if (!targets.length) {
        send(ws, { type: 'error', message: 'Feed owner is offline' })
        return
      }

      for (const target of targets) {
        send(target, {
          type: 'advance',
          direction: 'next',
          requestedBy: client.clientId,
        })
      }
      return
    }

    if (msg.type === 'set-video') {
      if (!client.roomId || !client.clientId) return
      const room = rooms.get(client.roomId)
      if (!room) return
      ensureFeedOwner(room)

      if (room.feedOwnerId && client.clientId !== room.feedOwnerId) {
        return
      }

      const videoId = msg.videoId?.trim()
      if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return
      if (room.videoId === videoId) return

      if (room.videoId) {
        room.history.push(room.videoId)
        if (room.history.length > 50) room.history.shift()
      }
      room.videoId = videoId
      room.updatedAt = Date.now()
      broadcast(client.roomId, roomPayload(room))
    }
  })

  ws.on('close', () => {
    const client = clients.get(ws)
    clients.delete(ws)
    if (client) leaveRoom(client)
  })
})

const PORT = Number(process.env.PORT) || 3001
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`ShortsTogether sync listening on port ${PORT}`)
})
