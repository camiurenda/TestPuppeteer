const mongoose = require('mongoose');

const conectarDB = async () => {
    try {
        if (!process.env.MONGO_DB_URI) {
            throw new Error('La variable de entorno MONGO_DB_URI no está definida');
        }

        const opciones = {
            retryWrites: true,
            w: 'majority'
        };

        await mongoose.connect(process.env.MONGO_DB_URI, opciones);

        console.log('Conexión exitosa a MongoDB');

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
        console.error('Error al conectar a MongoDB:', error);
        process.exit(1);
    }
};

module.exports = conectarDB;