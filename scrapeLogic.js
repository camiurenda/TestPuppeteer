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
    
    // Configurar timeouts
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(60000);
    
    console.log(`[Microservicio] Navegando a ${url}`);
    await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 60000
    });

    // Esperar un momento adicional
    await page.waitForTimeout(5000);

    console.log(`[Microservicio] Extrayendo contenido HTML`);
    const contenidoHTML = await page.evaluate(() => document.documentElement.outerHTML);
    
    if (!contenidoHTML) {
      throw new Error('Contenido HTML vacío');
    }

    console.log(`[Microservicio] Contenido HTML obtenido, longitud: ${contenidoHTML.length}`);
    
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

    return {
      success: false,
      error: error.message,
      details: error.stack,
      status: 'error'
    };

  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('[Microservicio] Navegador cerrado correctamente');
      } catch (error) {
        console.error('[Microservicio] Error al cerrar el navegador:', error);
      }
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
    
    if (!resultado.data && resultado.success) {
      return res.status(500).json({
        success: false,
        error: "No se pudo obtener el contenido HTML",
        status: 'error'
      });
    }
    
    res.json(resultado);
  } catch (error) {
    console.error('[Microservicio] Error en el controlador:', error);
    res.status(500).json({
      success: false,
      error: "Error en el servicio de scraping",
      details: error.stack,
      status: 'error'
    });
  }
};

module.exports = { scrapeLogic };