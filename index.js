const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
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
const MONGO_DB_URI = process.env.MONGO_DB_URI;

// Función para conectar a MongoDB
const conectarDB = async () => {
  try {
    if (!MONGO_DB_URI) {
      throw new Error('La variable de entorno MONGO_DB_URI no está definida');
    }

    console.log('Intentando conectar a MongoDB Atlas...');
    
    await mongoose.connect(MONGO_DB_URI, {
      retryWrites: true,
      w: "majority",
      serverSelectionTimeoutMS: 60000,
      connectTimeoutMS: 60000,
      socketTimeoutMS: 60000
    });

    console.log('Conexión exitosa a MongoDB Atlas');

  } catch (error) {
    console.error("=== Error de Conexión ===");
    console.error("Tipo:", error.name);
    console.error("Mensaje:", error.message);
    throw error;
  }
};

app.use(express.static(path.join(__dirname, 'public')));

app.get("/scrape", (req, res) => {
  scrapeLogic(res);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

const iniciar = async () => {
  try {
    await conectarDB();
    console.log("Base de datos conectada");

    initializeWhatsApp(io);

    httpServer.listen(PORT, () => {
      console.log(`Servidor funcionando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("Error fatal al iniciar el servidor:", error);
    // En caso de error de conexión, esperamos 10 segundos y reintentamos
    if (error.name === 'MongooseServerSelectionError') {
      console.log('Reintentando conexión en 10 segundos...');
      setTimeout(iniciar, 10000);
    } else {
      process.exit(1);
    }
  }
};

iniciar();