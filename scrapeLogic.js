const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeSite = async (url) => {
    let browser = null;
    let page = null;

    try {
        console.log(`\n🤖 [Microservicio] INICIO SCRAPING URL: ${url}`);
        console.log('🌐 [Microservicio] Configurando navegador...');
    
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

    console.log('✅ [Microservicio] Navegador iniciado correctamente');
    page = await browser.newPage();
    
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(60000);

    // Capturar logs de consola
    page.on('console', msg => {
      console.log(`📝 [Microservicio] Console ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', error => {
      console.error('❌ [Microservicio] Error en página:', error.message);
  });

  page.on('requestfailed', request => {
      console.error('⚠️ [Microservicio] Recurso fallido:', {
          url: request.url(),
          errorText: request.failure().errorText,
          method: request.method()
      });
  });
    
  console.log('🔄 [Microservicio] Navegando a la URL...');
  const response = await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 60000
  });

  console.log('📊 [Microservicio] Estado de respuesta:', {
      status: response.status(),
      statusText: response.statusText(),
      contentType: response.headers()['content-type']
  });

  console.log('⏳ [Microservicio] Esperando contenido dinámico...');
  await page.waitForTimeout(5000);

    // Obtener métricas de la página
    const metrics = await page.metrics();
        console.log('📈 [Microservicio] Métricas de página:', {
            memoria: Math.round(metrics.JSHeapUsedSize / 1024 / 1024) + 'MB',
            nodos: metrics.Nodes,
            tiempoScript: Math.round(metrics.ScriptDuration * 1000) + 'ms'
        });

        console.log('🔍 [Microservicio] Extrayendo contenido HTML...');
        const contenidoHTML = await page.evaluate(() => {
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

    console.log('📊 [Microservicio] Estadísticas del contenido:', {
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
    console.error('❌ [Microservicio] Error en scraping:', {
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
      console.log(`🍪 [Microservicio] Cookies encontradas: ${cookies.length}`);
    }

    if (browser) {
      try {
        await browser.close();
                console.log('✅ [Microservicio] Navegador cerrado correctamente');
            } catch (error) {
                console.error('❌ [Microservicio] Error al cerrar navegador:', error);
            }
        }
        console.log('🤖 [Microservicio] FIN SCRAPING\n');
  }
};

const scrapeLogic = async (req, res) => {
  const { url } = req.body;
  const source = req.get('X-Source');
  
  console.log('\n🔄 [Microservicio] Nueva solicitud de scraping:', {
      url,
      source,
      headers: req.headers
  });

  if (!url) {
      console.log('❌ [Microservicio] Error: URL no proporcionada');
      return res.status(400).json({
          success: false,
          error: "URL requerida",
          status: 'error'
      });
  }

  try {
      const resultado = await scrapeSite(url);
      
      console.log('📊 [Microservicio] Resultado del scraping:', {
          success: resultado.success,
          contentLength: resultado.data?.length || 0,
          stats: resultado.stats
      });
      
      res.json(resultado);
  } catch (error) {
      console.error('❌ [Microservicio] Error en el controlador:', {
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
