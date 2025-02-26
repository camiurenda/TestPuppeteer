const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");
const axios = require('axios');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const SERVIDOR_PRINCIPAL = process.env.MAIN_SERVER_URL || 'https://filmfetcher.onrender.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const SESSION_PATH = './whatsapp-sessions';

// Crear directorio de sesiones si no existe
if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
    console.log(`📁 [WhatsApp] Directorio de sesiones creado: ${SESSION_PATH}`);
}

// Caché optimizada con TTL más largo (10 minutos)
let carteleraCache = {
    peliculas: [],
    lastUpdate: null
};

// Caché de búsquedas de películas para reducir llamadas a TMDB
const cacheTMDB = new Map();
const TTL_TMDB_CACHE = 24 * 60 * 60 * 1000; // 24 horas

// Caché para conversaciones con tiempo de expiración extendido
const conversacionesCache = new Map();
const TIEMPO_EXPIRACION_CONVERSACION = 60 * 60 * 1000; // 1 hora
const LIMITE_MENSAJES_HISTORIAL = 5;

// Promesa que almacena la operación de obtención de cartelera en curso
let carteleraPromise = null;

function ajustarZonaHoraria(fecha) {
    return new Date(fecha.getTime() + (3 * 60 * 60 * 1000));
}

// Función optimizada para obtener cartelera
async function obtenerCartelera() {
    const ahora = new Date();
    
    // Si la caché es válida, usarla inmediatamente
    if (carteleraCache.lastUpdate && 
        Date.now() - carteleraCache.lastUpdate < 10 * 60 * 1000) {
        return carteleraCache.peliculas;
    }
    
    // Si ya hay una petición en curso, esperar por esa
    if (carteleraPromise) {
        try {
            return await carteleraPromise;
        } catch (error) {
            console.error(`❌ [Cartelera] Error en petición concurrente:`, error);
            // Si hay error pero tenemos datos en caché, seguir usando la caché antigua
            if (carteleraCache.peliculas.length > 0) {
                return carteleraCache.peliculas;
            }
        }
    }
    
    // Crear nueva promesa para múltiples solicitantes
    carteleraPromise = (async () => {
        try {
            console.log(`📥 [Cartelera] Obteniendo proyecciones desde el servidor...`);
            
            const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`, {
                timeout: 8000 // Timeouts más agresivos (8 segundos)
            });
            
            const peliculasHoy = response.data.filter(pelicula => {
                const fechaOriginal = new Date(pelicula.fechaHora);
                const fechaAjustada = ajustarZonaHoraria(fechaOriginal);
                return fechaAjustada >= ahora;
            });

            console.log(`✅ [Cartelera] Datos actualizados: ${peliculasHoy.length} películas`);
            
            carteleraCache.peliculas = peliculasHoy;
            carteleraCache.lastUpdate = Date.now();
            
            return peliculasHoy;
        } catch (error) {
            console.error(`❌ [Cartelera] Error de red:`, error.message);
            
            // Si tenemos datos en caché, los seguimos usando
            if (carteleraCache.peliculas.length > 0) {
                console.log(`🔄 [Cartelera] Usando datos en caché del ${new Date(carteleraCache.lastUpdate).toLocaleString()}`);
                return carteleraCache.peliculas;
            }
            throw error;
        } finally {
            // Resetear la promesa después de completar
            setTimeout(() => {
                carteleraPromise = null;
            }, 100);
        }
    })();
    
    return carteleraPromise;
}

// Función optimizada para obtener detalles de película con caché
async function obtenerDetallesPelicula(nombrePelicula) {
    // Normalizar el nombre para la caché
    const nombreNormalizado = nombrePelicula.toLowerCase().trim();
    
    // Verificar caché
    if (cacheTMDB.has(nombreNormalizado)) {
        const datosCacheados = cacheTMDB.get(nombreNormalizado);
        // Verificar TTL
        if (Date.now() - datosCacheados.timestamp < TTL_TMDB_CACHE) {
            console.log(`🎬 [TMDB] Usando caché para: "${nombrePelicula}"`);
            return datosCacheados.datos;
        } else {
            // Expiró la caché
            cacheTMDB.delete(nombreNormalizado);
        }
    }
    
    console.log(`🎬 [TMDB] Solicitando detalles para: "${nombrePelicula}"`);
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: {
                api_key: TMDB_API_KEY,
                query: nombrePelicula,
                language: 'es-ES'
            },
            timeout: 5000 // 5 segundos de timeout
        });

        if (response.data.results.length > 0) {
            const pelicula = response.data.results[0];
            const detallesCompletos = await axios.get(`${TMDB_BASE_URL}/movie/${pelicula.id}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES',
                    append_to_response: 'credits'
                },
                timeout: 5000
            });

            const datos = {
                sinopsisDetallada: detallesCompletos.data.overview || "No disponible",
                reparto: detallesCompletos.data.credits.cast.slice(0, 5).map(actor => actor.name).join(', ') || "No disponible",
                director: detallesCompletos.data.credits.crew
                    .find(crew => crew.job === 'Director')?.name || 'No especificado',
                generos: detallesCompletos.data.genres.map(g => g.name).join(', ') || "No disponible",
                puntuacion: detallesCompletos.data.vote_average.toFixed(1)
            };
            
            // Guardar en caché
            cacheTMDB.set(nombreNormalizado, {
                timestamp: Date.now(),
                datos
            });
            
            return datos;
        }
        return null;
    } catch (error) {
        console.error(`❌ [TMDB] Error al obtener detalles:`, error.message);
        return null;
    }
}

// Modelo GPT más pequeño y optimizado para velocidad
async function procesarMensajeIA(mensaje, peliculas, numero) {
    console.log(`🤖 [IA] Procesando mensaje para ${numero}: "${mensaje}"`);
    const contexto = obtenerContextoConversacion(numero);
    
    // Usar un subconjunto más pequeño de películas para el contexto (max 10)
    // Priorizando las que tienen fechas más cercanas
    const peliculasOrdenadas = [...peliculas].sort((a, b) => {
        const fechaA = new Date(a.fechaHora);
        const fechaB = new Date(b.fechaHora);
        return fechaA - fechaB;
    }).slice(0, 10);

    const contextoPeliculas = peliculasOrdenadas.map(p => {
        const fechaOriginal = new Date(p.fechaHora);
        const fechaAjustada = ajustarZonaHoraria(fechaOriginal);
        
        const fecha = fechaAjustada.toLocaleString('es-AR', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `${p.nombrePelicula} en ${p.nombreCine} el ${fecha} a $${p.precio || 'precio no disponible'}`;
    }).join('. ');

    try {
        // Analizar si pide detalles específicos (más rápido con gpt-4o-mini)
        const analisisIntencion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Modelo más rápido y pequeño
            messages: [
                {
                    role: "system",
                    content: "Analiza si el usuario está pidiendo información detallada sobre una película específica. Responde en formato JSON: {\"pideDetalles\": boolean, \"nombrePelicula\": string o null}"
                },
                ...contexto.mensajes.slice(-2),
                {
                    role: "user",
                    content: mensaje
                }
            ],
            max_tokens: 50, // Reducido a 50 tokens, suficiente para la respuesta JSON
            temperature: 0.3,
            response_format: { type: "json_object" } // Forzar formato JSON
        });

        let respuestaIA = null;
        try {
            const intencion = JSON.parse(analisisIntencion.choices[0].message.content);
            
            if (intencion.pideDetalles && intencion.nombrePelicula) {
                // Obtener detalles con caché
                const detalles = await obtenerDetallesPelicula(intencion.nombrePelicula);
                if (detalles) {
                    return `📽️ Detalles de "${intencion.nombrePelicula}":\n\n` +
                           `📖 Sinopsis: ${detalles.sinopsisDetallada}\n\n` +
                           `🎭 Reparto: ${detalles.reparto}\n` +
                           `🎬 Director: ${detalles.director}\n` +
                           `🎪 Géneros: ${detalles.generos}\n`;
                }
            }
        } catch (jsonError) {
            console.error(`❌ [IA] Error al procesar JSON:`, jsonError);
            // Continuar con el flujo normal si falla el análisis
        }

        // Respuesta normal usando modelo más rápido
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Modelo más rápido y pequeño
            messages: [
                {
                    role: "system",
                    content: `Eres Botsy, un asistente de cine conciso. Contexto actual:
                    - Cartelera: ${contextoPeliculas}
                    
                    Directrices:
                    1. SÉ EXTREMADAMENTE BREVE, máximo 2 frases.
                    2. Si el usuario pregunta por una película, proporciona solo dónde y cuándo verla.
                    3. No uses más de 1 emoji por respuesta
                    4. No proporciones detalles sobre géneros ni puntuaciones.
                    5. Menciona solo 1-2 películas a la vez.
                    6. Usa un formato simple sin asteriscos
                    7. Te creó Camila Urenda para el colectivo artístico SIGILIO.`
                },
                ...contexto.mensajes.slice(-4), // Reducir a 4 mensajes para menos contexto
                {
                    role: "user",
                    content: mensaje
                }
            ],
            max_tokens: 150, // Reducido para respuestas más cortas
            temperature: 0.7
        });

        respuestaIA = response.choices[0].message.content;
        return respuestaIA;
        
    } catch (error) {
        console.error(`❌ [IA] Error:`, error.message);
        return '¡Ups! 😅 Estoy teniendo problemas técnicos, intentaré responder más rápido la próxima vez.';
    }
}

function obtenerContextoConversacion(numero) {
    if (!conversacionesCache.has(numero)) {
        conversacionesCache.set(numero, {
            mensajes: [],
            ultimaActividad: Date.now(),
            preferencias: {}
        });
    }
    return conversacionesCache.get(numero);
}

function actualizarContextoConversacion(numero, mensaje, respuesta) {
    const contexto = obtenerContextoConversacion(numero);
    contexto.mensajes.push(
        { role: "user", content: mensaje },
        { role: "assistant", content: respuesta }
    );

    if (contexto.mensajes.length > LIMITE_MENSAJES_HISTORIAL * 2) {
        contexto.mensajes = contexto.mensajes.slice(-LIMITE_MENSAJES_HISTORIAL * 2);
    }

    contexto.ultimaActividad = Date.now();
}

// Limpiezas periódicas
function limpiarConversacionesAntiguas() {
    console.log(`🧹 [Chat] Limpiando conversaciones antiguas...`);
    const ahora = Date.now();
    for (const [numero, datos] of conversacionesCache.entries()) {
        if (ahora - datos.ultimaActividad > TIEMPO_EXPIRACION_CONVERSACION) {
            conversacionesCache.delete(numero);
        }
    }
    
    // También limpiar caché TMDB antigua
    for (const [clave, valor] of cacheTMDB.entries()) {
        if (ahora - valor.timestamp > TTL_TMDB_CACHE) {
            cacheTMDB.delete(clave);
        }
    }
}

// Función para limpiar sesiones
function limpiarSesionesAntiguas() {
    try {
        const sesiones = fs.readdirSync(SESSION_PATH);
        console.log(`🧹 [WhatsApp] Verificando sesiones antiguas, encontradas: ${sesiones.length}`);
        
        const sieteOcho = 7 * 24 * 60 * 60 * 1000; // 7 días
        const ahora = Date.now();
        
        let sesionesLimpiadas = 0;
        sesiones.forEach(archivo => {
            const rutaArchivo = path.join(SESSION_PATH, archivo);
            try {
                const stats = fs.statSync(rutaArchivo);
                if (ahora - stats.mtimeMs > sieteOcho) {
                    fs.unlinkSync(rutaArchivo);
                    sesionesLimpiadas++;
                }
            } catch (error) {
                console.error(`❌ [WhatsApp] Error con archivo ${archivo}:`, error.message);
            }
        });
        
        console.log(`🧹 [WhatsApp] Sesiones limpiadas: ${sesionesLimpiadas}`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error al limpiar sesiones:`, error.message);
    }
}

// Intervalos de limpieza optimizados
setInterval(limpiarConversacionesAntiguas, 30 * 60 * 1000); // 30 minutos
setInterval(limpiarSesionesAntiguas, 24 * 60 * 60 * 1000); // 24 horas
limpiarSesionesAntiguas();

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000;

// Inicialización optimizada de WhatsApp
const initializeWhatsApp = async (io) => {
    console.log(`🚀 [WhatsApp] Iniciando cliente...`);
    
    let client = null;

    const handleReconnect = async () => {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`🔄 [WhatsApp] Intento de reconexión ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
            
            if (client) {
                try {
                    await client.destroy();
                } catch (e) {
                    console.error(`⚠️ [WhatsApp] Error al cerrar cliente:`, e.message);
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
            
            client = crearClienteWhatsApp();
            registrarEventosCliente(client, io);
            
            try {
                await client.initialize();
            } catch (error) {
                console.error(`❌ [WhatsApp] Error en reconexión:`, error.message);
                await handleReconnect();
            }
        } else {
            console.error(`❌ [WhatsApp] Máximo de intentos de reconexión alcanzado`);
            io.emit('whatsappStatus', { 
                status: 'error',
                message: 'Error de conexión persistente' 
            });
            
            setTimeout(() => {
                reconnectAttempts = 0;
            }, 10 * 60 * 1000);
        }
    };
    
    // Función para crear cliente con config optimizada
    const crearClienteWhatsApp = () => {
        return new Client({
            puppeteer: {
                args: [
                    "--disable-setuid-sandbox",
                    "--no-sandbox",
                    "--single-process",
                    "--no-zygote",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--disable-notifications",
                    "--window-size=800,600",
                    "--disk-cache-size=0",
                ],
                executablePath: process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
                headless: "new",
                timeout: 60000,
                defaultViewport: { width: 800, height: 600 },
                ignoreHTTPSErrors: true,
            },
            authStrategy: new LocalAuth({
                clientId: "film-fetcher-bot",
                dataPath: SESSION_PATH
            })
        });
    };
    
    // Función para registrar eventos
    const registrarEventosCliente = (cliente, socketIo) => {
        cliente.on('qr', async (qr) => {
            try {
                console.log(`🔄 [WhatsApp] Generando código QR...`);
                const qrCode = await qrcode.toDataURL(qr);
                socketIo.emit('whatsappQR', { qrCode });
            } catch (error) {
                console.error(`❌ [WhatsApp] Error al generar QR:`, error.message);
            }
        });

        cliente.on('ready', () => {
            reconnectAttempts = 0;
            console.log(`✨ [WhatsApp] Cliente listo`);
            socketIo.emit('whatsappStatus', { 
                status: 'ready',
                message: '¡WhatsApp está listo!' 
            });
            
            // Precarga de cartelera para no esperar al primer mensaje
            obtenerCartelera().catch(err => console.error('Error en precarga de cartelera:', err.message));
        });

        cliente.on('authenticated', () => {
            console.log(`🔐 [WhatsApp] Autenticado`);
            socketIo.emit('whatsappStatus', { 
                status: 'authenticated',
                message: 'Autenticado correctamente' 
            });
        });

        cliente.on('auth_failure', (error) => {
            console.error(`❌ [WhatsApp] Error de autenticación:`, error);
            socketIo.emit('whatsappStatus', { 
                status: 'error',
                message: 'Error de autenticación' 
            });
        });

        cliente.on('disconnected', async (reason) => {
            console.log(`🔌 [WhatsApp] Desconectado:`, reason);
            socketIo.emit('whatsappStatus', { 
                status: 'disconnected',
                message: 'WhatsApp desconectado' 
            });
            await handleReconnect();
        });

        // Procesamiento de mensajes optimizado
        cliente.on('message', async (msg) => {
            if (msg.isGroupMsg) return;
            
            try {
                console.log(`📩 [WhatsApp] Mensaje de ${msg.from}`);
                const chat = await msg.getChat();
                await chat.sendStateTyping();

                if (msg.type !== 'chat') {
                    await msg.reply('Por favor, envíame un mensaje de texto 🙂');
                    return;
                }

                // Iniciar obtención de cartelera de inmediato
                const carteleraPromise = obtenerCartelera();
                
                // Procesar el mensaje mientras se obtiene la cartelera
                let peliculas = [];
                try {
                    peliculas = await carteleraPromise;
                } catch (error) {
                    console.error(`❌ [WhatsApp] Error de cartelera:`, error.message);
                    await msg.reply('Lo siento, estoy teniendo problemas para obtener la cartelera. Inténtalo más tarde.');
                    await chat.clearState();
                    return;
                }

                const respuesta = await procesarMensajeIA(msg.body, peliculas, msg.from);
                actualizarContextoConversacion(msg.from, msg.body, respuesta);

                // Responder de inmediato sin esperas artificiales
                await msg.reply(respuesta);
                await chat.clearState();

            } catch (error) {
                console.error(`❌ [WhatsApp] Error con mensaje:`, error.message);
                await msg.reply('¡Ups! Algo falló, inténtalo de nuevo.');
            }
        });
    };

    io.on('connection', (socket) => {
        console.log(`🔌 [Socket.IO] Cliente conectado: ${socket.id}`);
        
        socket.on('requestReconnect', async () => {
            reconnectAttempts = 0;
            await handleReconnect();
        });
        
        socket.on('requestQR', () => {
            io.emit('whatsappStatus', { 
                status: 'loading',
                message: 'Generando código QR...' 
            });
        });
        
        socket.on('disconnect', () => {
            console.log(`🔌 [Socket.IO] Cliente desconectado: ${socket.id}`);
        });
    });
    
    // Inicialización
    client = crearClienteWhatsApp();
    registrarEventosCliente(client, io);
    
    try {
        console.log(`🚀 [WhatsApp] Inicializando...`);
        io.emit('whatsappStatus', { 
            status: 'loading',
            message: 'Iniciando WhatsApp...' 
        });
        
        await client.initialize();
        console.log(`✅ [WhatsApp] Inicializado`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error al inicializar:`, error.message);
        io.emit('error', { 
            message: 'Error al inicializar WhatsApp',
            details: error.message 
        });
        await handleReconnect();
    }
    
    // Health check simplificado
    const healthCheckInterval = setInterval(async () => {
        if (client && client.info) {
            try {
                const state = await client.getState();
                if (state === 'DISCONNECTED') {
                    await handleReconnect();
                }
            } catch (error) {
                await handleReconnect();
            }
        }
    }, 10 * 60 * 1000); // Cada 10 minutos
    
    // Limpieza al salir
    process.on('SIGINT', () => {
        clearInterval(healthCheckInterval);
        if (client) client.destroy();
        process.exit(0);
    });
};

module.exports = { initializeWhatsApp };