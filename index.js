const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "production" 
      ? ["https://tudominio.com"] // Ajusta esto a tu dominio en producción
      : ["http://localhost:4000"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 4000;

app.use(express.static(path.join(__dirname, 'public')));

app.get("/scrape", (req, res) => {
  scrapeLogic(res);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

initializeWhatsApp(io);

httpServer.listen(PORT, () => {
  console.log(`Servidor funcionando en puerto ${PORT}`);
});
