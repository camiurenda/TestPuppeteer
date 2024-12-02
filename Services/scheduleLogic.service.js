const TimerManager = require('./timerManager.service');

class ScheduleLogic {
    constructor() {
        this.jobs = new Map();
    }

    agregarSchedule(scheduleConfig) {
        const { id, proximaEjecucion, url } = scheduleConfig;
        console.log(`[Microservicio] Agregando schedule ${id} para ${url}`);

        const ejecutarScraping = async () => {
            try {
                console.log(`[Microservicio] Ejecutando scraping para ${url}`);
                await this.notificarEstado(id, 'ejecutando');
                
                const resultado = await this.ejecutarScraping(url);
                await this.notificarResultado(id, resultado);
                
                return resultado;
            } catch (error) {
                console.error(`[Microservicio] Error en scraping de ${url}:`, error);
                await this.notificarError(id, error);
                throw error;
            }
        };

        this.jobs.set(id, {
            config: scheduleConfig,
            lastRun: null
        });

        TimerManager.agregarTimer(id, ejecutarScraping, new Date(proximaEjecucion));
        
        return {
            id,
            status: 'programado',
            proximaEjecucion
        };
    }

    async ejecutarScraping(url) {
        try {
            const response = await fetch(url);
            return await response.text();
        } catch (error) {
            console.error('Error en scraping:', error);
            throw error;
        }
    }

    async notificarEstado(id, estado) {
        try {
            await fetch(`${process.env.MAIN_SERVER_URL}/api/schedule-callback/estado`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Key': process.env.SERVICE_KEY
                },
                body: JSON.stringify({ id, estado })
            });
        } catch (error) {
            console.error('Error al notificar estado:', error);
        }
    }

    async notificarResultado(id, resultado) {
        try {
            await fetch(`${process.env.MAIN_SERVER_URL}/api/schedule-callback/resultado`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Key': process.env.SERVICE_KEY
                },
                body: JSON.stringify({ id, resultado })
            });
        } catch (error) {
            console.error('Error al notificar resultado:', error);
        }
    }

    async notificarError(id, error) {
        try {
            await fetch(`${process.env.MAIN_SERVER_URL}/api/schedule-callback/error`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Key': process.env.SERVICE_KEY
                },
                body: JSON.stringify({ 
                    id, 
                    error: error.message,
                    timestamp: new Date()
                })
            });
        } catch (error) {
            console.error('Error al notificar error:', error);
        }
    }

    cancelarSchedule(id) {
        console.log(`[Microservicio] Cancelando schedule ${id}`);
        TimerManager.limpiarTimer(id);
        this.jobs.delete(id);
        return { id, status: 'cancelado' };
    }

    obtenerEstado(id) {
        const job = this.jobs.get(id);
        if (!job) {
            return { id, status: 'no_encontrado' };
        }

        return {
            id,
            status: TimerManager.estaActivo(id) ? 'ejecutando' : 'programado',
            config: job.config,
            lastRun: job.lastRun
        };
    }

    obtenerTodos() {
        const jobs = [];
        for (const [id, job] of this.jobs) {
            jobs.push({
                id,
                status: TimerManager.estaActivo(id) ? 'ejecutando' : 'programado',
                config: job.config,
                lastRun: job.lastRun
            });
        }
        return jobs;
    }
}

module.exports = new ScheduleLogic();