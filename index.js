const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
const path = require("path");

const app = express(); 
const httpServer = createServer(app);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor HTTP corriendo en puerto ${PORT}`);
});

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === "production" 
      ? ["https://testpuppeteer-1d96.onrender.com"] 
      : ["http://localhost:4000"],
    methods: ["GET", "POST"]
  }
});

const MONGO_DB_URI = process.env.MONGO_DB_URI;

const conectarDB = async () => {
  try {
    if (!MONGO_DB_URI) {
      throw new Error('La variable de entorno MONGO_DB_URI no está definida');
    }

    console.log('Intentando conectar a MongoDB Atlas...');
    
    await mongoose.connect(MONGO_DB_URI, {
      serverSelectionTimeoutMS: 50000,
      socketTimeoutMS: 45000,
      directConnection: false,
      retryWrites: true,
      w: 'majority',
      replicaSet: 'atlas-tepky3-shard-0',
      authSource: 'admin'
    });

    console.log('Conexión exitosa a MongoDB Atlas');
    
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB desconectado - Intentando reconectar...');
      setTimeout(conectarDB, 5000);
    });

  } catch (error) {
    console.error("=== Error de Conexión ===");
    console.error("Tipo:", error.name);
    console.error("Mensaje:", error.message);
    if (error.name === 'MongooseServerSelectionError') {
      console.log('Error de selección de servidor - reintentando en 5 segundos...');
      setTimeout(conectarDB, 5000);
    }
    throw error;
  }
};

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get("/scrape", (req, res) => {
  scrapeLogic(res);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: 'OK', mongoConnection: mongoose.connection.readyState });
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
    await initializeWhatsApp(io);
    
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    if (error.name === 'MongooseServerSelectionError') {
      console.log('Reintentando conexión en 10 segundos...');
      setTimeout(iniciar, 10000);
    }
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

iniciar();