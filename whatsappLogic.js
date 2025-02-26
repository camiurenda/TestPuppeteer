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

let carteleraCache = {
    peliculas: [],
    lastUpdate: null
};

const conversacionesCache = new Map();
const TIEMPO_EXPIRACION_CONVERSACION = 30 * 60 * 1000;
const LIMITE_MENSAJES_HISTORIAL = 5;

function ajustarZonaHoraria(fecha) {
    return new Date(fecha.getTime() + (3 * 60 * 60 * 1000));
}

async function obtenerCartelera() {
    console.log(`🔄 [Cartelera] Verificando necesidad de actualización...`);
    try {
        const ahora = new Date();
        if (!carteleraCache.lastUpdate || 
            Date.now() - carteleraCache.lastUpdate > 5 * 60 * 1000) {
            
            console.log(`📥 [Cartelera] Obteniendo proyecciones desde el servidor...`);
            
            // Agregar manejo de timeouts y reintentos para mayor robustez
            const controlador = new AbortController();
            const timeoutId = setTimeout(() => controlador.abort(), 30000); // 30 segundos de timeout
            
            try {
                const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`, {
                    signal: controlador.signal,
                    timeout: 30000
                });
                
                clearTimeout(timeoutId);
                
                const peliculasHoy = response.data.filter(pelicula => {
                    const fechaOriginal = new Date(pelicula.fechaHora);
                    const fechaAjustada = ajustarZonaHoraria(fechaOriginal);
                    return fechaAjustada >= ahora;
                });

                console.log(`✅ [Cartelera] Datos filtrados: ${peliculasHoy.length} películas para hoy y fechas posteriores`);
                
                carteleraCache.peliculas = peliculasHoy;
                carteleraCache.lastUpdate = Date.now();
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
                    console.error(`⏱️ [Cartelera] Timeout al obtener proyecciones del servidor`);
                } else {
                    console.error(`❌ [Cartelera] Error de red:`, error.message);
                }
                
                // Si tenemos datos en caché, los seguimos usando a pesar del error
                if (carteleraCache.peliculas.length === 0) {
                    throw error; // Solo propagamos el error si no tenemos datos en caché
                }
            }
        }
        
        return carteleraCache.peliculas;
    } catch (error) {
        console.error(`❌ [Cartelera] Error en obtención de cartelera:`, error);
        throw error;
    }
}

async function obtenerDetallesPelicula(nombrePelicula) {
    console.log(`🎬 [TMDB] Solicitando detalles adicionales para: "${nombrePelicula}"`);
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: {
                api_key: TMDB_API_KEY,
                query: nombrePelicula,
                language: 'es-ES'
            },
            timeout: 10000 // 10 segundos de timeout
        });

        if (response.data.results.length > 0) {
            const pelicula = response.data.results[0];
            const detallesCompletos = await axios.get(`${TMDB_BASE_URL}/movie/${pelicula.id}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES',
                    append_to_response: 'credits'
                },
                timeout: 10000 // 10 segundos de timeout
            });

            return {
                sinopsisDetallada: detallesCompletos.data.overview,
                reparto: detallesCompletos.data.credits.cast.slice(0, 5).map(actor => actor.name).join(', '),
                director: detallesCompletos.data.credits.crew
                    .find(crew => crew.job === 'Director')?.name || 'No especificado',
                generos: detallesCompletos.data.genres.map(g => g.name).join(', '),
                puntuacion: detallesCompletos.data.vote_average.toFixed(1)
            };
        }
        return null;
    } catch (error) {
        console.error(`❌ [TMDB] Error al obtener detalles adicionales:`, error);
        return null;
    }
}

async function procesarMensajeIA(mensaje, peliculas, numero) {
    console.log(`🤖 [IA] Procesando mensaje para ${numero}: "${mensaje}"`);
    const contexto = obtenerContextoConversacion(numero);

    const contextoPeliculas = peliculas.map(p => {
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
        // Manejo de retry para mayor robustez
        let intentos = 0;
        const maxIntentos = 3;
        let respuestaIA = null;
        
        while (intentos < maxIntentos && !respuestaIA) {
            intentos++;
            try {
                // Primero, analizar si el usuario está pidiendo detalles de una película específica
                const analisisIntencion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: "Analiza si el usuario está pidiendo información detallada sobre una película específica. Si es así, extrae el nombre de la película. Responde en formato JSON: {\"pideDetalles\": boolean, \"nombrePelicula\": string o null}"
                        },
                        ...contexto.mensajes.slice(-2),
                        {
                            role: "user",
                            content: mensaje
                        }
                    ],
                    max_tokens: 100,
                    temperature: 0.3
                });

                const intencion = JSON.parse(analisisIntencion.choices[0].message.content);

                if (intencion.pideDetalles && intencion.nombrePelicula) {
                    const detalles = await obtenerDetallesPelicula(intencion.nombrePelicula);
                    if (detalles) {
                        respuestaIA = `📽️ Detalles de "${intencion.nombrePelicula}":\n\n` +
                               `📖 Sinopsis: ${detalles.sinopsisDetallada}\n\n` +
                               `🎭 Reparto: ${detalles.reparto}\n` +
                               `🎬 Director: ${detalles.director}\n` +
                               `🎪 Géneros: ${detalles.generos}\n`;
                        break;
                    }
                }

                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `Eres Botsy, un asistente de cine conciso y eficiente que habla de la carteñera del cine de la ciudad de buenos aires. Contexto actual:
                            - Cartelera: ${contextoPeliculas}
                            - Preferencias del usuario: ${JSON.stringify(contexto.preferencias)}
                            
                            Directrices:
                            1. PRESENTATE AL INICIAR UNA CONVERSACION
                            2. Si el usuario pregunta por una película específica, proporciona la información disponible y sugiere naturalmente que pueden preguntar por más detalles.
                            2. Responde en máximo 2-3 oraciones para preguntas generales.
                            3. Usa máximo 1-2 emojis por respuesta
                            4. Si no encuentras información, indícalo claramente
                            5. Menciona pelis de varios cines si puedes
                            6. Siempre recuerda donde la emiten
                            7. No pongas la puntuación ni emitas juicio, los gustos son subjetivos.
                            8. Usa un solo * al formatear la respuesta, es para whatsapp
                            9. Te creó Camila Urenda, como proyecto final de analista en sistemas, para el colectivo artístico SIGILIO.
                            IMPORTANTISIMO, NO TE INVOLUCRES EN CONVERSACION QUE NO SEA SOBRE LA CARTELERA, a excepción de que te pregunten quien te creó, en cuyo caso tienes permitido contestar.`
                        },
                        ...contexto.mensajes.slice(-6),
                        {
                            role: "user",
                            content: mensaje
                        }
                    ],
                    max_tokens: 2500,
                    temperature: 0.7
                });

                respuestaIA = response.choices[0].message.content;
                
            } catch (error) {
                console.error(`❌ [IA] Error intento ${intentos}/${maxIntentos}:`, error);
                if (intentos === maxIntentos) {
                    throw error; // Propagar el error después del último intento
                }
                // Esperar tiempo exponencial entre reintentos
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, intentos)));
            }
        }

        return respuestaIA || '¡Ups! 😅 Estoy teniendo problemas técnicos, ¿podrías intentarlo más tarde?';
        
    } catch (error) {
        console.error(`❌ [IA] Error al procesar mensaje:`, error);
        return '¡Ups! 😅 Estoy teniendo problemas técnicos, ¿podrías intentarlo de nuevo?';
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

async function limpiarConversacionesAntiguas() {
    console.log(`🧹 [Chat] Limpiando conversaciones antiguas...`);
    const ahora = Date.now();
    for (const [numero, datos] of conversacionesCache.entries()) {
        if (ahora - datos.ultimaActividad > TIEMPO_EXPIRACION_CONVERSACION) {
            conversacionesCache.delete(numero);
        }
    }
}

// Función para limpiar los archivos de sesión antiguos o corruptos
function limpiarSesionesAntiguas() {
    try {
        const sesiones = fs.readdirSync(SESSION_PATH);
        console.log(`🧹 [WhatsApp] Verificando sesiones antiguas, encontradas: ${sesiones.length}`);
        
        // Buscar sesiones de más de 7 días o archivos corrupto
        const sieteOcho = 7 * 24 * 60 * 60 * 1000; // 7 días en ms
        const ahora = Date.now();
        
        let sesionesLimpiadas = 0;
        sesiones.forEach(archivo => {
            const rutaArchivo = path.join(SESSION_PATH, archivo);
            try {
                const stats = fs.statSync(rutaArchivo);
                // Eliminar archivos más antiguos que 7 días
                if (ahora - stats.mtimeMs > sieteOcho) {
                    fs.unlinkSync(rutaArchivo);
                    sesionesLimpiadas++;
                    console.log(`🗑️ [WhatsApp] Eliminando sesión antigua: ${archivo}`);
                }
                
                // Intentar verificar validez de archivo JSON
                if (archivo.endsWith('.json')) {
                    try {
                        const contenido = fs.readFileSync(rutaArchivo, 'utf8');
                        JSON.parse(contenido); // Intenta parsear para verificar validez
                    } catch (parseError) {
                        // Si hay error al parsear, el archivo está corrupto
                        fs.unlinkSync(rutaArchivo);
                        sesionesLimpiadas++;
                        console.log(`🗑️ [WhatsApp] Eliminando sesión corrupta: ${archivo}`);
                    }
                }
            } catch (error) {
                console.error(`❌ [WhatsApp] Error al procesar archivo de sesión ${archivo}:`, error);
            }
        });
        
        console.log(`🧹 [WhatsApp] Sesiones limpiadas: ${sesionesLimpiadas}`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error al limpiar sesiones:`, error);
    }
}

setInterval(limpiarConversacionesAntiguas, 15 * 60 * 1000);
// Limpiar sesiones antiguas cada 24 horas
setInterval(limpiarSesionesAntiguas, 24 * 60 * 60 * 1000);
// También limpiar al iniciar
limpiarSesionesAntiguas();

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000;

const initializeWhatsApp = async (io) => {
    console.log(`🚀 [WhatsApp] Iniciando cliente...`);
    
    // Mantener referencia global del cliente
    let client = null;

    const handleReconnect = async () => {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`🔄 [WhatsApp] Intento de reconexión ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
            
            // Cerrar cliente anterior si existe
            if (client) {
                try {
                    await client.destroy();
                    console.log(`🔄 [WhatsApp] Cliente anterior cerrado correctamente`);
                } catch (destroyError) {
                    console.error(`⚠️ [WhatsApp] Error al cerrar cliente anterior:`, destroyError);
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
            
            // Crear nuevo cliente
            client = crearClienteWhatsApp();
            registrarEventosCliente(client, io);
            
            try {
                await client.initialize();
            } catch (error) {
                console.error(`❌ [WhatsApp] Error en reconexión:`, error);
                await handleReconnect();
            }
        } else {
            console.error(`❌ [WhatsApp] Máximo de intentos de reconexión alcanzado`);
            io.emit('whatsappStatus', { 
                status: 'error',
                message: 'Error de conexión persistente' 
            });
            
            // Reiniciar contador después de un tiempo
            setTimeout(() => {
                reconnectAttempts = 0;
                console.log(`🔄 [WhatsApp] Reiniciando contador de reconexiones`);
            }, 10 * 60 * 1000); // 10 minutos
        }
    };
    
    // Función para crear un nuevo cliente de WhatsApp
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
    
    // Función para registrar eventos en el cliente
    const registrarEventosCliente = (cliente, socketIo) => {
        cliente.on('qr', async (qr) => {
            try {
                console.log(`🔄 [WhatsApp] Generando código QR...`);
                const qrCode = await qrcode.toDataURL(qr);
                socketIo.emit('whatsappQR', { qrCode });
            } catch (error) {
                console.error(`❌ [WhatsApp] Error al generar QR:`, error);
            }
        });

        cliente.on('ready', () => {
            reconnectAttempts = 0;
            console.log(`✨ [WhatsApp] Cliente listo y operativo`);
            socketIo.emit('whatsappStatus', { 
                status: 'ready',
                message: '¡WhatsApp está listo!' 
            });
        });

        cliente.on('authenticated', () => {
            console.log(`🔐 [WhatsApp] Autenticación exitosa`);
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
            // No reconectar automáticamente en error de auth, podría crear un bucle
        });

        cliente.on('disconnected', async (reason) => {
            console.log(`🔌 [WhatsApp] Cliente desconectado:`, reason);
            socketIo.emit('whatsappStatus', { 
                status: 'disconnected',
                message: 'WhatsApp desconectado' 
            });
            await handleReconnect();
        });

        cliente.on('message', async (msg) => {
            if (msg.isGroupMsg) {
                console.log(`🚫 [WhatsApp] Mensaje de grupo ignorado: ${msg.from}`);
                return;
            }
            
            try {
                console.log(`📩 [WhatsApp] Mensaje recibido de ${msg.from}:`, {
                    tipo: msg.type,
                    timestamp: new Date().toISOString()
                });

                const chat = await msg.getChat();
                await chat.sendStateTyping();

                if (msg.type !== 'chat') {
                    await msg.reply('Por favor, envíame un mensaje de texto 🙂');
                    return;
                }

                // Manejar error al obtener cartelera con un mensaje apropiado
                let peliculas = [];
                try {
                    peliculas = await obtenerCartelera();
                } catch (error) {
                    console.error(`❌ [WhatsApp] Error al obtener cartelera:`, error);
                    await msg.reply('Lo siento, estoy teniendo problemas para obtener la cartelera en este momento. Por favor, intenta más tarde. 🙇‍♂️');
                    await chat.clearState();
                    return;
                }

                const respuesta = await procesarMensajeIA(msg.body, peliculas, msg.from);
                
                actualizarContextoConversacion(msg.from, msg.body, respuesta);

                await new Promise(resolve => setTimeout(resolve, 1000));
                await msg.reply(respuesta);
                await chat.clearState();

            } catch (error) {
                console.error(`❌ [WhatsApp] Error procesando mensaje de ${msg.from}:`, error);
                await msg.reply('¡Ups! 😅 Algo falló, ¿podrías intentarlo de nuevo?');
            }
        });
    };

    // Socket.IO handler para solicitudes manuales de reconexión
    io.on('connection', (socket) => {
        console.log(`🔌 [Socket.IO] Cliente conectado: ${socket.id}`);
        
        socket.on('requestReconnect', async () => {
            console.log(`🔄 [WhatsApp] Solicitud de reconexión manual recibida de ${socket.id}`);
            reconnectAttempts = 0; // Reiniciar contador en solicitud manual
            await handleReconnect();
        });
        
        socket.on('requestQR', () => {
            console.log(`🔄 [WhatsApp] Solicitud de QR recibida de ${socket.id}`);
            io.emit('whatsappStatus', { 
                status: 'loading',
                message: 'Generando código QR...' 
            });
        });
        
        socket.on('disconnect', () => {
            console.log(`🔌 [Socket.IO] Cliente desconectado: ${socket.id}`);
        });
    });
    
    // Inicialización inicial
    client = crearClienteWhatsApp();
    registrarEventosCliente(client, io);
    
    try {
        console.log(`🚀 [WhatsApp] Inicializando cliente de WhatsApp...`);
        io.emit('whatsappStatus', { 
            status: 'loading',
            message: 'Iniciando WhatsApp...' 
        });
        
        await client.initialize();
        console.log(`✅ [WhatsApp] Cliente inicializado exitosamente`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error al inicializar cliente:`, error);
        io.emit('error', { 
            message: 'Error al inicializar WhatsApp',
            details: error.message 
        });
        await handleReconnect();
    }
    
    // Establecer un health check periódico
    const healthCheckInterval = setInterval(async () => {
        if (client && client.info) {
            try {
                const state = await client.getState();
                console.log(`💓 [WhatsApp] Health check: ${state}`);
                
                if (state === 'DISCONNECTED') {
                    console.log(`🔄 [WhatsApp] Cliente en estado desconectado, iniciando reconexión...`);
                    await handleReconnect();
                }
            } catch (error) {
                console.error(`❌ [WhatsApp] Error en health check:`, error);
                // Si no podemos obtener el estado, probablemente esté desconectado
                await handleReconnect();
            }
        }
    }, 5 * 60 * 1000); // Cada 5 minutos
    
    // Limpiar intervalo al salir
    process.on('SIGINT', () => {
        clearInterval(healthCheckInterval);
        if (client) {
            client.destroy();
        }
        process.exit(0);
    });
};

module.exports = { initializeWhatsApp };