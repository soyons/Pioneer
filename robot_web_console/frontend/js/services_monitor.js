// 服务状态监控 - 每 2 秒轮询 /api/services/status,更新三灯
// 三灯可点击,点击后在主内容区加载对应服务的详情页面
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
            el.title = parts.join('\n') + '\n\n点击查看详情';
        });
    },

    bindClickHandlers() {
        // 使用事件委托:在 document 上监听,避免 DOM 重建后丢失绑定
        if (this._clickHandlerBound) return;
        this._clickHandlerBound = true;

        document.addEventListener('click', (e) => {
            const light = e.target.closest('.service-light');
            if (!light) return;

            e.preventDefault();
            e.stopPropagation();
            const service = light.dataset.service;
            console.log(`[ServicesMonitor] Clicked service: ${service}`);
            this.openServicePage(service);
        });

        // 设置 cursor 样式
        document.querySelectorAll('.service-light').forEach(light => {
            light.style.cursor = 'pointer';
        });

        console.log('[ServicesMonitor] Click handler bound via event delegation');
    },

    /**
     * 点击三灯 -> 加载对应服务的页面到主内容区
     * camera -> cameras 页面
     * teleop -> teleop 页面
     * robot  -> status 页面 (机器人状态)
     */
    openServicePage(service) {
        const pageMap = {
            camera: 'cameras',
            teleop: 'teleop',
            robot:  'status',
        };
        const page = pageMap[service];
        if (!page) return;

        // 清除导航栏 tab 的 active 状态
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        // 如果对应的 nav-tab 还存在(robot 系列),设置它为 active
        const navTab = document.querySelector(`.nav-tab[data-page="${page}"]`);
        if (navTab) navTab.classList.add('active');

        // 高亮被点击的三灯
        document.querySelectorAll('.service-light').forEach(l => l.classList.remove('selected'));
        const light = document.querySelector(`.service-light[data-service="${service}"]`);
        if (light) light.classList.add('selected');

        // 通过 app 加载页面
        if (typeof app !== 'undefined' && app.loadPage) {
            app.loadPage(page);
        } else {
            console.error('[ServicesMonitor] app instance not available');
        }
    },

    start() {
        this.pollOnce();
        this.timer = setInterval(() => this.pollOnce(), this.intervalMs);
        this.bindClickHandlers();
    },

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('[ServicesMonitor] DOMContentLoaded - Starting monitor');
    ServicesMonitor.start();

    // 暴露到全局作用域,方便调试
    window.ServicesMonitor = ServicesMonitor;
});
