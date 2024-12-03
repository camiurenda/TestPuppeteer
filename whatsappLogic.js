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

// Estructuras de datos para caché
let carteleraCache = {
    peliculas: [],
    lastUpdate: null
};
const peliculasDetallesCache = new Map();
const conversacionesCache = new Map();
const TIEMPO_EXPIRACION_CONVERSACION = 30 * 60 * 1000;
const LIMITE_MENSAJES_HISTORIAL = 5;

// Obtiene detalles de una película desde TMDB
async function obtenerDetallesPelicula(nombrePelicula) {
 // Verificar caché primero
    if (peliculasDetallesCache.has(nombrePelicula)) {
        return peliculasDetallesCache.get(nombrePelicula);
    }
    // Búsqueda en TMDB
    try {
        const searchResponse = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: {
                api_key: TMDB_API_KEY,
                query: nombrePelicula,
                language: 'es-ES'
            }
        });

        if (searchResponse.data.results.length > 0) {
            const peliculaId = searchResponse.data.results[0].id;
// Obtener detalles y créditos en paralelo
            const [detalles, creditos] = await Promise.all([
                axios.get(`${TMDB_BASE_URL}/movie/${peliculaId}`, {
                    params: {
                        api_key: TMDB_API_KEY,
                        language: 'es-ES'
                    }
                }),
                axios.get(`${TMDB_BASE_URL}/movie/${peliculaId}/credits`, {
                    params: {
                        api_key: TMDB_API_KEY
                    }
                })
            ]);
// Procesar y estructurar la información
            const actoresPrincipales = creditos.data.cast
                .slice(0, 3)
                .map(actor => actor.name)
                .join(', ');

            const detallesPelicula = {
                titulo: detalles.data.title,
                sinopsis: detalles.data.overview,
                generos: detalles.data.genres.map(g => g.name).join(', '),
                actores: actoresPrincipales,
                duracion: detalles.data.runtime,
                puntuacion: detalles.data.vote_average.toFixed(1)
            };
 // Guardar en caché
            peliculasDetallesCache.set(nombrePelicula, detallesPelicula);
            return detallesPelicula;
        }
        return null;
    } catch (error) {
        console.error('Error al obtener detalles de TMDB:', error);
        return null;
    }
}
//Actualiza la caché de cartelera
async function actualizarCarteleraCache() {
    try {
        if (!carteleraCache.lastUpdate || 
            Date.now() - carteleraCache.lastUpdate > 5 * 60 * 1000) {
            const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`);

            const peliculasConDetalles = await Promise.all(
                response.data.map(async (pelicula) => {
                    const detalles = await obtenerDetallesPelicula(pelicula.nombrePelicula);
                    return {
                        ...pelicula,
                        detalles
                    };
                })
            );
            carteleraCache.peliculas = peliculasConDetalles;
            carteleraCache.lastUpdate = Date.now();
        }
        return carteleraCache.peliculas;
    } catch (error) {
        console.error('Error al actualizar caché de cartelera:', error);
        throw error;
    }
}

//Gestiona el contexto de las conversaciones con usuarios
async function limpiarConversacionesAntiguas() {
    const ahora = Date.now();
    for (const [numero, datos] of conversacionesCache.entries()) {
        if (ahora - datos.ultimaActividad > TIEMPO_EXPIRACION_CONVERSACION) {
            conversacionesCache.delete(numero);
        }
    }
}

// Programar limpieza periódica de conversaciones
setInterval(limpiarConversacionesAntiguas, 15 * 60 * 1000);

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

 // Mantener solo los últimos mensajes
function actualizarContextoConversacion(numero, mensaje, respuesta) {
    const contexto = obtenerContextoConversacion(numero);
    contexto.mensajes.push({
        role: "user",
        content: mensaje
    }, {
        role: "assistant",
        content: respuesta
    });

    if (contexto.mensajes.length > LIMITE_MENSAJES_HISTORIAL * 2) {
        contexto.mensajes = contexto.mensajes.slice(-LIMITE_MENSAJES_HISTORIAL * 2);
    }

    contexto.ultimaActividad = Date.now();
    actualizarPreferenciasUsuario(contexto, mensaje);
}

 // Detectar preferencias
function actualizarPreferenciasUsuario(contexto, mensaje) {
    const mensajeLower = mensaje.toLowerCase();
    
    if (mensajeLower.includes('acción') || mensajeLower.includes('aventura')) {
        contexto.preferencias.generoPreferido = 'acción/aventura';
    }
    if (mensajeLower.includes('comedia')) {
        contexto.preferencias.generoPreferido = 'comedia';
    }
    
    if (mensajeLower.includes('noche') || mensajeLower.includes('tarde')) {
        contexto.preferencias.horarioPreferido = mensajeLower.includes('noche') ? 'noche' : 'tarde';
    }
}
   // Preparar contexto de películas para la IA
async function procesarMensajeIA(mensaje, peliculas, numero) {
    const contexto = obtenerContextoConversacion(numero);
    const contextoPeliculas = peliculas.map(p => {
        const fecha = new Date(p.fechaHora).toLocaleString('es-AR', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });

        const detallesStr = p.detalles ? 
            `[Sinopsis: ${p.detalles.sinopsis}. Actores: ${p.detalles.actores}. Duración: ${p.detalles.duracion} min. Puntuación: ${p.detalles.puntuacion}/10]` : '';

        return `${p.nombrePelicula} ${detallesStr} en ${p.nombreCine} el ${fecha} a $${p.precio || 'precio no disponible'}`;
    }).join('. ');

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un asistente de cine conciso y eficiente. Contexto actual:
                    - Cartelera: ${contextoPeliculas}
                    - Preferencias del usuario: ${JSON.stringify(contexto.preferencias)}
                    
                    Directrices:
                    1. Primero ofrece las peliculas en cartelera.
                    2. Si preguntan por mas informacion sobre una película específica, incluye detalles relevantes como actores y sinopsis
                    3. Responde en máximo 2-3 oraciones para preguntas generales. 4 o 5 para preguntas mas complejas.
                    4. Prioriza películas según las preferencias del usuario
                    5. Usa máximo 1-2 emojis por respuesta
                    6. Si no encuentras información sobre una película, indícalo claramente`
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
        console.error('Error al procesar mensaje con IA:', error);
        return '¡Ups! 😅 Estoy teniendo problemas técnicos, ¿podrías intentarlo de nuevo?';
    }
}

// Configurar cliente de WhatsApp
const initializeWhatsApp = async (io) => {
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
 // Manejar generación de código QR
    client.on('qr', async (qr) => {
        try {
            const qrCode = await qrcode.toDataURL(qr);
            io.emit('whatsappQR', { qrCode });
        } catch (error) {
            console.error('Error al generar QR:', error);
        }
    });
  // Manejar estado ready
    client.on('ready', () => {
        console.log('Cliente WhatsApp listo');
        io.emit('whatsappStatus', { 
            status: 'ready',
            message: '¡WhatsApp está listo!' 
        });
    });
// Manejar mensajes entrantes
    client.on('message', async (msg) => {
        if (msg.isGroupMsg) return;
        
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();

            const peliculas = await actualizarCarteleraCache();
            const respuesta = await procesarMensajeIA(msg.body, peliculas, msg.from);
            
            actualizarContextoConversacion(msg.from, msg.body, respuesta);

            await new Promise(resolve => setTimeout(resolve, 1000));
            await msg.reply(respuesta);
            await chat.clearState();
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            await msg.reply('¡Ups! 😅 Algo falló, ¿podrías intentarlo de nuevo?');
        }
    });
// Iniciar cliente
    try {
        await client.initialize();
    } catch (error) {
        console.error('Error al inicializar WhatsApp:', error);
        io.emit('error', { message: 'Error al inicializar WhatsApp' });
    }
};

module.exports = { initializeWhatsApp };