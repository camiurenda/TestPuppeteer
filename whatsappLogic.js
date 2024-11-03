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

let carteleraCache = {
    peliculas: [],
    lastUpdate: null
};

async function actualizarCarteleraCache() {
    try {
        if (!carteleraCache.lastUpdate || 
            Date.now() - carteleraCache.lastUpdate > 5 * 60 * 1000) {
            const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`);
            carteleraCache.peliculas = response.data;
            carteleraCache.lastUpdate = Date.now();
        }
        return carteleraCache.peliculas;
    } catch (error) {
        console.error('Error al actualizar caché de cartelera:', error);
        throw error;
    }
}

async function procesarMensajeIA(mensaje, peliculas) {
    const contextoPeliculas = peliculas.map(p => {
        const fecha = new Date(p.fechaHora).toLocaleString('es-AR', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
        return `${p.nombrePelicula} en ${p.nombreCine} el ${fecha} a $${p.precio || 'precio no disponible'}`;
    }).join('. ');

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un asistente amigable y conversacional especializado en cine y la cartelera actual.
                    Debes responder de manera natural y cercana, como si fueras un amigo que conoce muy bien el cine.
                    
                    Información actual de la cartelera:
                    ${contextoPeliculas}
                    
                    Pautas importantes:
                    - Si te preguntan por una película que no está en cartelera, menciona que no está disponible actualmente
                    - Siempre incluye los horarios y precios cuando sean relevantes para la consulta
                    - Si te preguntan por recomendaciones, considera los horarios disponibles
                    - Usa emojis ocasionalmente para hacer la conversación más amena y divertida
                    - Si no entiendes la consulta, pide amablemente una aclaración
                    - Si te preguntan por algo no relacionado con películas o la cartelera, responde que solo puedes ayudar con temas de cine`
                },
                {
                    role: "user",
                    content: mensaje
                }
            ],
            max_tokens: 500,
            temperature: 0.8
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error al procesar mensaje con IA:', error);
        return 'Disculpa, estoy teniendo algunos problemas técnicos. ¿Podrías intentarlo de nuevo en un momento? 🤔';
    }
}

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

    client.on('qr', async (qr) => {
        try {
            const qrCode = await qrcode.toDataURL(qr);
            io.emit('whatsappQR', { qrCode });
            console.log('Nuevo código QR generado');
        } catch (error) {
            console.error('Error al generar QR:', error);
        }
    });

    client.on('ready', () => {
        console.log('Cliente WhatsApp listo');
        io.emit('whatsappStatus', { 
            status: 'ready',
            message: '¡WhatsApp está listo!' 
        });
    });

    client.on('message', async (msg) => {
        if (msg.isGroupMsg) return;
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();

            const peliculas = await actualizarCarteleraCache();
            const respuesta = await procesarMensajeIA(msg.body, peliculas);

            await new Promise(resolve => setTimeout(resolve, 1500));
            
            await msg.reply(respuesta);
            await chat.clearState();
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            await msg.reply('Disculpa, estoy teniendo algunos problemas técnicos. ¿Podrías intentarlo de nuevo en un momento? 🤔');
        }
    });

    try {
        await client.initialize();
    } catch (error) {
        console.error('Error al inicializar WhatsApp:', error);
        io.emit('error', { message: 'Error al inicializar WhatsApp' });
    }
};

module.exports = { initializeWhatsApp };