const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeSite = async (url) => {
  let browser = null;
  let page = null;
  
  try {
    console.log(`[Microservicio] Iniciando scraping de ${url}`);
    console.log('[Microservicio] Configurando navegador...');
    
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

    console.log('[Microservicio] Navegador iniciado correctamente');
    console.log('[Microservicio] Creando nueva página...');
    
    page = await browser.newPage();
    
    // Configurar timeouts
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(60000);

    // Capturar logs de consola
    page.on('console', msg => {
      console.log(`[Microservicio] Console ${msg.type()}: ${msg.text()}`);
    });

    // Capturar errores de red
    page.on('pageerror', error => {
      console.error('[Microservicio] Error en página:', error.message);
    });

    // Capturar errores de recursos
    page.on('requestfailed', request => {
      console.error('[Microservicio] Recurso fallido:', {
        url: request.url(),
        errorText: request.failure().errorText,
        method: request.method()
      });
    });
    
    console.log(`[Microservicio] Navegando a ${url}`);
    console.log('[Microservicio] Esperando carga de página...');

    const response = await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 60000
    });

    console.log('[Microservicio] Estado de respuesta:', {
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers()
    });

    // Esperar un momento adicional
    console.log('[Microservicio] Esperando 5 segundos adicionales para contenido dinámico...');
    await page.waitForTimeout(5000);

    // Obtener métricas de la página
    const metrics = await page.metrics();
    console.log('[Microservicio] Métricas de página:', {
      JSHeapUsedSize: Math.round(metrics.JSHeapUsedSize / 1024 / 1024) + 'MB',
      Nodes: metrics.Nodes,
      ScriptDuration: Math.round(metrics.ScriptDuration * 1000) + 'ms'
    });

    console.log('[Microservicio] Extrayendo contenido HTML...');
    const contenidoHTML = await page.evaluate(() => {
      // Contar elementos por tipo
      const elementCounts = {};
      document.querySelectorAll('*').forEach(element => {
        const tag = element.tagName.toLowerCase();
        elementCounts[tag] = (elementCounts[tag] || 0) + 1;
      });
      
      return {
        html: document.documentElement.outerHTML,
        stats: {
          elementCounts,
          totalElements: document.getElementsByTagName('*').length,
          bodyLength: document.body.innerHTML.length
        }
      };
    });
    
    if (!contenidoHTML.html) {
      throw new Error('Contenido HTML vacío');
    }

    console.log('[Microservicio] Estadísticas del contenido HTML:', {
      longitudTotal: contenidoHTML.html.length,
      elementosTotales: contenidoHTML.stats.totalElements,
      longitudBody: contenidoHTML.stats.bodyLength,
      elementosPorTipo: contenidoHTML.stats.elementCounts
    });
    
    return {
      success: true,
      data: contenidoHTML.html,
      stats: contenidoHTML.stats,
      status: 'ok'
    };

  } catch (error) {
    console.error('[Microservicio] Error en scraping:', {
      url: url,
      error: error.message,
      stack: error.stack,
      phase: browser ? (page ? 'contenido' : 'página') : 'navegador'
    });

    return {
      success: false,
      error: error.message,
      details: error.stack,
      status: 'error'
    };

  } finally {
    if (page) {
      const cookies = await page.cookies();
      console.log(`[Microservicio] Cookies encontradas: ${cookies.length}`);
    }

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
  console.log('[Microservicio] Headers recibidos:', req.headers);

  if (!url) {
    console.log('[Microservicio] Error: URL no proporcionada');
    return res.status(400).json({
      success: false,
      error: "URL requerida",
      status: 'error'
    });
  }

  try {
    console.log(`[Microservicio] Recibida petición de scraping para: ${url}`);
    console.log('[Microservicio] Iniciando proceso de scraping...');
    
    const resultado = await scrapeSite(url);
    
    if (!resultado.data && resultado.success) {
      console.error('[Microservicio] Error: No se obtuvo contenido HTML a pesar del éxito');
      return res.status(500).json({
        success: false,
        error: "No se pudo obtener el contenido HTML",
        status: 'error'
      });
    }
    
    console.log('[Microservicio] Scraping completado exitosamente:', {
      success: resultado.success,
      contentLength: resultado.data?.length || 0,
      stats: resultado.stats
    });
    
    res.json(resultado);
  } catch (error) {
    console.error('[Microservicio] Error en el controlador:', {
      error: error.message,
      stack: error.stack,
      url: url
    });
    
    res.status(500).json({
      success: false,
      error: "Error en el servicio de scraping",
      details: error.stack,
      status: 'error'
    });
  }
};

module.exports = { scrapeLogic };
