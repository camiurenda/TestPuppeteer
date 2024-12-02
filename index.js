const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { scrapeLogic } = require("./scrapeLogic");
const schedulerLogic = require('./services/scheduleLogic.service');
const { initializeWhatsApp } = require("./whatsappLogic");
const { auth } = require('express-openid-connect');
const path = require("path");
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

// Configuración básica
app.use(express.json());

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'https://filmfetcher.onrender.com',
    'https://film-fetcher-eta.vercel.app',
    'https://film-fetcher-exc9.vercel.app',
    'https://testpuppeteer-1d96.onrender.com'
];

// CORS configuración más permisiva para rutas públicas
app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Si es una ruta de API, aplicar restricciones de CORS
    if (req.path.startsWith('/api')) {
        if (origin && allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, X-Source');
            res.header('Access-Control-Allow-Credentials', 'true');
        }
        // Si es OPTIONS, responder inmediatamente
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }
    } else {
        // Para rutas no-API, ser más permisivo
        res.header('Access-Control-Allow-Origin', '*');
    }
    next();
});

// Configuración Auth0
const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.BASE_URL || 'http://localhost:4000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`
};

// Auth middleware
app.use(auth(config));

// Middleware para verificar autenticación
const requiresAuth = (req, res, next) => {
    if (!req.oidc.isAuthenticated()) {
        return res.sendFile(path.join(__dirname, 'public', 'unauthorized.html'));
    }
    next();
};

// Health check endpoint (sin restricciones)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ruta de callback de Auth0
app.get('/callback', (req, res) => {
    console.log('Callback de Auth0 recibido');
});

// Servir unauthorized.html sin autenticación
app.get('/unauthorized.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'unauthorized.html'));
});

// Ruta principal - protegida
app.get("/", requiresAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Archivos estáticos para rutas autenticadas
app.use(requiresAuth, express.static(path.join(__dirname, 'public')));

// Ruta de scraping con verificación de autenticación o fuente
app.post("/api/scrape", async (req, res) => {
    try {
        // Si la petición está autenticada, permitirla
        if (req.oidc.isAuthenticated()) {
            await scrapeLogic(req, res);
            return;
        }

        // Validar origen
        const origin = req.get('origin');
        if (origin && !allowedOrigins.includes(origin)) {
            return res.status(403).json({
                success: false,
                error: "Origen no autorizado",
                status: 'error'
            });
        }

        // Validar fuente
        const source = req.get('X-Source');
        if (!source || source !== 'FilmFetcher') {
            return res.status(403).json({
                success: false,
                error: "Fuente no autorizada",
                status: 'error'
            });
        }

        await scrapeLogic(req, res);
    } catch (error) {
        console.error('Error en scraping:', error);
        res.status(500).json({
            success: false,
            error: "Error interno del servidor",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            status: 'error'
        });
    }
});

// Nuevos endpoints de Scheduling
app.post('/api/schedule', express.json(), async (req, res) => {
    try {
        const scheduleConfig = req.body;
        console.log(`[Schedule] Agregando nuevo schedule para ${scheduleConfig.url}`);
        
        if (!scheduleConfig.id || !scheduleConfig.url || !scheduleConfig.proximaEjecucion) {
            return res.status(400).json({
                success: false,
                error: "Configuración incompleta",
                status: 'error'
            });
        }

        const result = schedulerLogic.agregarSchedule(scheduleConfig);
        res.json(result);

    } catch (error) {
        console.error('[Schedule] Error al agregar schedule:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            status: 'error'
        });
    }
});

app.delete('/api/schedule/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[Schedule] Cancelando schedule ${id}`);
        
        const result = schedulerLogic.cancelarSchedule(id);
        res.json(result);

    } catch (error) {
        console.error('[Schedule] Error al cancelar schedule:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            status: 'error'
        });
    }
});

app.get('/api/schedule/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[Schedule] Consultando estado de schedule ${id}`);
        
        const result = schedulerLogic.obtenerEstado(id);
        res.json(result);

    } catch (error) {
        console.error('[Schedule] Error al obtener estado:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            status: 'error'
        });
    }
});

app.get('/api/schedules', async (req, res) => {
    try {
        console.log('[Schedule] Consultando todos los schedules');
        const result = schedulerLogic.obtenerTodos();
        res.json(result);

    } catch (error) {
        console.error('[Schedule] Error al obtener schedules:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            status: 'error'
        });
    }
});

// Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "production" 
            ? ["https://testpuppeteer-1d96.onrender.com"] 
            : ["http://localhost:4000"],
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Inicializar WhatsApp
initializeWhatsApp(io);

// Error handler global
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err.stack);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({
        success: false,
        error: "Error interno del servidor",
        status: 'error'
    });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
    console.log(`Servidor de scraping funcionando en puerto ${PORT}`);
});

module.exports = app;