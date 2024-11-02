const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");
const axios = require('axios');

const SERVIDOR_PRINCIPAL = 'https://filmfetcher.onrender.com';

const inicializarWhatsApp = async (io) => {
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
        if (msg.body.toLowerCase() === '!cartelera') {
            try {
                // Obtener películas del servidor principal
                const response = await axios.get(`${SERVIDOR_PRINCIPAL}/api/projections/proyecciones-actuales`);
                const peliculas = response.data;

                if (!peliculas.length) {
                    await msg.reply('No hay películas en cartelera en este momento.');
                    return;
                }

                // Crear mensaje de respuesta
                let respuesta = '*🎬 CARTELERA ACTUAL 🎬*\n\n';
                
                peliculas.forEach(pelicula => {
                    const fecha = new Date(pelicula.fechaHora).toLocaleString('es-AR', {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    respuesta += `*${pelicula.nombreCine}*\n`;
                    respuesta += `🎥 ${pelicula.nombrePelicula}\n`;
                    respuesta += `📅 ${fecha}\n`;
                    if (pelicula.sala) respuesta += `🏛️ Sala: ${pelicula.sala}\n`;
                    if (pelicula.precio) respuesta += `💰 Precio: $${pelicula.precio}\n`;
                    respuesta += '\n';
                });

                await msg.reply(respuesta);
            } catch (error) {
                console.error('Error al obtener cartelera:', error);
                await msg.reply('Lo siento, hubo un error al obtener la cartelera.');
            }
        }
    });

    try {
        await client.initialize();
    } catch (error) {
        console.error('Error al inicializar WhatsApp:', error);
        io.emit('error', { message: 'Error al inicializar WhatsApp' });
    }
};

module.exports = { inicializarWhatsApp };