const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
const path = require("path");

const PORT = process.env.PORT || 4000;
const MONGO_DB_URI = process.env.MONGO_DB_URI;

// Función para conectar a MongoDB
const conectarDB = async () => {
  try {
    if (!MONGO_DB_URI) {
      throw new Error('La variable de entorno MONGO_DB_URI no está definida');
    }

    await mongoose.connect(MONGO_DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Conexión exitosa a MongoDB");
  } catch (error) {
    console.error("=== Error de Conexión ===");
    console.error("Tipo:", error.name);
    console.error("Mensaje:", error.message);
    process.exit(1);
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

// Función principal para inicializar el servidor
const iniciar = async () => {
  try {
    await conectarDB();
    console.log("Base de datos conectada");

    initializeWhatsApp(io);

    httpServer.listen(PORT, () => {
      console.log(`Servidor funcionando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

iniciar();