const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { scrapeLogic } = require("./scrapeLogic");
const { initializeWhatsApp } = require("./whatsappLogic");
const { auth } = require('express-openid-connect');
const path = require("path");
const cors = require('cors');
require('dotenv').config();

// Inicialización de la aplicación Express y el servidor HTTP
const app = express();
const httpServer = createServer(app);

// Configuración de middleware básico
app.use(express.json());
app.use(cors());

// Configuración de autenticación con Auth0
const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.BASE_URL || 'http://localhost:4000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`
};

// Aplica el middleware de autenticación de Auth0
app.use(auth(config));

// Middleware personalizado para verificar autenticación
const requiresAuth = (req, res, next) => {
    if (!req.oidc.isAuthenticated()) {
        return res.sendFile(path.join(__dirname, 'public', 'unauthorized.html'));
    }
    next();
};

// Ruta públicas (sin autenticación requerida)
app.get('/unauthorized.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'unauthorized.html'));
});

// Ruta principal - protegida con autenticación
app.get("/", requiresAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Archivos estáticos para rutas autenticadas
app.use(requiresAuth, express.static(path.join(__dirname, 'public')));

// Rutas API protegidas
app.get("/api/scrape", requiresAuth, (req, res) => {
    scrapeLogic(res);
});

// Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "production" 
            ? ["https://testpuppeteer-1d96.onrender.com/"] 
            : ["http://localhost:4000"],
        methods: ["GET", "POST"]
    }
});

// Manejo de conexiones Socket.IO
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Inicializar WhatsApp
initializeWhatsApp(io);

// Iniciar servidor
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
    console.log(`Servidor funcionando en puerto ${PORT}`);
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal!');
});