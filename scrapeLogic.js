const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeSite = async (url) => {
  let browser = null;
  
  try {
    console.log(`[Microservicio] Iniciando scraping de ${url}`);
    
    browser = await puppeteer.launch({
      args: [
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",
      ],
      executablePath:
        process.env.NODE_ENV === "production"
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : puppeteer.executablePath(),
    });

    const page = await browser.newPage();
    
    // Configurar interceptor de errores
    page.on('error', err => {
      console.error(`[Microservicio] Error en la página:`, err);
    });

    page.on('pageerror', err => {
      console.error(`[Microservicio] Error de javascript:`, err);
    });

    console.log(`[Microservicio] Navegando a ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    if (!response.ok()) {
      throw new Error(`Error HTTP ${response.status()}: ${response.statusText()}`);
    }

    console.log(`[Microservicio] Extrayendo contenido HTML`);
    const contenidoHTML = await page.content();
    
    if (!contenidoHTML || contenidoHTML.trim().length === 0) {
      throw new Error('Contenido HTML vacío');
    }

    await browser.close();
    browser = null;

    console.log(`[Microservicio] Scraping exitoso para ${url}`);
    return {
      success: true,
      data: contenidoHTML,
      status: 'ok'
    };

  } catch (error) {
    console.error('[Microservicio] Error en scraping:', {
      url: url,
      error: error.message,
      stack: error.stack
    });

    let mensajeError = 'Error al acceder a la página';
    if (error.name === 'TimeoutError') {
      mensajeError = 'Tiempo de espera agotado al cargar la página';
    } else if (error.message.includes('net::')) {
      mensajeError = 'Error de red al acceder a la página';
    }

    return {
      success: false,
      error: mensajeError,
      details: error.message,
      status: 'error'
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const scrapeLogic = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL requerida",
      status: 'error'
    });
  }

  try {
    console.log(`[Microservicio] Recibida petición de scraping para: ${url}`);
    const resultado = await scrapeSite(url);
    res.json(resultado);
  } catch (error) {
    console.error('[Microservicio] Error en el controlador:', error);
    res.status(500).json({
      success: false,
      error: "Error en el servicio de scraping",
      details: error.message,
      status: 'error'
    });
  }
};

module.exports = { scrapeLogic };