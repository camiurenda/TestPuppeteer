const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");
const { OpenAI } = require('openai');
const Projection = require('./models/projection.model');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function processMessage(msg) {
  try {
    const proyecciones = await Projection.find({ habilitado: true })
      .sort({ fechaHora: 1 })
      .limit(5);

    const contextoPeliculas = proyecciones.map(p => ({
      pelicula: p.nombrePelicula,
      cine: p.nombreCine,
      horario: new Date(p.fechaHora).toLocaleString(),
      genero: p.genero,
      director: p.director,
      precio: p.precio
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un asistente amigable de cine que ayuda a los usuarios que quieren saber que pelis hay para ver. 
                   Respondes de manera natural y concisa, usando emojis ocasionalmente. 
                   Si preguntan por la cartelera o películas disponibles, usa esta información: ${JSON.stringify(contextoPeliculas)}.
                   Puedes asistir con recomendaciones, dando mas informacion de la pelicula, etc. pero no puedes desviarte del tema del cine o la cartelera.
                   Declina amablemente y redirige la conversacion a la cartelera si esto pasa.`
        },
        { role: "user", content: msg.body }
      ],
      max_tokens: 150,
      temperature: 0.7
    });

    await msg.reply(response.choices[0].message.content);
  } catch (error) {
    console.error('Error al procesar mensaje:', error);
    await msg.reply('Disculpa, tuve un problema al procesar tu mensaje. ¿Podrías intentarlo de nuevo?');
  }
}



const initializeWhatsApp = async (io) => {
  let qrCode = null;
  let clientStatus = 'disconnected';

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
      qrCode = await qrcode.toDataURL(qr);
      io.emit('whatsappQR', { qrCode });
      console.log('Nuevo código QR generado');
    } catch (error) {
      console.error('Error al generar QR:', error);
      io.emit('error', { message: 'Error al generar código QR' });
    }
  });

  client.on('loading_screen', (percent, message) => {
    console.log('CARGANDO ->', percent, message);
    io.emit('whatsappStatus', { status: 'loading', percent, message });
  });

  client.on('authenticated', () => {
    clientStatus = 'authenticated';
    io.emit('whatsappStatus', { 
      status: clientStatus,
      message: '¡WhatsApp autenticado exitosamente!' 
    });
    console.log('AUTENTICADO');
  });

  client.on('auth_failure', (msg) => {
    clientStatus = 'auth_failure';
    io.emit('whatsappStatus', { 
      status: clientStatus,
      message: 'Falló la autenticación de WhatsApp' 
    });
    console.error('ERROR DE AUTENTICACIÓN:', msg);
  });

  client.on('ready', () => {
    clientStatus = 'ready';
    io.emit('whatsappStatus', { 
      status: clientStatus,
      message: '¡WhatsApp está listo!' 
    });
    console.log('CLIENTE LISTO');
  });

  client.on('disconnected', (reason) => {
    clientStatus = 'disconnected';
    io.emit('whatsappStatus', { 
      status: clientStatus,
      message: `WhatsApp desconectado: ${reason}` 
    });
    console.log('CLIENTE DESCONECTADO:', reason);
  });

  client.on('message', async (msg) => {
    console.log('MENSAJE RECIBIDO:', msg.body);
    await processMessage(msg);
  });

  io.on('connection', (socket) => {
    console.log('Nuevo cliente Socket.IO conectado');
    
    if (qrCode) {
      socket.emit('whatsappQR', { qrCode });
    }
    
    socket.emit('whatsappStatus', { 
      status: clientStatus,
      message: `Estado actual: ${clientStatus}` 
    });

    socket.on('requestQR', () => {
      if (qrCode) {
        socket.emit('whatsappQR', { qrCode });
      }
    });
  });

  try {
    await client.initialize();
  } catch (error) {
    console.error('Error al inicializar WhatsApp:', error);
    io.emit('error', { 
      message: 'Error al inicializar WhatsApp',
      error: error.message 
    });
  }
};

module.exports = { initializeWhatsApp };