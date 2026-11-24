// The game server never mounts Express routes; ws-transport only calls express() for an Express app the server lacks.
export default function express() { throw new Error('Express is not part of the game server bundle'); }
