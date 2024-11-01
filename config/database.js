const mongoose = require('mongoose');

const conectarDB = async () => {
    try {
        console.log('=== Información de conexión ===');
        console.log('URI existe:', process.env.MONGO_DB_URI ? 'Sí' : 'No');
        console.log('Ambiente:', process.env.NODE_ENV || 'development');

        if (!process.env.MONGO_DB_URI) {
            throw new Error('La variable de entorno MONGO_DB_URI no está definida');
        }

        const opciones = {
            retryWrites: true,
            w: 'majority',
            connectTimeoutMS: 30000,
            socketTimeoutMS: 30000,
            serverSelectionTimeoutMS: 30000,
            heartbeatFrequencyMS: 2000,
            maxPoolSize: 10,
            minPoolSize: 5,
            maxIdleTimeMS: 10000,
            keepAlive: true,
            tls: true,
            ssl: true,
        };

        await mongoose.connect(process.env.MONGO_DB_URI, opciones);
        console.log('Conexión exitosa a MongoDB');

        // Manejadores de eventos de conexión
        mongoose.connection.on('error', (err) => {
            console.error('Error en la conexión de MongoDB:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB desconectado. Intentando reconectar...');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('MongoDB reconectado exitosamente');
        });

        // Manejo de cierre graceful
        const cerrarConexion = async () => {
            try {
                await mongoose.connection.close();
                console.log('Conexión a MongoDB cerrada correctamente');
                process.exit(0);
            } catch (err) {
                console.error('Error al cerrar la conexión:', err);
                process.exit(1);
            }
        };

        // Manejar señales de terminación
        process.on('SIGTERM', cerrarConexion);
        process.on('SIGINT', cerrarConexion);

    } catch (error) {
        console.error('=== Error de Conexión ===');
        console.error('Tipo:', error.name);
        console.error('Mensaje:', error.message);
        process.exit(1);
    }
};

module.exports = conectarDB;