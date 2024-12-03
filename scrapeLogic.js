const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeSite = async (url) => {
    let browser = null;
    let page = null;
    
    console.log(`\n🔄 [${new Date().toISOString()}] Iniciando scraping para ${url}`);
    
    try {
        const browserConfig = {
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-software-rasterizer",
                "--disable-features=IsolateOrigins,site-per-process",
                "--ignore-certificate-errors"
            ],
            executablePath: process.env.NODE_ENV === "production"
                ? process.env.PUPPETEER_EXECUTABLE_PATH
                : puppeteer.executablePath(),
            headless: true,
            timeout: 60000
        };

        console.log('📊 Configuración del navegador:', JSON.stringify(browserConfig, null, 2));
        browser = await puppeteer.launch(browserConfig);
        
        console.log('🌐 Creando nueva página...');
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.resourceType() === 'document' || request.resourceType() === 'script') {
                request.continue();
            } else {
                request.abort();
            }
        });

        console.log('🔗 Navegando a la URL...');
        const response = await page.goto(url, {
            waitUntil: ['domcontentloaded', 'networkidle0'],
            timeout: 60000
        });

        console.log(`📡 Estado de respuesta: ${response.status()} ${response.statusText()}`);

        await page.waitForTimeout(5000);

        const contenidoHTML = await page.evaluate(() => {
            return {
                html: document.documentElement.outerHTML,
                stats: {
                    elementCount: document.getElementsByTagName('*').length,
                    bodyLength: document.body.innerHTML.length,
                    title: document.title
                }
            };
        });

        console.log('📦 Contenido extraído:', {
            longitud: contenidoHTML.html.length,
            elementos: contenidoHTML.stats.elementCount,
            titulo: contenidoHTML.stats.title
        });

        if (!contenidoHTML.html || contenidoHTML.html.length < 100) {
            throw new Error('Contenido HTML extraído no es válido o está vacío');
        }

        console.log('✅ Scraping completado exitosamente');
        return {
            success: true,
            data: contenidoHTML.html,
            stats: contenidoHTML.stats
        };

    } catch (error) {
        console.error('❌ Error en scraping:', {
            mensaje: error.message,
            stack: error.stack,
            url: url,
            timestamp: new Date().toISOString()
        });

        if (page) {
            try {
                const path = `error_${Date.now()}.png`;
                await page.screenshot({ 
                    path,
                    fullPage: true 
                });
                console.log(`📸 Screenshot guardado: ${path}`);
            } catch (screenshotError) {
                console.error('Error al guardar screenshot:', screenshotError);
            }
        }

        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };

    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('🔒 Navegador cerrado correctamente');
            } catch (error) {
                console.error('Error al cerrar el navegador:', error);
            }
        }
    }
};

const scrapeLogic = async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        console.log('⚠️ Error: URL no proporcionada');
        return res.status(400).json({
            success: false,
            error: "URL requerida"
        });
    }

    try {
        const resultado = await scrapeSite(url);
        res.json(resultado);

    } catch (error) {
        console.error('❌ Error en el controlador:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = { scrapeLogic };