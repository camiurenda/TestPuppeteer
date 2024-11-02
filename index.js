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

let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000;

const conectarDB = async () => {
  // Evitar múltiples intentos simultáneos
  if (isConnecting) {
    console.log('Ya hay un intento de conexión en curso...');
    return;
  }

  isConnecting = true;
  connectionAttempts++;

  try {
    const MONGO_DB_URI = process.env.MONGO_DB_URI;
    if (!MONGO_DB_URI) {
      throw new Error('La variable de entorno MONGO_DB_URI no está definida');
    }

    console.log(`Intento de conexión ${connectionAttempts}/${MAX_RETRIES} a MongoDB Atlas...`);

    mongoose.connection.removeAllListeners('disconnected');
    
    await mongoose.connect(MONGO_DB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
      bufferCommands: false,
    });

    console.log('Conexión exitosa a MongoDB Atlas');
    connectionAttempts = 0;
    isConnecting = false;

    mongoose.connection.once('disconnected', () => {
      console.log('MongoDB desconectado');
      if (connectionAttempts < MAX_RETRIES) {
        console.log(`Intentando reconectar en ${RETRY_INTERVAL/1000} segundos...`);
        setTimeout(conectarDB, RETRY_INTERVAL);
      } else {
        console.error('Se alcanzó el número máximo de intentos de reconexión');
        process.exit(1);
      }
    });

    return true;

  } catch (error) {
    console.error("=== Error de Conexión ===");
    console.error("Tipo:", error.name);
    console.error("Mensaje:", error.message);

    isConnecting = false;

    if (connectionAttempts < MAX_RETRIES) {
      console.log(`Reintentando en ${RETRY_INTERVAL/1000} segundos...`);
      setTimeout(conectarDB, RETRY_INTERVAL);
    } else {
      console.error('Se alcanzó el número máximo de intentos');
      throw error;
    }
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
  res.status(200).json({ 
    status: 'OK', 
    mongoConnection: mongoose.connection.readyState,
    connectionAttempts 
  });
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});


const iniciar = async () => {
  try {
    const connected = await conectarDB();
    if (connected) {
      console.log("Base de datos conectada");
      await initializeWhatsApp(io);
    }
  } catch (error) {
    console.error("Error fatal al iniciar el servidor:", error);
    process.exit(1);
  }
};


process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (error.name === 'MongooseServerSelectionError') {
    process.exit(1);
  }
});


iniciar();