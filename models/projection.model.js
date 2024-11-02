const mongoose = require('mongoose');

const ProjectionSchema = new mongoose.Schema({
  nombrePelicula: {
    type: String,
    required: true,
  },
  fechaHora: {
    type: Date,
    required: true,
  },
  director: {
    type: String,
    default: 'No especificado',
  },
  genero: {
    type: String,
    default: 'No especificado',
  },
  duracion: {
    type: Number,
    default: 0,
  },
  sala: {
    type: String,
    default: '',
  },
  precio: {
    type: Number,
    default: 0,
  },
  habilitado: {
    type: Boolean,
    default: true,
  },
  fechaCreacion: {
    type: Date,
    default: Date.now,
  },
  cargaManual: {
    type: Boolean,
    default: false,
  },
  sitio: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sites',
    required: true,
  },
  nombreCine: {
    type: String,
    required: true,
  },
  claveUnica: {
    type: String,
    unique: true,
    required: true,
  }
});

ProjectionSchema.index({ nombrePelicula: 1, fechaHora: 1, sitio: 1 }, { unique: true });

ProjectionSchema.methods.generarClaveUnica = function() {
  return `${this.nombrePelicula}-${this.fechaHora.toISOString()}-${this.sitio}`;
};

ProjectionSchema.pre('save', async function(next) {
  if (!this.claveUnica) {
    this.claveUnica = this.generarClaveUnica();
  }
  if (!this.nombreCine && this.sitio) {
    const site = await mongoose.model('Sites').findById(this.sitio);
    if (site) {
      this.nombreCine = site.nombre;
    }
  }
  next();
});

module.exports = mongoose.model('Projection', ProjectionSchema);