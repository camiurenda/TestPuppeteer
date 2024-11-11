const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeLogic = async (res) => {
  // Inicialización del navegador con configuraciones de seguridad
  const browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",  // Deshabilita el sandbox para entornos sin privilegios
      "--no-sandbox",             // Modo sin sandbox para contenedores
      "--single-process",         // Ejecuta Chrome en un solo proceso
      "--no-zygote",             // Deshabilita el proceso zygote
    ],
    // Usa el ejecutable de Chrome según el entorno
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
  });

  try {
    console.log("Iniciando scraping de books.toscrape.com...");
    const page = await browser.newPage();
    
    // Navega a la página y espera a que se carguen todos los recursos
    await page.goto("https://books.toscrape.com/", {
      waitUntil: 'networkidle0',  // Espera hasta que no haya conexiones de red por 500ms
      timeout: 30000              // Timeout de 30 segundos
    });

    console.log("Página cargada, buscando el mensaje...");
    
    // Ejecuta JavaScript en el contexto de la página para extraer el texto
    const welcomeMessage = await page.evaluate(() => {
      const smallElement = document.querySelector('small');
      return smallElement ? smallElement.textContent : null;
    });

    // Procesa y envía el resultado
    if (welcomeMessage) {
      console.log("Mensaje encontrado:", welcomeMessage);
      res.send(`Mensaje extraído: ${welcomeMessage}`);
    } else {
      throw new Error("No se pudo encontrar el elemento <small>");
    }

  } catch (e) {
    // Manejo de errores durante el scraping
    console.error("Error durante el scraping:", e);
    res.send(`Ocurrió un error: ${e.message}`);
  } finally {
    // Asegura que el navegador se cierre incluso si hay errores
    await browser.close();
  }
};

module.exports = { scrapeLogic };