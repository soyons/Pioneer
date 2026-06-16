// 服务状态监控 - 每 2 秒轮询 /api/services/status,更新三灯
const ServicesMonitor = {
    intervalMs: 2000,
    timer: null,

    async pollOnce() {
        try {
            const data = await api.getServicesStatus();
            this.render(data.services || {});
        } catch (e) {
            console.warn('Failed to fetch services status:', e);
            // 把所有灯标为 offline
            this.render({
                camera: { online: false, error: 'Console offline' },
                teleop: { online: false, error: 'Console offline' },
                robot:  { online: false, error: 'Console offline' },
            });
        }
    },

    render(services) {
        Object.entries(services).forEach(([key, status]) => {
            const el = document.querySelector(`.service-light[data-service="${key}"]`);
            if (!el) return;

            el.classList.remove('online', 'offline');
            el.classList.add(status.online ? 'online' : 'offline');

            // tooltip 显示详细状态
            const parts = [];
            parts.push(`${status.name || key}: ${status.online ? '在线' : '离线'}`);
            if (status.response_time_ms !== null && status.response_time_ms !== undefined) {
                parts.push(`延迟: ${status.response_time_ms.toFixed(0)}ms`);
            }
            if (status.error) {
                parts.push(`错误: ${status.error}`);
            }
            if (status.last_check) {
                const t = new Date(status.last_check);
                parts.push(`最后检查: ${t.toLocaleTimeString()}`);
            }
            el.title = parts.join('\n');
        });
    },

    start() {
        this.pollOnce();  // 立即执行一次
        this.timer = setInterval(() => this.pollOnce(), this.intervalMs);
    },

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },
};

document.addEventListener('DOMContentLoaded', () => {
    ServicesMonitor.start();
});
