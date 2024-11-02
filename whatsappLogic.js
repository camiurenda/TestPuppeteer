const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require("puppeteer");

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

    switch(msg.body.toLowerCase()) {
      case '!ping':
        await msg.reply('pong');
        break;
      case '!status':
        await msg.reply(`Estado actual: ${clientStatus}`);
        break;
      case '!help':
        await msg.reply('Comandos disponibles:\n!ping - Prueba de conexión\n!status - Ver estado actual');
        break;
    }
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