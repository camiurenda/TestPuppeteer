// Services/timerManager.js
class TimerManager {
    constructor() {
        this.timers = new Map();
        this.activeJobs = new Set();
    }

    agregarTimer(id, callback, fecha) {
        this.limpiarTimer(id);
        
        const ahora = new Date();
        const delay = fecha.getTime() - ahora.getTime();
        
        if (delay <= 0) {
            console.log(`[Microservicio] Timer ${id}: Ejecución inmediata`);
            callback();
            return;
        }

        console.log(`[Microservicio] Timer ${id}: Programado para ${fecha.toLocaleString('es-AR')}`);
        
        const timerId = setTimeout(() => {
            this.activeJobs.add(id);
            callback()
                .catch(error => console.error(`[Microservicio] Error en ejecución del timer ${id}:`, error))
                .finally(() => {
                    this.activeJobs.delete(id);
                    this.timers.delete(id);
                });
        }, delay);

        this.timers.set(id, timerId);
    }

    limpiarTimer(id) {
        if (this.timers.has(id)) {
            clearTimeout(this.timers.get(id));
            this.timers.delete(id);
            console.log(`[Microservicio] Timer ${id}: Eliminado`);
        }
    }

    estaActivo(id) {
        return this.activeJobs.has(id);
    }

    limpiarTodo() {
        console.log('[Microservicio] Limpiando todos los timers...');
        for (const [id, timerId] of this.timers.entries()) {
            clearTimeout(timerId);
            console.log(`[Microservicio] Timer ${id}: Eliminado`);
        }
        this.timers.clear();
        this.activeJobs.clear();
    }
}

module.exports = new TimerManager();