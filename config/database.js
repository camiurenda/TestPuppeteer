const mongoose = require('mongoose');

const conectarDB = async () => {
    try {
        console.log('=== Información de conexión ===');
        console.log('URI existe:', process.env.MONGO_DB_URI ? 'Sí' : 'No');
        console.log('Ambiente:', process.env.NODE_ENV);
        console.log('Puerto:', process.env.PORT);

        if (!process.env.MONGO_DB_URI) {
            throw new Error('La variable de entorno MONGO_DB_URI no está definida');
        }

        const opciones = {
            retryWrites: true,
            w: 'majority',
            serverSelectionTimeoutMS: 5000,  // Timeout más corto para pruebas
            socketTimeoutMS: 45000,          // Timeout de socket más largo
        };

        await mongoose.connect(process.env.MONGO_DB_URI, opciones);

        console.log('Conexión exitosa a MongoDB');
        console.log('Base de datos:', mongoose.connection.name);
        console.log('Host:', mongoose.connection.host);

        mongoose.connection.on('error', (err) => {
            console.error('Error en la conexión de MongoDB:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB desconectado. Intentando reconectar...');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('MongoDB reconectado exitosamente');
        });

        process.on('SIGINT', async () => {
            try {
                await mongoose.connection.close();
                console.log('Conexión a MongoDB cerrada por terminación de la aplicación');
                process.exit(0);
            } catch (err) {
                console.error('Error al cerrar la conexión de MongoDB:', err);
                process.exit(1);
            }
        });

    } catch (error) {
        console.error('=== Error de Conexión ===');
        console.error('Tipo:', error.name);
        console.error('Mensaje:', error.message);
        console.error('Stack:', error.stack);
        if (error.cause) console.error('Causa:', error.cause);
        process.exit(1);
    }
};

module.exports = conectarDB;