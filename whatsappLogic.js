const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");
const axios = require('axios');
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const SERVIDOR_PRINCIPAL = 'https://filmfetcher.onrender.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

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
            const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`);
            
            const peliculasHoy = response.data.filter(pelicula => {
                const fechaOriginal = new Date(pelicula.fechaHora);
                const fechaAjustada = ajustarZonaHoraria(fechaOriginal);
                return fechaAjustada >= ahora;
            });

            console.log(`✅ [Cartelera] Datos filtrados: ${peliculasHoy.length} películas para hoy y fechas posteriores`);
            
            carteleraCache.peliculas = peliculasHoy;
            carteleraCache.lastUpdate = Date.now();
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
            }
        });

        if (response.data.results.length > 0) {
            const pelicula = response.data.results[0];
            const detallesCompletos = await axios.get(`${TMDB_BASE_URL}/movie/${pelicula.id}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES',
                    append_to_response: 'credits'
                }
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
                return `📽️ Detalles de "${intencion.nombrePelicula}":\n\n` +
                       `📖 Sinopsis: ${detalles.sinopsisDetallada}\n\n` +
                       `🎭 Reparto: ${detalles.reparto}\n` +
                       `🎬 Director: ${detalles.director}\n` +
                       `🎪 Géneros: ${detalles.generos}\n`  
                       ;
            }
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un asistente de cine conciso y eficiente. Contexto actual:
                    - Cartelera: ${contextoPeliculas}
                    - Preferencias del usuario: ${JSON.stringify(contexto.preferencias)}
                    
                    Directrices:
                    1. Si el usuario pregunta por una película específica, proporciona la información disponible y sugiere naturalmente que pueden preguntar por más detalles.
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

        return response.choices[0].message.content;
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

setInterval(limpiarConversacionesAntiguas, 15 * 60 * 1000);

const initializeWhatsApp = async (io) => {
    console.log(`🚀 [WhatsApp] Iniciando cliente...`);
    const client = new Client({
        puppeteer: {
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
            ],
            executablePath: process.env.NODE_ENV === "production"
                ? process.env.PUPPETEER_EXECUTABLE_PATH
                : puppeteer.executablePath(),
        }
    });

    client.on('qr', async (qr) => {
        try {
            console.log(`🔄 [WhatsApp] Generando código QR...`);
            const qrCode = await qrcode.toDataURL(qr);
            io.emit('whatsappQR', { qrCode });
        } catch (error) {
            console.error(`❌ [WhatsApp] Error al generar QR:`, error);
        }
    });

    client.on('ready', () => {
        console.log(`✨ [WhatsApp] Cliente listo y operativo`);
        io.emit('whatsappStatus', { 
            status: 'ready',
            message: '¡WhatsApp está listo!' 
        });
    });

    client.on('message', async (msg) => {
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

            const peliculas = await obtenerCartelera();
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

    try {
        await client.initialize();
        console.log(`✅ [WhatsApp] Cliente inicializado exitosamente`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error al inicializar cliente:`, error);
        io.emit('error', { 
            message: 'Error al inicializar WhatsApp',
            details: error.message 
        });
    }
};

module.exports = { initializeWhatsApp };
