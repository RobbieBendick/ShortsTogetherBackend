import { createServer } from 'http'
import { WebSocketServer, type WebSocket } from 'ws'

type RoomState = {
  id: string
  videoId: string | null
  updatedAt: number
}

type Client = {
  ws: WebSocket
  roomId: string | null
}

type InMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; roomId: string }
  | { type: 'set-video'; videoId: string }
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

function getOrCreate(id: string): RoomState {
  let room = rooms.get(id)
  if (!room) {
    room = { id, videoId: null, updatedAt: Date.now() }
    rooms.set(id, room)
  }
  return room
}

function viewersIn(roomId: string): number {
  let n = 0
  for (const client of clients.values()) {
    if (client.roomId === roomId) n++
  }
  return n
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

function roomPayload(room: RoomState) {
  return {
    type: 'room-state',
    roomId: room.id,
    videoId: room.videoId,
    updatedAt: room.updatedAt,
    viewers: viewersIn(room.id),
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'shortstogether' }))
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  clients.set(ws, { ws, roomId: null })
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
      let id = roomCode()
      while (rooms.has(id)) id = roomCode()
      const room = getOrCreate(id)
      if (client.roomId) {
        const prev = client.roomId
        client.roomId = null
        broadcast(prev, { type: 'viewers', viewers: viewersIn(prev) })
      }
      client.roomId = id
      send(ws, roomPayload(room))
      return
    }

    if (msg.type === 'join-room') {
      const id = msg.roomId?.trim().toLowerCase()
      if (!id) {
        send(ws, { type: 'error', message: 'Missing room code' })
        return
      }
      if (client.roomId && client.roomId !== id) {
        const prev = client.roomId
        client.roomId = null
        broadcast(prev, { type: 'viewers', viewers: viewersIn(prev) })
      }
      const room = getOrCreate(id)
      client.roomId = id
      send(ws, roomPayload(room))
      broadcast(id, { type: 'viewers', viewers: viewersIn(id) }, ws)
      return
    }

    if (msg.type === 'leave-room') {
      if (!client.roomId) return
      const prev = client.roomId
      client.roomId = null
      broadcast(prev, { type: 'viewers', viewers: viewersIn(prev) })
      send(ws, { type: 'left' })
      return
    }

    if (msg.type === 'set-video') {
      if (!client.roomId) return
      const videoId = msg.videoId?.trim()
      if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return

      const room = rooms.get(client.roomId)
      if (!room) return
      if (room.videoId === videoId) return

      room.videoId = videoId
      room.updatedAt = Date.now()
      // Everyone including sender gets confirmation; clients ignore echo by id
      broadcast(client.roomId, roomPayload(room))
    }
  })

  ws.on('close', () => {
    const client = clients.get(ws)
    clients.delete(ws)
    if (client?.roomId) {
      const id = client.roomId
      broadcast(id, { type: 'viewers', viewers: viewersIn(id) })
      if (viewersIn(id) === 0) {
        setTimeout(() => {
          if (viewersIn(id) === 0) rooms.delete(id)
        }, 60_000)
      }
    }
  })
})

const PORT = Number(process.env.PORT) || 3001
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`ShortsTogether sync listening on port ${PORT}`)
})
