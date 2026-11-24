// npm init -y
// npm i socket.io
const express = require("express");
const http = require("http");
const path = require("path");

const { Server } = require("socket.io");

const app = express();
const httpserver = http.createServer(app);

// Serve client.html at root so users can open http://localhost:8080 directly
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

const io = new Server(httpserver, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// In-memory store for rooms & connected users
// rooms: Map<roomId, { id, name, isPrivate, createdBy, createdAt, members: Map<socketId, { id, name, color }> }>
const rooms = new Map();
rooms.set("global", {
  id: "global",
  name: "Global Lounge",
  isPrivate: false,
  createdBy: "System",
  createdAt: Date.now(),
  members: new Map(),
});

function getPublicRoomsSummary() {
  const list = [];
  for (const room of rooms.values()) {
    if (!room.isPrivate) {
      list.push({
        id: room.id,
        name: room.name,
        isPrivate: room.isPrivate,
        createdBy: room.createdBy,
        memberCount: room.members.size,
      });
    }
  }
  return list;
}

function broadcastRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("roomUsers", {
    roomId,
    users: Array.from(room.members.values()),
  });
}

function leaveCurrentRoom(socket) {
  const currentRoomId = socket.data.currentRoom;
  if (!currentRoomId) return;

  const room = rooms.get(currentRoomId);
  if (room) {
    room.members.delete(socket.id);
    socket.leave(currentRoomId);

    socket.to(currentRoomId).emit("roomSystemMessage", {
      roomId: currentRoomId,
      text: `${socket.data.username || "A user"} left the room.`,
      timestamp: Date.now(),
    });

    broadcastRoomUsers(currentRoomId);

    // Clean up empty custom rooms (keep "global")
    if (currentRoomId !== "global" && room.members.size === 0) {
      rooms.delete(currentRoomId);
    }
  }
  socket.data.currentRoom = null;
  io.emit("roomList", getPublicRoomsSummary());
}

let count = 0;
io.on("connection", (socket) => {
  count++;
  console.log("Active user: ", count);

  // Default user metadata
  socket.data.username = `User-${socket.id.slice(0, 4)}`;
  socket.data.color = "#6366f1";
  socket.data.currentRoom = null;

  // --- Existing Backend Events (Preserved) ---
  // Sending
  socket.emit("gyankibaat", "welcome to socket.io server");

  socket.broadcast.emit("join", "New User Joined");

  // Reading
  socket.on("kuchbhi", (msg) => {
    console.log(msg);
  });

  io.emit("announcement", "Today is last time we study web dev -3");
  // --- End Existing Backend Events ---

  // Broadcast live active user count & public rooms
  io.emit("userCount", count);
  socket.emit("roomList", getPublicRoomsSummary());

  // Set user profile (name & avatar color)
  socket.on("setProfile", ({ username, color }) => {
    const cleanName = (username || "").trim().slice(0, 24);
    if (cleanName) socket.data.username = cleanName;
    if (color) socket.data.color = color;

    // Update member record if inside a room
    const roomId = socket.data.currentRoom;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.members.has(socket.id)) {
        room.members.set(socket.id, {
          id: socket.id,
          name: socket.data.username,
          color: socket.data.color,
        });
        broadcastRoomUsers(roomId);
      }
    }
  });

  // Create a new personal or public room
  socket.on("createRoom", ({ roomName, isPrivate, customId }, callback) => {
    const cleanName = (roomName || "").trim().slice(0, 32);
    if (!cleanName) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Room name is required." });
      }
      return;
    }

    let roomId = (customId || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (!roomId) {
      roomId = "RM-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    }

    if (rooms.has(roomId)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: `Room ID "${roomId}" already exists.` });
      }
      return;
    }

    rooms.set(roomId, {
      id: roomId,
      name: cleanName,
      isPrivate: Boolean(isPrivate),
      createdBy: socket.data.username,
      createdAt: Date.now(),
      members: new Map(),
    });

    io.emit("roomList", getPublicRoomsSummary());

    if (typeof callback === "function") {
      callback({
        ok: true,
        room: {
          id: roomId,
          name: cleanName,
          isPrivate: Boolean(isPrivate),
          createdBy: socket.data.username,
        },
      });
    }
  });

  // Join a room by ID
  socket.on("joinRoom", ({ roomId }, callback) => {
    const targetId = (roomId || "").trim();
    const room = rooms.get(targetId) || rooms.get(targetId.toUpperCase());

    if (!room) {
      if (typeof callback === "function") {
        callback({ ok: false, error: `Room "${targetId}" not found.` });
      }
      return;
    }

    if (socket.data.currentRoom === room.id) {
      if (typeof callback === "function") {
        callback({
          ok: true,
          room: { id: room.id, name: room.name, isPrivate: room.isPrivate },
        });
      }
      return;
    }

    leaveCurrentRoom(socket);

    socket.join(room.id);
    socket.data.currentRoom = room.id;
    room.members.set(socket.id, {
      id: socket.id,
      name: socket.data.username,
      color: socket.data.color,
    });

    socket.to(room.id).emit("roomSystemMessage", {
      roomId: room.id,
      text: `${socket.data.username} joined the room.`,
      timestamp: Date.now(),
    });

    broadcastRoomUsers(room.id);
    io.emit("roomList", getPublicRoomsSummary());

    if (typeof callback === "function") {
      callback({
        ok: true,
        room: {
          id: room.id,
          name: room.name,
          isPrivate: room.isPrivate,
          createdBy: room.createdBy,
        },
      });
    }
  });

  // Send a chat message to the current room
  socket.on("roomMessage", ({ text }) => {
    const cleanText = (text || "").trim();
    const roomId = socket.data.currentRoom;
    if (!cleanText || !roomId || !rooms.has(roomId)) return;

    io.to(roomId).emit("roomMessage", {
      id: `${socket.id}-${Date.now()}`,
      roomId,
      senderId: socket.id,
      senderName: socket.data.username,
      senderColor: socket.data.color,
      text: cleanText,
      timestamp: Date.now(),
    });
  });

  // Typing indicators scoped to current room
  socket.on("typing", () => {
    const roomId = socket.data.currentRoom;
    if (!roomId) return;
    socket.to(roomId).emit("userTyping", {
      userId: socket.id,
      username: socket.data.username,
    });
  });

  socket.on("stopTyping", () => {
    const roomId = socket.data.currentRoom;
    if (!roomId) return;
    socket.to(roomId).emit("userStopTyping", {
      userId: socket.id,
    });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
    count--;
    console.log("Active user: ", count);
    io.emit("userCount", count);
  });
});

httpserver.listen(8080, () => {
  console.log("Server started");
});
