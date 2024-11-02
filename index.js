const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
const { conectarDB } = require('./config/database');
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "production" 
      ? ["https://testpuppeteer-1d96.onrender.com/"] 
      : ["http://localhost:4000"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 4000;

conectarDB()
  .then(() => {
    // Solo iniciamos el servidor HTTP si la conexión a MongoDB fue exitosa
    httpServer.listen(PORT, () => {
      console.log(`Servidor funcionando en puerto ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1); // Terminamos el proceso si no podemos conectar a MongoDB
  });

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