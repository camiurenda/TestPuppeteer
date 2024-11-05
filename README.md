# 🎬 Chatbot de WhatsApp para FilmFetcher

Bot de WhatsApp que proporciona información sobre proyecciones cinematográficas en CABA, asistido por IA. Parte del proyecto "FilmFetcher" para el colectivo artístico Sigilio.

## 🌟 Características

- 🤖 Bot de WhatsApp completamente funcional
- 🎭 Integración con GPT-4 para respuestas naturales
- 🎫 Información actualizada de cartelera
- 🔍 Detalles de películas vía TMDB API
- 📊 Panel de control web para gestión
- 🔐 Autenticación mediante Auth0

## 🛠️ Tecnologías

- Node.js
- Express
- Socket.IO
- OpenAI GPT-4
- whatsapp-web.js
- Puppeteer
- Docker
- Auth0

## 📋 Prerrequisitos

- Node.js ≥ 16.0.0
- Docker
- NPM o Yarn
- Cuenta de Auth0
- API Key de OpenAI
- API Key de TMDB

## 📱 Funcionalidades del Bot

- Consulta de películas en cartelera
- Información detallada de películas
- Recomendaciones personalizadas
- Búsqueda por género, cine o horario
- Conversaciones contextuales

## 🐳 Docker

El proyecto usa una imagen especial de Puppeteer:
```dockerfile
FROM ghcr.io/puppeteer/puppeteer:19.7.2
```

Incluye todas las dependencias necesarias para ejecutar Chrome headless.

## 👾 Issues Conocidos

- La conexión de WhatsApp debe renovarse periódicamente
- Límites en las consultas a APIs externas
- El QR debe escanearse después de cada reinicio
