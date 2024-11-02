const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'whatsappBot';

let db = null;

async function conectarDB() {
    if (db) return db;
    
    try {
        const cliente = new MongoClient(MONGODB_URI);
        await cliente.connect();
        
        db = cliente.db(DB_NAME);
        console.log('✅ Conexión exitosa a MongoDB');
        return db;
    } catch (error) {
        console.error('❌ Error al conectar a MongoDB:', error);
        throw error;
    }
}

module.exports = { conectarDB };