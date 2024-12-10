const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");
const axios = require('axios');
const OpenAI = require('openai');
require('dotenv').config();

class CarteleraManager {
    constructor() {
        this.cache = {
            peliculas: [],
            lastUpdate: null
        };
        this.CACHE_DURATION = 5 * 60 * 1000;
        this.SERVIDOR_PRINCIPAL = process.env.MAIN_SERVER_URL || 'https://filmfetcher.onrender.com';
    }

    ajustarZonaHoraria(fecha) {
        return new Date(fecha.getTime() + (3 * 60 * 60 * 1000));
    }

    async obtenerCartelera() {
        const ahora = new Date();
        if (this.necesitaActualizacion()) {
            await this.actualizarCache(ahora);
        }
        return this.cache.peliculas;
    }

    necesitaActualizacion() {
        return !this.cache.lastUpdate || 
               Date.now() - this.cache.lastUpdate > this.CACHE_DURATION;
    }

    async actualizarCache(ahora) {
        try {
            const response = await axios.get(`${this.SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`);
            this.cache.peliculas = response.data.filter(pelicula => {
                const fechaAjustada = this.ajustarZonaHoraria(new Date(pelicula.fechaHora));
                return fechaAjustada >= ahora;
            });
            this.cache.lastUpdate = Date.now();
        } catch (error) {
            console.error(`❌ [Cartelera] Error actualizando cache:`, error);
            throw error;
        }
    }
}

class ConversacionManager {
    constructor() {
        this.conversaciones = new Map();
        this.TIEMPO_EXPIRACION = 30 * 60 * 1000;
        this.LIMITE_MENSAJES = 5;
        this.iniciarLimpieza();
    }

    obtenerContexto(numero) {
        if (!this.conversaciones.has(numero)) {
            this.conversaciones.set(numero, {
                mensajes: [],
                ultimaActividad: Date.now(),
                preferencias: {}
            });
        }
        return this.conversaciones.get(numero);
    }

    actualizarContexto(numero, mensaje, respuesta) {
        const contexto = this.obtenerContexto(numero);
        contexto.mensajes.push(
            { role: "user", content: mensaje },
            { role: "assistant", content: respuesta }
        );
        
        if (contexto.mensajes.length > this.LIMITE_MENSAJES * 2) {
            contexto.mensajes = contexto.mensajes.slice(-this.LIMITE_MENSAJES * 2);
        }
        
        contexto.ultimaActividad = Date.now();
    }

    iniciarLimpieza() {
        setInterval(() => this.limpiarConversacionesAntiguas(), 15 * 60 * 1000);
    }

    limpiarConversacionesAntiguas() {
        const ahora = Date.now();
        for (const [numero, datos] of this.conversaciones.entries()) {
            if (ahora - datos.ultimaActividad > this.TIEMPO_EXPIRACION) {
                this.conversaciones.delete(numero);
            }
        }
    }
}

class IAService {
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.TMDB_API_KEY = process.env.TMDB_API_KEY;
        this.TMDB_BASE_URL = 'https://api.themoviedb.org/3';
    }

    async procesarMensaje(mensaje, peliculas, numero, contextoConversacion) {
        const contextoPeliculas = this.prepararContextoPeliculas(peliculas);
        const respuestaIA = await this.obtenerRespuestaIA(mensaje, contextoPeliculas, contextoConversacion);
        
        if (respuestaIA.includes('DETALLES_PELICULA:')) {
            return await this.procesarDetallesPelicula(respuestaIA);
        }
        
        return respuestaIA;
    }

    prepararContextoPeliculas(peliculas) {
        return peliculas.map(p => {
            const fechaAjustada = new CarteleraManager().ajustarZonaHoraria(new Date(p.fechaHora));
            const fecha = fechaAjustada.toLocaleString('es-AR', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `${p.nombrePelicula} en ${p.nombreCine} el ${fecha} a $${p.precio || 'precio no disponible'}`;
        }).join('. ');
    }

    async obtenerRespuestaIA(mensaje, contextoPeliculas, contexto) {
        const response = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: this.obtenerPromptBase(contextoPeliculas, contexto)
                },
                ...contexto.mensajes.slice(-6),
                { role: "user", content: mensaje }
            ],
            max_tokens: 2500,
            temperature: 0.7
        });
        return response.choices[0].message.content;
    }

    obtenerPromptBase(contextoPeliculas, contexto) {
        return `Eres FilmFetcher, un asistente que sabe sobre las carteleras de cine de buenos aires. Contexto actual:
        - Cartelera: ${contextoPeliculas}
        - Preferencias del usuario: ${JSON.stringify(contexto.preferencias)}
        
        Directrices:
        1. Al saludar, te presentas y mencionas cual es tu función
        2. Si el usuario pregunta por una película específica, busca los detalles.
        3. Responde en máximo 2-3 oraciones para preguntas generales.
        4. Usa máximo 1-2 emojis por respuesta
        5. Si no encuentras información, indícalo claramente y redirecciona a alguna peli que si conozcas.
        6. Si te preguntan por determinado dia o fin de semana, trata de ser variado en cuanto a cines con tu respuesta
        7. SIEMPRE recuerda en el mensaje donde emitirán la película, el cine y la hora. Esto incluye cuando te piden mas info de una peli.
        8. El texto saldra en un chat de whatsapp, usa simbolos como * y _ para enfasis de manera acorde.
        9. Si te preguntan, te creó Camila Urenda, como proyecto final de analista en sistemas, para el colectivo artístico SIGILIO.
        10. Si te preguntan por la "mejor" o "peor" película, la mas valorada, debes decir que es algo subjetivo, que depende de cada uno, y debes preguntar que le gustaría ver, para recomendar algo en el proximo mensaje.
        IMPORTANTISIMO, NO TE INVOLUCRES EN CONVERSACION QUE NO SEA SOBRE LA CARTELERA, a excepción de que te pregunten quien te creó, en cuyo caso tienes permitido contestar.`;
    }

    async procesarDetallesPelicula(respuesta) {
        const nombrePelicula = respuesta.split(':')[1].trim();
        const detalles = await this.obtenerDetallesPelicula(nombrePelicula);
        
        if (detalles) {
            return this.formatearDetallesPelicula(nombrePelicula, detalles);
        }
        return respuesta;
    }

    async obtenerDetallesPelicula(nombrePelicula) {
        try {
            const peliculaBase = await this.buscarPelicula(nombrePelicula);
            if (!peliculaBase) return null;

            const detallesCompletos = await this.obtenerDetallesCompletos(peliculaBase.id);
            return this.procesarDetallesCompletos(detallesCompletos);
        } catch (error) {
            console.error(`❌ [TMDB] Error al obtener detalles:`, error);
            return null;
        }
    }

    async buscarPelicula(nombrePelicula) {
        const response = await axios.get(`${this.TMDB_BASE_URL}/search/movie`, {
            params: {
                api_key: this.TMDB_API_KEY,
                query: nombrePelicula,
                language: 'es-ES'
            }
        });
        return response.data.results[0];
    }

    async obtenerDetallesCompletos(peliculaId) {
        return await axios.get(`${this.TMDB_BASE_URL}/movie/${peliculaId}`, {
            params: {
                api_key: this.TMDB_API_KEY,
                language: 'es-ES',
                append_to_response: 'credits'
            }
        });
    }

    procesarDetallesCompletos(response) {
        return {
            sinopsisDetallada: response.data.overview,
            reparto: response.data.credits.cast.slice(0, 5).map(actor => actor.name).join(', '),
            director: response.data.credits.crew.find(crew => crew.job === 'Director')?.name || 'No especificado',
            generos: response.data.genres.map(g => g.name).join(', '),
            puntuacion: response.data.vote_average.toFixed(1)
        };
    }

    formatearDetallesPelicula(nombrePelicula, detalles) {
        return `📽️ Detalles de "${nombrePelicula}":\n\n` +
               `📖 Sinopsis: ${detalles.sinopsisDetallada}\n\n` +
               `🎭 Reparto: ${detalles.reparto}\n` +
               `🎬 Director: ${detalles.director}\n` +
               `🎪 Géneros: ${detalles.generos}\n`
    }
}

class WhatsAppBot {
    constructor(io) {
        this.io = io;
        this.carteleraManager = new CarteleraManager();
        this.conversacionManager = new ConversacionManager();
        this.iaService = new IAService();
        this.client = this.configurarCliente();
    }

    configurarCliente() {
        return new Client({
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
    }

    async inicializar() {
        this.configurarEventos();
        try {
            await this.client.initialize();
            console.log(`✅ [WhatsApp] Cliente inicializado exitosamente`);
        } catch (error) {
            console.error(`❌ [WhatsApp] Error al inicializar cliente:`, error);
            this.io.emit('error', { 
                message: 'Error al inicializar WhatsApp',
                details: error.message 
            });
        }
    }

    configurarEventos() {
        this.client.on('qr', async (qr) => this.manejarQR(qr));
        this.client.on('ready', () => this.manejarReady());
        this.client.on('message', async (msg) => this.manejarMensaje(msg));
    }

    async manejarQR(qr) {
        try {
            const qrCode = await qrcode.toDataURL(qr);
            this.io.emit('whatsappQR', { qrCode });
            console.log('Nuevo código QR generado');
        } catch (error) {
            console.error('Error al generar QR:', error);
        }
    }

    manejarReady() {
        console.log('Cliente WhatsApp listo');
        this.io.emit('whatsappStatus', { 
            status: 'ready',
            message: '¡WhatsApp está listo!' 
        });
    }

    async manejarMensaje(msg) {
        if (msg.isGroupMsg) {
            console.log(`🚫 [WhatsApp] Mensaje de grupo ignorado: ${msg.from}`);
            return;
        }

        try {
            await this.procesarMensaje(msg);
        } catch (error) {
            console.error(`❌ [WhatsApp] Error procesando mensaje:`, error);
            await msg.reply('¡Ups! 😅 Algo falló, ¿podrías intentarlo de nuevo?');
        }
    }

    async procesarMensaje(msg) {
        const chat = await msg.getChat();
        await chat.sendStateTyping();

        if (msg.type !== 'chat') {
            await msg.reply('Por favor, envíame un mensaje de texto 🙂');
            return;
        }

        const peliculas = await this.carteleraManager.obtenerCartelera();
        const contexto = this.conversacionManager.obtenerContexto(msg.from);
        
        const respuesta = await this.iaService.procesarMensaje(
            msg.body, 
            peliculas, 
            msg.from,
            contexto
        );

        this.conversacionManager.actualizarContexto(msg.from, msg.body, respuesta);

        await new Promise(resolve => setTimeout(resolve, 1000));
        await msg.reply(respuesta);
        await chat.clearState();
    }
}

const initializeWhatsApp = async (io) => {
    const bot = new WhatsAppBot(io);
    await bot.inicializar();
};

module.exports = { initializeWhatsApp };