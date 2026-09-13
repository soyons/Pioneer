// Diagnostics Page Module
class DiagnosticsPage {
    constructor(app) {
        this.app = app;
        this.schema = null;
        this.samples = [];
        this.selectedSections = new Set();
        this.expandedSections = new Set([
            'cmd.left_arm', 'cmd.right_arm', 'state.left_arm', 'state.right_arm'
        ]);
        this.defaultWindowMs = 20000;
        this.viewStartMs = null;
        this.viewEndMs = null;
        this.isLive = true;
        this.hoverTimeMs = null;
        this.renderRaf = null;
        this.renderTimer = null;
        this.renderRequested = false;
        this.lastRenderAt = 0;
        // Telemetry arrives at 10 Hz, but rebuilding hundreds of SVG/DOM nodes
        // at that rate is expensive on Jetson Nano. Keep ingestion live and
        // refresh the visual view at a bounded rate instead.
        this.renderIntervalMs = 200;
        this.dragState = null;
        this.active = false;
        this.maxSamples = 1200;
        this.samplesVersion = 0;
        this.visibleSamplesCache = null;
        this.visibleSamplesCacheKey = '';
        this.dataChannels = new Set();
        this.visibilityHandler = null;
        this.connectionState = 'disconnected';
        this.palette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
        this.darkPalette = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
    }

    async render(container) {
        this.onLeave();
        this.active = true;
        container.innerHTML = `
            <div class="card telemetry-workbench">
                <div class="telemetry-title-row">
                    <div>
                        <div class="card-title">📈 Command / State Telemetry</div>
                        <p class="telemetry-subtitle">mix_robot_cmd 与 robot/state · 实时滚动、暂停和拖动历史</p>
                    </div>
                    <div class="telemetry-actions">
                        <button id="telemetryPause" class="btn btn-secondary" type="button">暂停</button>
                        <button id="telemetryLive" class="btn btn-primary" type="button">回到实时</button>
                    </div>
                </div>
                <div class="telemetry-status-row">
                    <span id="telemetryConnection" class="status-badge warning">连接中</span>
                    <span id="telemetryCmdAge" class="telemetry-source-age">CMD —</span>
                    <span id="telemetryStateAge" class="telemetry-source-age">STATE —</span>
                    <span id="telemetryWindow" class="telemetry-window-label">等待数据</span>
                </div>
                <div class="telemetry-filter-row">
                    <button class="btn btn-sm btn-secondary telemetry-filter" data-filter="all">全部</button>
                    <button class="btn btn-sm btn-secondary telemetry-filter" data-filter="cmd">仅命令</button>
                    <button class="btn btn-sm btn-secondary telemetry-filter" data-filter="state">仅状态</button>
                    <span id="telemetrySelectionSummary" class="telemetry-selection-summary">等待 schema</span>
                </div>
                <div id="telemetrySectionChips" class="telemetry-section-chips"></div>
                <div id="telemetryOverview" class="telemetry-overview">
                    <div class="telemetry-empty">等待 telemetry schema 和样本…</div>
                </div>
                <div id="telemetryPlots" class="telemetry-sections"></div>
                <div class="telemetry-readout-bar">
                    <strong id="telemetryReadoutTime">当前值</strong>
                    <span>悬浮曲线查看统一时刻；也可展开表格读取全部值。</span>
                </div>
                <div id="telemetryReadout" class="telemetry-readout"></div>
            </div>

            <div class="card-grid mt-4">
                <div class="card">
                    <div class="card-title">🔌 Port Scanner</div>
                    <button class="btn btn-primary" onclick="diagnosticsPage.scanPorts()">Scan Ports</button>
                    <div id="portsResult" class="mt-4"></div>
                </div>
                <div class="card">
                    <div class="card-title">🔍 Motor Scanner</div>
                    <div class="form-group">
                        <label class="form-label">Port:</label>
                        <select id="motorPort" class="form-select"><option value="">(Select port)</option></select>
                    </div>
                    <button class="btn btn-primary" onclick="diagnosticsPage.scanMotors()">Scan Motors</button>
                    <div id="motorsResult" class="mt-4"></div>
                </div>
            </div>
            <div class="card mt-4">
                <div class="card-title">🏥 Health Check</div>
                <button class="btn btn-success" onclick="diagnosticsPage.healthCheck()">Run Health Check</button>
                <div id="healthResult" class="mt-4"></div>
            </div>
        `;

        this.bindTelemetryControls();
        this.visibilityHandler = () => {
            if (!document.hidden && this.renderRequested) this.scheduleRender();
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
        this.connectTelemetry();
        await this.scanPorts();
    }

    bindTelemetryControls() {
        document.getElementById('telemetryPause')?.addEventListener('click', () => this.togglePause());
        document.getElementById('telemetryLive')?.addEventListener('click', () => this.goLive());
        document.querySelectorAll('.telemetry-filter').forEach(button => {
            button.addEventListener('click', () => this.applySectionFilter(button.dataset.filter));
        });
    }

    connectTelemetry() {
        this.connectionState = 'connecting';
        this.updateTelemetryStatus();
        api.connectWebSocket('telemetry',
            message => this.onTelemetryMessage(message),
            () => {
                this.connectionState = 'error';
                this.updateTelemetryStatus();
            },
            {
                onOpen: () => {
                    this.connectionState = 'connected';
                    this.updateTelemetryStatus();
                },
                onClose: () => {
                    if (!this.active) return;
                    this.connectionState = 'disconnected';
                    this.updateTelemetryStatus();
                },
            });
    }

    onTelemetryMessage(message) {
        if (!this.active || !message) return;
        if (message.error) {
            this.connectionState = 'error';
            this.updateTelemetryStatus(message.error);
            return;
        }
        if (message.type === 'telemetry_schema') {
            this.schema = message;
            this.maxSamples = message.max_samples || Math.ceil((message.sample_hz || 10) * (message.history_seconds || 120));
            this.selectedSections = new Set((message.sections || []).map(section => section.id));
            this.renderSectionControls();
            this.scheduleRender();
            return;
        }
        if (message.type === 'telemetry_history') {
            this.samples = this.dedupeSamples(message.samples || []).slice(-this.maxSamples);
            this.samplesVersion += 1;
            this.rebuildDataChannelCache();
            this.ensureViewport(true);
            this.scheduleRender();
            return;
        }
        if (message.type === 'telemetry_sample') {
            const previousLast = this.samples[this.samples.length - 1];
            if (!previousLast || message.seq > previousLast.seq) this.samples.push(message);
            else this.samples = this.dedupeSamples([...this.samples, message]);
            if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
            this.samplesVersion += 1;
            this.markDataChannels(message);
            if (this.isLive) this.followLatest();
            this.scheduleRender();
        }
    }

    dedupeSamples(samples) {
        const bySeq = new Map();
        samples.forEach(sample => {
            if (sample && Number.isFinite(sample.seq) && Number.isFinite(sample.t_ms)) bySeq.set(sample.seq, sample);
        });
        return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
    }

    ensureViewport(reset = false) {
        if (!this.samples.length) return;
        const first = this.samples[0].t_ms;
        const last = this.samples[this.samples.length - 1].t_ms;
        if (reset || this.viewStartMs == null || this.viewEndMs == null) {
            this.viewEndMs = last;
            this.viewStartMs = Math.max(first, last - this.defaultWindowMs);
            this.isLive = true;
        } else {
            this.clampViewport();
        }
    }

    followLatest() {
        if (!this.samples.length) return;
        const last = this.samples[this.samples.length - 1].t_ms;
        const width = Math.max(1000, (this.viewEndMs ?? last) - (this.viewStartMs ?? (last - this.defaultWindowMs)));
        this.viewEndMs = last;
        this.viewStartMs = Math.max(this.samples[0].t_ms, last - width);
    }

    clampViewport() {
        if (!this.samples.length || this.viewStartMs == null || this.viewEndMs == null) return;
        const min = this.samples[0].t_ms;
        const max = this.samples[this.samples.length - 1].t_ms;
        const available = Math.max(1, max - min);
        let width = Math.max(1000, this.viewEndMs - this.viewStartMs);
        width = Math.min(width, available);
        if (this.viewStartMs < min) {
            this.viewStartMs = min;
            this.viewEndMs = min + width;
        }
        if (this.viewEndMs > max) {
            this.viewEndMs = max;
            this.viewStartMs = max - width;
        }
        this.viewStartMs = Math.max(min, this.viewStartMs);
        this.viewEndMs = Math.min(max, Math.max(this.viewStartMs + 1, this.viewEndMs));
    }

    togglePause() {
        this.isLive = !this.isLive;
        if (this.isLive) this.followLatest();
        this.scheduleRender();
    }

    goLive() {
        this.isLive = true;
        this.followLatest();
        this.scheduleRender();
    }

    applySectionFilter(filter) {
        if (!this.schema) return;
        const sections = this.schema.sections || [];
        this.selectedSections = new Set(sections
            .filter(section => filter === 'all' || section.id.startsWith(`${filter}.`))
            .map(section => section.id));
        this.renderSectionControls();
        this.scheduleRender();
    }

    renderSectionControls() {
        const host = document.getElementById('telemetrySectionChips');
        if (!host || !this.schema) return;
        host.replaceChildren();
        (this.schema.sections || []).forEach(section => {
            const label = document.createElement('label');
            label.className = `telemetry-section-chip${this.selectedSections.has(section.id) ? ' on' : ''}`;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = this.selectedSections.has(section.id);
            input.addEventListener('change', () => {
                if (input.checked) this.selectedSections.add(section.id);
                else this.selectedSections.delete(section.id);
                this.renderSectionControls();
                this.scheduleRender();
            });
            label.append(input, document.createTextNode(section.label));
            host.append(label);
        });
        this.updateSelectionSummary();
    }

    updateSelectionSummary() {
        const element = document.getElementById('telemetrySelectionSummary');
        if (!element || !this.schema) return;
        const channels = (this.schema.channels || []).filter(channel => this.selectedSections.has(channel.section));
        element.textContent = `已选 ${this.selectedSections.size}/${this.schema.sections.length} 组 · ${channels.length} 条通道`;
    }

    scheduleRender() {
        if (!this.active) return;
        this.renderRequested = true;
        if (document.hidden || this.renderRaf || this.renderTimer) return;
        const elapsed = performance.now() - this.lastRenderAt;
        const delay = Math.max(0, this.renderIntervalMs - elapsed);
        if (delay > 0) {
            this.renderTimer = setTimeout(() => {
                this.renderTimer = null;
                this.scheduleRender();
            }, delay);
            return;
        }
        this.renderRaf = requestAnimationFrame(() => {
            this.renderRaf = null;
            if (!this.active || document.hidden) return;
            this.renderRequested = false;
            this.lastRenderAt = performance.now();
            this.drawTelemetry();
        });
    }

    drawTelemetry() {
        if (!this.active) return;
        this.updateTelemetryStatus();
        this.updateSelectionSummary();
        this.drawOverview();
        this.drawSections();
        this.drawReadout();
    }

    updateTelemetryStatus(errorText = '') {
        const connection = document.getElementById('telemetryConnection');
        if (connection) {
            const states = {
                connected: ['success', '● Connected'], connecting: ['warning', '◌ Connecting'],
                disconnected: ['warning', '○ Reconnecting'], error: ['danger', '× Error']
            };
            const [badge, label] = states[this.connectionState] || states.disconnected;
            connection.className = `status-badge ${badge}`;
            connection.textContent = errorText || label;
        }
        const latest = this.samples[this.samples.length - 1];
        this.updateAgeBadge('telemetryCmdAge', 'CMD', latest?.cmd_age_ms);
        this.updateAgeBadge('telemetryStateAge', 'STATE', latest?.state_age_ms);
        const pause = document.getElementById('telemetryPause');
        if (pause) pause.textContent = this.isLive ? '暂停' : '继续实时';
        const live = document.getElementById('telemetryLive');
        if (live) live.disabled = this.isLive;
        const windowLabel = document.getElementById('telemetryWindow');
        if (windowLabel) {
            if (this.viewStartMs == null || this.viewEndMs == null) windowLabel.textContent = '等待数据';
            else windowLabel.textContent = `${this.isLive ? 'LIVE' : 'HISTORY'} · ${this.formatClock(this.viewStartMs)} — ${this.formatClock(this.viewEndMs)} · ${((this.viewEndMs - this.viewStartMs) / 1000).toFixed(1)}s`;
        }
    }

    updateAgeBadge(id, label, age) {
        const element = document.getElementById(id);
        if (!element) return;
        const stale = age == null || age > 1000;
        element.className = `telemetry-source-age ${stale ? 'stale' : 'live'}`;
        element.textContent = `${label} ${age == null ? '—' : `${age}ms`}`;
    }

    visibleSamples() {
        if (this.viewStartMs == null || this.viewEndMs == null) return [];
        const key = `${this.samplesVersion}:${this.viewStartMs}:${this.viewEndMs}`;
        if (this.visibleSamplesCacheKey === key && this.visibleSamplesCache) return this.visibleSamplesCache;
        this.visibleSamplesCache = this.samples.filter(sample => sample.t_ms >= this.viewStartMs && sample.t_ms <= this.viewEndMs);
        this.visibleSamplesCacheKey = key;
        return this.visibleSamplesCache;
    }

    groupsForSection(sectionId) {
        if (!this.schema) return [];
        const groups = new Map();
        (this.schema.channels || []).filter(channel => channel.section === sectionId).forEach(channel => {
            if (!groups.has(channel.group)) groups.set(channel.group, {
                id: channel.group, label: channel.group_label, unit: channel.unit,
                kind: channel.kind, channels: []
            });
            groups.get(channel.group).channels.push(channel);
        });
        return Array.from(groups.values());
    }

    drawSections() {
        const host = document.getElementById('telemetryPlots');
        if (!host) return;
        host.replaceChildren();
        if (!this.schema) {
            host.append(this.emptyNode('等待 schema…'));
            return;
        }
        const selected = (this.schema.sections || []).filter(section => this.selectedSections.has(section.id));
        if (!selected.length) {
            host.append(this.emptyNode('请选择至少一个遥测分组'));
            return;
        }
        selected.forEach(section => {
            const details = document.createElement('details');
            details.className = 'telemetry-section';
            details.open = this.expandedSections.has(section.id);
            details.addEventListener('toggle', () => {
                if (details.open) this.expandedSections.add(section.id);
                else this.expandedSections.delete(section.id);
            });
            const summary = document.createElement('summary');
            const groups = this.groupsForSection(section.id);
            const flagged = groups.flatMap(group => group.channels).filter(channel => channel.availability !== 'live').length;
            const unavailable = groups.flatMap(group => group.channels).filter(channel => !this.channelHasData(channel)).length;
            summary.append(document.createTextNode(section.label));
            const meta = document.createElement('span');
            meta.textContent = `${groups.length} 图 · ${groups.flatMap(group => group.channels).length} 通道${unavailable ? ` · ${unavailable} unavailable` : ''}${flagged ? ` · ${flagged} optional/placeholder` : ''}`;
            summary.append(meta);
            const grid = document.createElement('div');
            grid.className = 'telemetry-plot-grid';
            // Most sections start collapsed. Do not build hidden SVG paths until
            // the operator opens that section.
            if (details.open) groups.forEach(group => grid.append(this.buildPlot(group)));
            else details.addEventListener('toggle', () => this.scheduleRender(), { once: true });
            details.append(summary, grid);
            host.append(details);
        });
    }

    buildPlot(group) {
        const card = document.createElement('div');
        card.className = 'telemetry-plot-card';
        const title = document.createElement('div');
        title.className = 'telemetry-plot-title';
        const text = document.createElement('span');
        text.textContent = group.label;
        const unit = document.createElement('small');
        unit.textContent = group.unit;
        title.append(text, unit);
        const availableChannels = group.channels.filter(channel => this.channelHasData(channel));
        const plot = this.buildPlotSvg(group, availableChannels);
        const legend = document.createElement('div');
        legend.className = 'telemetry-legend';
        group.channels.forEach(channel => {
            const item = document.createElement('span');
            const line = document.createElement('i');
            const schemaIndex = (this.schema?.channels || []).findIndex(candidate => candidate.id === channel.id);
            line.style.background = this.seriesColor(schemaIndex);
            item.append(line, document.createTextNode(`${channel.label}${channel.availability !== 'live' ? ' · optional/placeholder' : ''}`));
            legend.append(item);
        });
        card.append(title, plot, legend);
        return card;
    }

    channelHasData(channel) {
        return this.dataChannels.has(channel.index);
    }

    markDataChannels(sample) {
        if (!sample?.values) return;
        sample.values.forEach((value, index) => {
            if (Number.isFinite(value)) this.dataChannels.add(index);
        });
    }

    rebuildDataChannelCache() {
        this.dataChannels.clear();
        this.samples.forEach(sample => this.markDataChannels(sample));
    }

    buildPlotSvg(group, channels = group.channels) {
        const NS = 'http://www.w3.org/2000/svg';
        const W = 760, H = 168, left = 48, right = 12, top = 12, bottom = 28;
        const innerW = W - left - right, innerH = H - top - bottom;
        const samples = this.visibleSamples();
        const values = [];
        channels.forEach(channel => samples.forEach(sample => {
            const value = sample.values?.[channel.index];
            if (Number.isFinite(value)) values.push(value);
        }));
        let yMin = group.kind === 'step' ? 0 : Math.min(...values);
        let yMax = group.kind === 'step' ? 1 : Math.max(...values);
        if (!values.length || !Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
        if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
        if (group.kind !== 'step') {
            const pad = (yMax - yMin) * 0.08;
            yMin -= pad; yMax += pad;
        }
        const xAt = time => left + ((time - this.viewStartMs) / Math.max(1, this.viewEndMs - this.viewStartMs)) * innerW;
        const yAt = value => top + innerH - ((value - yMin) / (yMax - yMin)) * innerH;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('telemetry-svg');
        svg.dataset.role = 'plot';

        [yMin, (yMin + yMax) / 2, yMax].forEach(value => {
            const y = yAt(value);
            svg.append(this.svgLine(left, y, W - right, y, 'telemetry-grid-line'));
            const label = document.createElementNS(NS, 'text');
            label.setAttribute('x', left - 7); label.setAttribute('y', y + 3);
            label.setAttribute('text-anchor', 'end'); label.classList.add('telemetry-axis-label');
            label.textContent = this.formatAxis(value, group.kind);
            svg.append(label);
        });
        [0, 0.25, 0.5, 0.75, 1].forEach((fraction, tickIndex) => {
            const x = left + fraction * innerW;
            const time = this.viewStartMs + fraction * (this.viewEndMs - this.viewStartMs);
            svg.append(this.svgLine(x, top, x, top + innerH, 'telemetry-x-grid'));
            const label = document.createElementNS(NS, 'text');
            label.setAttribute('x', x); label.setAttribute('y', H - 7);
            label.setAttribute('text-anchor', tickIndex === 0 ? 'start' : (tickIndex === 4 ? 'end' : 'middle'));
            label.classList.add('telemetry-axis-label'); label.textContent = this.formatClock(time);
            svg.append(label);
        });

        channels.forEach(channel => {
            const schemaIndex = (this.schema?.channels || []).findIndex(candidate => candidate.id === channel.id);
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', this.pathForChannel(samples, channel, xAt, yAt, group.kind));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', this.seriesColor(schemaIndex));
            path.setAttribute('stroke-width', '2');
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            if (channel.availability !== 'live') path.setAttribute('stroke-dasharray', '4 3');
            svg.append(path);
        });
        const cursor = this.svgLine(0, top, 0, top + innerH, 'telemetry-cursor');
        cursor.style.display = 'none';
        svg.append(cursor);
        svg.addEventListener('pointerdown', event => this.beginPlotDrag(event, svg));
        svg.addEventListener('pointermove', event => this.onPlotPointerMove(event, svg));
        svg.addEventListener('pointerup', event => this.endDrag(event));
        svg.addEventListener('pointercancel', event => this.endDrag(event));
        svg.addEventListener('pointerleave', () => { if (!this.dragState) this.clearHover(); });
        return svg;
    }

    pathForChannel(samples, channel, xAt, yAt, kind) {
        if (!samples.length) return '';
        const points = [];
        const maxBuckets = 700;
        const bucketSize = Math.max(1, Math.ceil(samples.length / maxBuckets));
        for (let start = 0; start < samples.length; start += bucketSize) {
            const bucket = samples.slice(start, start + bucketSize)
                .map(sample => ({ t: sample.t_ms, v: sample.values?.[channel.index] }))
                .filter(point => Number.isFinite(point.v));
            if (!bucket.length) { points.push(null); continue; }
            if (kind === 'step' || bucket.length === 1) points.push(bucket[bucket.length - 1]);
            else {
                let min = bucket[0], max = bucket[0];
                bucket.forEach(point => { if (point.v < min.v) min = point; if (point.v > max.v) max = point; });
                points.push(...([min, max].sort((a, b) => a.t - b.t)));
            }
        }
        let d = '', previous = null;
        points.forEach(point => {
            if (!point) { previous = null; return; }
            const x = xAt(point.t).toFixed(1), y = yAt(point.v).toFixed(1);
            if (!previous) d += `M${x},${y}`;
            else if (kind === 'step') d += `H${x}V${y}`;
            else d += `L${x},${y}`;
            previous = point;
        });
        return d;
    }

    svgLine(x1, y1, x2, y2, className) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.classList.add(className);
        return line;
    }

    beginPlotDrag(event, svg) {
        if (!this.samples.length) return;
        event.preventDefault();
        svg.setPointerCapture(event.pointerId);
        this.dragState = {
            type: 'plot', pointerId: event.pointerId, startX: event.clientX,
            startViewStart: this.viewStartMs, startViewEnd: this.viewEndMs,
            rectWidth: Math.max(1, svg.getBoundingClientRect().width)
        };
        this.isLive = false;
        this.updateTelemetryStatus();
    }

    onPlotPointerMove(event, svg) {
        if (this.dragState?.type === 'plot' && this.dragState.pointerId === event.pointerId) {
            const deltaMs = -(event.clientX - this.dragState.startX) / this.dragState.rectWidth *
                (this.dragState.startViewEnd - this.dragState.startViewStart);
            this.viewStartMs = this.dragState.startViewStart + deltaMs;
            this.viewEndMs = this.dragState.startViewEnd + deltaMs;
            this.clampViewport();
            this.scheduleRender();
            return;
        }
        const rect = svg.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        this.hoverTimeMs = this.viewStartMs + fraction * (this.viewEndMs - this.viewStartMs);
        this.updateCursors();
        this.drawReadout();
    }

    endDrag(event) {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
        this.dragState = null;
        this.scheduleRender();
    }

    updateCursors() {
        if (this.hoverTimeMs == null || this.viewStartMs == null || this.viewEndMs == null) return;
        const x = 48 + ((this.hoverTimeMs - this.viewStartMs) / Math.max(1, this.viewEndMs - this.viewStartMs)) * 700;
        document.querySelectorAll('.telemetry-cursor').forEach(line => {
            line.setAttribute('x1', x); line.setAttribute('x2', x); line.style.display = '';
        });
    }

    clearHover() {
        this.hoverTimeMs = null;
        document.querySelectorAll('.telemetry-cursor').forEach(line => { line.style.display = 'none'; });
        this.drawReadout();
    }

    drawOverview() {
        const host = document.getElementById('telemetryOverview');
        if (!host) return;
        host.replaceChildren();
        if (this.samples.length < 2) {
            host.append(this.emptyNode('等待足够样本以显示时间轴…'));
            return;
        }
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 1000 74');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('telemetry-overview-svg');
        const min = this.samples[0].t_ms, max = this.samples[this.samples.length - 1].t_ms;
        const xAt = time => 16 + ((time - min) / Math.max(1, max - min)) * 968;
        const commandChannel = this.schema?.channels?.find(channel => channel.id === 'cmd.right_arm.position.x');
        if (commandChannel) {
            const finite = this.samples.map(sample => ({ t: sample.t_ms, v: sample.values?.[commandChannel.index] })).filter(point => Number.isFinite(point.v));
            if (finite.length) {
                let lo = Math.min(...finite.map(point => point.v)), hi = Math.max(...finite.map(point => point.v));
                if (lo === hi) { lo -= 0.5; hi += 0.5; }
                const path = document.createElementNS(NS, 'path');
                path.setAttribute('d', finite.map((point, index) => `${index ? 'L' : 'M'}${xAt(point.t).toFixed(1)},${(50 - ((point.v - lo) / (hi - lo)) * 30).toFixed(1)}`).join(''));
                path.setAttribute('fill', 'none'); path.setAttribute('stroke', this.seriesColor(0));
                path.setAttribute('stroke-width', '1.5'); path.setAttribute('vector-effect', 'non-scaling-stroke');
                svg.append(path);
            }
        }
        const startX = xAt(this.viewStartMs), endX = xAt(this.viewEndMs);
        const shadeLeft = document.createElementNS(NS, 'rect');
        shadeLeft.setAttribute('x', 16); shadeLeft.setAttribute('y', 8); shadeLeft.setAttribute('width', Math.max(0, startX - 16)); shadeLeft.setAttribute('height', 48); shadeLeft.classList.add('telemetry-overview-shade');
        const shadeRight = document.createElementNS(NS, 'rect');
        shadeRight.setAttribute('x', endX); shadeRight.setAttribute('y', 8); shadeRight.setAttribute('width', Math.max(0, 984 - endX)); shadeRight.setAttribute('height', 48); shadeRight.classList.add('telemetry-overview-shade');
        const viewport = document.createElementNS(NS, 'rect');
        viewport.setAttribute('x', startX); viewport.setAttribute('y', 8); viewport.setAttribute('width', Math.max(5, endX - startX)); viewport.setAttribute('height', 48); viewport.classList.add('telemetry-overview-window');
        svg.append(shadeLeft, shadeRight, viewport);
        ['start', 'end'].forEach(type => {
            const handle = document.createElementNS(NS, 'rect');
            handle.setAttribute('x', (type === 'start' ? startX : endX) - 5); handle.setAttribute('y', 5);
            handle.setAttribute('width', 10); handle.setAttribute('height', 54); handle.classList.add('telemetry-overview-handle');
            handle.dataset.handle = type; svg.append(handle);
        });
        const startLabel = document.createElementNS(NS, 'text');
        startLabel.setAttribute('x', 16); startLabel.setAttribute('y', 70); startLabel.classList.add('telemetry-axis-label'); startLabel.textContent = this.formatClock(min);
        const endLabel = document.createElementNS(NS, 'text');
        endLabel.setAttribute('x', 984); endLabel.setAttribute('y', 70); endLabel.setAttribute('text-anchor', 'end'); endLabel.classList.add('telemetry-axis-label'); endLabel.textContent = this.formatClock(max);
        svg.append(startLabel, endLabel);
        svg.addEventListener('pointerdown', event => this.beginOverviewDrag(event, svg, min, max));
        svg.addEventListener('pointermove', event => this.moveOverviewDrag(event));
        svg.addEventListener('pointerup', event => this.endDrag(event));
        svg.addEventListener('pointercancel', event => this.endDrag(event));
        host.append(svg);
    }

    beginOverviewDrag(event, svg, min, max) {
        event.preventDefault();
        svg.setPointerCapture(event.pointerId);
        const rect = svg.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const pointerTime = min + fraction * (max - min);
        let type = event.target.dataset.handle;
        if (!type) type = pointerTime >= this.viewStartMs && pointerTime <= this.viewEndMs ? 'window' : 'window-jump';
        this.dragState = {
            type, pointerId: event.pointerId, min, max, startX: event.clientX,
            rectWidth: Math.max(1, rect.width), startViewStart: this.viewStartMs,
            startViewEnd: this.viewEndMs, pointerTime
        };
        this.isLive = false;
        if (type === 'window-jump') {
            const width = this.viewEndMs - this.viewStartMs;
            this.viewStartMs = pointerTime - width / 2;
            this.viewEndMs = pointerTime + width / 2;
            this.clampViewport();
            this.dragState.type = 'window';
            this.dragState.startViewStart = this.viewStartMs;
            this.dragState.startViewEnd = this.viewEndMs;
            this.dragState.startX = event.clientX;
        }
        this.scheduleRender();
    }

    moveOverviewDrag(event) {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId || this.dragState.type === 'plot') return;
        const delta = (event.clientX - this.dragState.startX) / this.dragState.rectWidth * (this.dragState.max - this.dragState.min);
        if (this.dragState.type === 'start') {
            this.viewStartMs = Math.min(this.dragState.startViewStart + delta, this.viewEndMs - 1000);
        } else if (this.dragState.type === 'end') {
            this.viewEndMs = Math.max(this.dragState.startViewEnd + delta, this.viewStartMs + 1000);
        } else {
            this.viewStartMs = this.dragState.startViewStart + delta;
            this.viewEndMs = this.dragState.startViewEnd + delta;
        }
        this.clampViewport();
        this.scheduleRender();
    }

    nearestSample(time) {
        if (!this.samples.length) return null;
        let lo = 0, hi = this.samples.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.samples[mid].t_ms < time) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(this.samples[lo - 1].t_ms - time) < Math.abs(this.samples[lo].t_ms - time)) return this.samples[lo - 1];
        return this.samples[lo];
    }

    drawReadout() {
        const host = document.getElementById('telemetryReadout');
        const timeLabel = document.getElementById('telemetryReadoutTime');
        if (!host || !this.schema) return;
        host.replaceChildren();
        const targetTime = this.hoverTimeMs ?? this.samples[this.samples.length - 1]?.t_ms;
        const sample = Number.isFinite(targetTime) ? this.nearestSample(targetTime) : null;
        if (!sample) {
            host.append(this.emptyNode('暂无样本'));
            return;
        }
        if (timeLabel) timeLabel.textContent = `${this.hoverTimeMs == null ? '最新' : '光标'} · ${this.formatClock(sample.t_ms)} · seq ${sample.seq}`;
        const selectedSections = (this.schema.sections || []).filter(section => this.selectedSections.has(section.id));
        selectedSections.forEach(section => {
            const block = document.createElement('details');
            block.className = 'telemetry-readout-section';
            const summary = document.createElement('summary'); summary.textContent = section.label;
            const table = document.createElement('table');
            const body = document.createElement('tbody');
            (this.schema.channels || []).filter(channel => channel.section === section.id).forEach(channel => {
                const row = document.createElement('tr');
                const key = document.createElement('td'); key.textContent = `${channel.group_label} · ${channel.label}`;
                const value = document.createElement('td');
                const raw = sample.values?.[channel.index];
                value.textContent = Number.isFinite(raw) ? this.formatValue(raw, channel) : '— unavailable';
                row.append(key, value); body.append(row);
            });
            table.append(body); block.append(summary, table); host.append(block);
        });
    }

    formatValue(value, channel) {
        if (channel.kind === 'step') return value ? '1 · true' : '0 · false';
        return `${value.toFixed(4)} ${channel.unit || ''}`.trim();
    }

    formatAxis(value, kind) {
        if (kind === 'step') return value >= 0.5 ? '1' : '0';
        const abs = Math.abs(value);
        return abs >= 100 ? value.toFixed(0) : (abs >= 10 ? value.toFixed(1) : value.toFixed(2));
    }

    formatClock(time) {
        if (!Number.isFinite(time)) return '—';
        const date = new Date(time);
        return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    }

    seriesColor(index) {
        const safeIndex = Number.isFinite(index) && index >= 0 ? index : 0;
        const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || document.documentElement.dataset.theme === 'dark';
        return (dark ? this.darkPalette : this.palette)[safeIndex % 8];
    }

    emptyNode(text) {
        const element = document.createElement('div');
        element.className = 'telemetry-empty';
        element.textContent = text;
        return element;
    }

    onLeave() {
        this.active = false;
        api.closeWebSocket('telemetry');
        if (this.renderRaf) cancelAnimationFrame(this.renderRaf);
        if (this.renderTimer) clearTimeout(this.renderTimer);
        this.renderRaf = null;
        this.renderTimer = null;
        this.renderRequested = false;
        if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
        this.dragState = null;
        this.hoverTimeMs = null;
        this.schema = null;
        this.samples = [];
        this.samplesVersion = 0;
        this.visibleSamplesCache = null;
        this.visibleSamplesCacheKey = '';
        this.dataChannels.clear();
        this.selectedSections.clear();
        this.viewStartMs = null;
        this.viewEndMs = null;
        this.isLive = true;
    }

    async scanPorts() {
        const resultEl = document.getElementById('portsResult');
        if (!resultEl) return;
        resultEl.innerHTML = '<div class="spinner"></div>';
        try {
            const data = await api.scanPorts();
            if (data.ports && data.ports.length > 0) {
                const portSelect = document.getElementById('motorPort');
                if (portSelect) portSelect.innerHTML = '<option value="">(Select port)</option>' + data.ports.map(p => `<option value="${p.device}">${p.device}</option>`).join('');
                resultEl.innerHTML = `<table><thead><tr><th>Device</th><th>Description</th><th>Actions</th></tr></thead><tbody>${data.ports.map(p => `<tr><td><code>${p.device}</code></td><td>${p.description}</td><td><button class="btn btn-sm btn-primary" onclick="diagnosticsPage.testPort('${p.device}')">Test</button></td></tr>`).join('')}</tbody></table>`;
            } else resultEl.innerHTML = '<p>No serial ports found</p>';
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Failed: ${error.message}</p>`;
        }
    }

    async testPort(port) {
        this.app.showNotification(`Testing ${port}...`, 'info');
        try {
            const result = await api.testPort(port);
            if (result.connected) this.app.showNotification(`${port} connected successfully`, 'success');
            else this.app.showNotification(`${port} failed: ${result.error}`, 'danger');
        } catch (error) {
            this.app.showNotification(`Test failed: ${error.message}`, 'danger');
        }
    }

    async scanMotors() {
        const port = document.getElementById('motorPort')?.value;
        if (!port) { this.app.showNotification('Please select a port', 'warning'); return; }
        const resultEl = document.getElementById('motorsResult');
        resultEl.innerHTML = '<div class="spinner"></div>';
        try {
            const data = await api.scanMotors(port);
            if (data.motor_ids && data.motor_ids.length > 0) {
                resultEl.innerHTML = `<div class="status-badge success mb-2">Found ${data.found_count} motors</div><table><thead><tr><th>ID</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.motor_ids.map(id => `<tr><td><strong>Motor ${id}</strong></td><td><span class="status-badge success">Online</span></td><td><button class="btn btn-sm btn-primary" onclick="diagnosticsPage.getMotorDetails(${id})">Details</button></td></tr>`).join('')}</tbody></table>`;
            } else resultEl.innerHTML = '<p>No motors found</p>';
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Scan failed: ${error.message}</p>`;
        }
    }

    async getMotorDetails(motorId) {
        this.app.showNotification(`Reading motor ${motorId} details...`, 'info');
        try {
            const data = await api.request(`/diagnostics/motor/${motorId}`, { method: 'GET' });
            alert(`Motor ${motorId}:\n- Position: ${data.position}\n- Temperature: ${data.temperature}°C\n- Voltage: ${data.voltage}V\n- Current: ${data.current}mA\n- Error Code: ${data.error_code}\n- Online: ${data.online}`);
        } catch (error) {
            this.app.showNotification(`Failed to read: ${error.message}`, 'danger');
        }
    }

    async healthCheck() {
        const resultEl = document.getElementById('healthResult');
        resultEl.innerHTML = '<div class="spinner"></div>';
        try {
            const data = await api.healthCheck();
            const overallBadge = data.overall === 'healthy' ? 'success' : data.overall === 'degraded' ? 'warning' : 'danger';
            resultEl.innerHTML = `<div class="status-badge ${overallBadge} mb-4">Overall Status: ${data.overall.toUpperCase()}</div><table><thead><tr><th>Check</th><th>Status</th><th>Message</th></tr></thead><tbody>${data.checks.map(check => { const badge = check.status === 'pass' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'; return `<tr><td><strong>${check.name}</strong></td><td><span class="status-badge ${badge}">${check.status}</span></td><td>${check.message}</td></tr>`; }).join('')}</tbody></table>`;
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Health check failed: ${error.message}</p>`;
        }
    }
}

let diagnosticsPage = null;
