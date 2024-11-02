const mongoose = require('mongoose');

// Mostrar el URI en los logs
console.log('URI de conexión:', process.env.MONGO_DB_URI);

const conectarDB = async () => {
    try {
        if (!process.env.MONGO_DB_URI) {
            throw new Error('La variable de entorno MONGO_DB_URI no está definida');
        }

        // Conectar a MongoDB con una configuración mínima
        await mongoose.connect(process.env.MONGO_DB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('Conexión exitosa a MongoDB');
    } catch (error) {
        console.error('=== Error de Conexión ===');
        console.error('Tipo:', error.name);
        console.error('Mensaje:', error.message);
        process.exit(1);
    }
};

module.exports = conectarDB;
