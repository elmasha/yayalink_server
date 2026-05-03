const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // lock this later
    methods: ["GET", "POST"],
  },
});

/* 🔌 Socket connection */
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("join", (uid) => {
    if (!uid) return;
    socket.join(uid);
    console.log(`👤 User ${uid} joined their room`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

/* Make io global */
global.io = io;

module.exports = server;
