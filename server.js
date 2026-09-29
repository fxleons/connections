const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store all active players on the server
const players = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // 1. Initialize player state
  players[socket.id] = {
    id: socket.id,
    x: 0,
    y: 1,
    z: 0,
    rotation: 0
  };

  // 2. Send current players list to the newly connected player
  socket.emit('currentPlayers', players);

  // 3. Inform all other connected clients about the new player
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // 4. Listen for position updates from this client
  socket.on('playerUpdate', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rotation = data.rotation;

      // Broadcast the movement to everyone else
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: data.x,
        y: data.y,
        z: data.z,
        rotation: data.rotation
      });
    }
  });

  // 5. Handle chat messages
  socket.on('chatMessage', (msg) => {
    io.emit('chatMessage', {
      id: socket.id,
      text: msg
    });
  });

  // 6. Handle player disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
