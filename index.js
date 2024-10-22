const express = require('express');
const { scrapeLogic } = require('./scrapeLogic');

// Configuración de la aplicación
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware para parsear JSON
app.use(express.json());

// Middleware para logging básico
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware para manejo de CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Ruta de estado del servidor
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    mensaje: 'Servidor de scraping activo',
    rutas: {
      health: '/health - Estado del servidor',
      scrape: '/scrape - Ejecutar scraping'
    }
  });
});

// Ruta de scraping
app.get('/scrape', async (req, res) => {
  try {
    await scrapeLogic(res);
  } catch (error) {
    console.error('Error en la ruta de scraping:', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error interno del servidor',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Middleware para manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: true,
    mensaje: 'Ruta no encontrada'
  });
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    error: true,
    mensaje: 'Error interno del servidor',
    detalles: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`
========================================
  Servidor de Scraping
========================================
  Puerto: ${PORT}
  Ambiente: ${process.env.NODE_ENV || 'development'}
  Timestamp: ${new Date().toISOString()}
========================================
  `);
});

// Manejo de señales de terminación
process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Recibida señal SIGINT, cerrando servidor...');
  process.exit(0);
});