const puppeteer = require("puppeteer");
require("dotenv").config();

const scrapeLogic = async (res) => {
  const browser = await puppeteer.launch({
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
  try {
    console.log("Iniciando scraping de books.toscrape.com...");
    const page = await browser.newPage();
    
    // Navegar a la página
    await page.goto("https://books.toscrape.com/", {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    console.log("Página cargada, buscando el mensaje...");
    
    // Obtener el texto dentro de <small>
    const welcomeMessage = await page.evaluate(() => {
      const smallElement = document.querySelector('small');
      return smallElement ? smallElement.textContent : null;
    });

    if (welcomeMessage) {
      console.log("Mensaje encontrado:", welcomeMessage);
      res.send(`Mensaje extraído: ${welcomeMessage}`);
    } else {
      throw new Error("No se pudo encontrar el elemento <small>");
    }

  } catch (e) {
    console.error("Error durante el scraping:", e);
    res.send(`Ocurrió un error: ${e.message}`);
  } finally {
    await browser.close();
  }
};

module.exports = { scrapeLogic };