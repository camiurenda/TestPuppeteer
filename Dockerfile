FROM ghcr.io/socialgouv/docker/puppeteer-mongo-pg:5.0.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

WORKDIR /usr/src/app

# Copiar solo package.json y package-lock.json
COPY package*.json ./

# Limpiar cache de npm y hacer instalación limpia
RUN npm cache clean --force && \
    npm install --production --no-optional && \
    npm cache clean --force

# Copiar el resto del código
COPY . .

EXPOSE 4000

CMD ["node", "index.js"]