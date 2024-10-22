const puppeteer = require('puppeteer');
require('dotenv').config();

/**
 * Configuración de opciones de lanzamiento para Puppeteer
 * @returns {Object} Objeto de configuración para el lanzamiento del navegador
 */
const getPuppeteerOptions = () => {
  const defaultOptions = {
    args: [
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--single-process',
      '--no-zygote',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu'
    ],
    headless: 'new',
    defaultViewport: { width: 1080, height: 1024 },
    ignoreHTTPSErrors: true,
    timeout: 30000
  };

  // Configuración específica según el entorno
  if (process.env.NODE_ENV === 'production') {
    return {
      ...defaultOptions,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
    };
  }

  // En desarrollo, usar el Chrome incluido con Puppeteer
  return {
    ...defaultOptions,
    executablePath: undefined // Puppeteer usará su Chrome bundled
  };
};

/**
 * Realiza el web scraping de una página
 * @param {Object} res - Objeto de respuesta Express
 * @returns {Promise<void>}
 */
const scrapeLogic = async (res) => {
  let browser = null;

  try {
    console.log('Iniciando proceso de scraping...');
    const options = getPuppeteerOptions();
    console.log('Opciones de configuración:', JSON.stringify(options, null, 2));

    browser = await puppeteer.launch(options);
    console.log('Navegador iniciado correctamente');

    const page = await browser.newPage();
    console.log('Nueva página creada');

    // Configurar timeouts y manejo de errores de red
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);

    // Interceptar y manejar errores de red
    page.on('error', err => {
      console.error('Error en la página:', err);
    });

    console.log('Navegando a la página objetivo...');
    await page.goto('https://developer.chrome.com/', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Esperar a que el campo de búsqueda esté disponible
    const searchFieldSelector = '.devsite-search-field';
    await page.waitForSelector(searchFieldSelector, { 
      visible: true, 
      timeout: 5000 
    });
    console.log('Campo de búsqueda encontrado');

    // Usar type en lugar de fill para ingresar texto
    await page.type(searchFieldSelector, 'automate beyond recorder');
    console.log('Texto de búsqueda ingresado');

    // Esperar a que aparezcan los resultados
    const resultSelector = '.devsite-result-item-link';
    await page.waitForSelector(resultSelector, { 
      visible: true, 
      timeout: 5000 
    });

    // Hacer clic en el primer resultado usando click()
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click(resultSelector)
    ]);
    console.log('Clic en el primer resultado realizado');

    // Buscar el título del artículo usando evaluación de página
    const titleContent = await page.evaluate(() => {
      const element = document.querySelector('h1, h2, h3');
      return element ? element.textContent : 'Título no encontrado';
    });

    const resultado = {
      titulo: titleContent.trim(),
      timestamp: new Date().toISOString(),
      estado: 'éxito',
      url: page.url()
    };

    console.log('Scraping completado:', resultado);
    res.json(resultado);

  } catch (error) {
    console.error('Error durante el scraping:', error);
    
    const errorResponse = {
      error: true,
      mensaje: error.message,
      timestamp: new Date().toISOString(),
      detalles: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };

    res.status(500).json(errorResponse);

  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Navegador cerrado correctamente');
      } catch (error) {
        console.error('Error al cerrar el navegador:', error);
      }
    }
  }
};

module.exports = { scrapeLogic };