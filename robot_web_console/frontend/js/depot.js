// Depot 数据查看页 - 只读浏览转化后的 LeRobot/piper_dataset 数据集
//   轨迹曲线(原始数据点) + 多相机视频，悬浮十字光标联动视频帧与数值读出
//   按机械单元(左臂/右臂/夹爪/torso/base)分组筛选，轨迹与视频并列布局
const DepotPage = {
    datasets: [],
    current: null,        // 当前数据集 meta
    currentName: null,
    episodeIndex: null,
    traj: null,           // 当前 episode 轨迹数据
    units: [],            // 机械单元列表 [{key,label,count}]
    selectedUnits: new Set(),
    hoverFrame: null,
    _seekRAF: null,
    expandedKeys: new Set(),  // 放大显示(占满整行)的图 key
    playbackRate: 1,          // 视频播放倍速

    // 几何常量(所有图共享同一 x 轴)
    W: 760, H: 132, padL: 46, padR: 10, padT: 10, padB: 20,

    // 机械单元标签与显示顺序
    UNIT_LABELS: {
        left_arm: '左臂', right_arm: '右臂',
        gripper: '夹爪 Gripper', torso: 'Torso 躯干',
        chassis: 'Base 底盘', base: 'Base 底盘', head: '头部',
    },
    UNIT_ORDER: ['left_arm', 'right_arm', 'gripper', 'torso', 'chassis', 'base', 'head'],

    _palette: ['#4f9cff', '#ff6b6b', '#3ecf8e', '#ffb020', '#a78bfa', '#ff8fc7', '#22d3ee', '#facc15'],

    async render(container) {
        container.innerHTML = `
            <div class="card depot-compact">
                <div class="card-title">
                    <span>📦 Depot · 数据集查看</span>
                    <button class="btn btn-secondary btn-sm" id="btnDepotRefresh">刷新</button>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">数据集</label>
                        <select id="datasetSelect" style="width:100%;"></select>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">Episode</label>
                        <select id="episodeSelect" style="width:100%;" disabled></select>
                    </div>
                </div>
                <div id="datasetMeta" class="depot-meta" style="margin-top:10px; font-size:0.85rem; color:var(--text-secondary);"></div>
            </div>

            <!-- 相机：上方横排 -->
            <div class="card depot-compact">
                <div class="card-title">
                    <span>🎞️ 图像</span>
                    <span class="depot-play-ctrl">
                        <button class="btn btn-secondary btn-sm" id="btnDepotPlay">▶ 播放全部</button>
                        <label class="depot-speed">倍速
                            <select id="depotSpeed">
                                <option value="0.25">0.25×</option>
                                <option value="0.5">0.5×</option>
                                <option value="1" selected>1×</option>
                                <option value="2">2×</option>
                                <option value="4">4×</option>
                            </select>
                        </label>
                    </span>
                </div>
                <div id="depotVideos" class="depot-video-row"></div>
            </div>

            <!-- 数据：机械单元在标题行，数据全宽显示 -->
            <div class="card depot-compact">
                <div class="card-title depot-data-title">
                    <span>📈 数据</span>
                    <div id="unitChips" class="depot-channels depot-channels-inline"></div>
                    <span class="depot-info-line">
                        <span id="trajHint" style="font-weight:normal;font-size:0.8rem;color:var(--text-secondary)"></span>
                        <span class="depot-readout-title">🔎 帧数据</span>
                        <span id="readoutFrame" style="color:var(--text-secondary);font-weight:normal;font-size:0.8rem"></span>
                    </span>
                </div>
                <div class="depot-data-col">
                    <div id="depotReadout" class="depot-readout-inline"><p style="color:var(--text-secondary);font-size:0.85rem">悬浮轨迹查看该帧数值</p></div>
                    <div id="trajPlot"><p style="color:var(--text-secondary)">请选择数据集与 episode</p></div>
                </div>
            </div>
        `;

        document.getElementById('btnDepotRefresh').addEventListener('click', () => this.loadDatasets());
        document.getElementById('datasetSelect').addEventListener('change', (e) => this.selectDataset(e.target.value));
        document.getElementById('episodeSelect').addEventListener('change', (e) => this.selectEpisode(parseInt(e.target.value, 10)));
        document.getElementById('btnDepotPlay').addEventListener('click', () => this.toggleVideos());
        document.getElementById('depotSpeed').addEventListener('change', (e) => this.setSpeed(parseFloat(e.target.value)));

        await this.loadDatasets();
    },

    setSpeed(rate) {
        this.playbackRate = rate;
        document.querySelectorAll('#depotVideos video').forEach(v => { v.playbackRate = rate; });
    },

    onLeave() {
        this.stopPlaybackSync();
        document.querySelectorAll('#depotVideos video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    },

    // ---- 机械单元解析 ----
    unitOf(key) {
        if (/\.gripper$/.test(key)) return 'gripper';
        const s = key.replace(/^observation\.state\./, '').replace(/^action\./, '');
        return s.split('.')[0] || 'other';
    },

    deriveUnits(numericKeys) {
        const counts = {};
        numericKeys.forEach(k => {
            const u = this.unitOf(k);
            counts[u] = (counts[u] || 0) + 1;
        });
        const seen = Object.keys(counts);
        const ordered = this.UNIT_ORDER.filter(u => seen.includes(u))
            .concat(seen.filter(u => !this.UNIT_ORDER.includes(u)).sort());
        return ordered.map(u => ({
            key: u,
            label: this.UNIT_LABELS[u] || u,
            count: counts[u],
        }));
    },

    // 当前可见的 feature key(被选中单元的全部通道)
    visibleKeys() {
        return (this.current?.numeric_keys || [])
            .filter(k => this.selectedUnits.has(this.unitOf(k)));
    },

    async loadDatasets() {
        const sel = document.getElementById('datasetSelect');
        if (!sel) return;
        try {
            const data = await api.listDatasets();
            this.datasets = data.datasets || [];
            if (this.datasets.length === 0) {
                sel.innerHTML = '<option value="">（无已转化数据集）</option>';
                document.getElementById('datasetMeta').innerHTML =
                    `根目录 <code>${data.root || '-'}</code> 下没有数据集（缺少 meta/info.json）`;
                return;
            }
            const prev = this.currentName;
            sel.innerHTML = this.datasets.map(d =>
                `<option value="${d.name}">${d.name} · ${d.num_episodes}集 / ${d.total_frames}帧</option>`
            ).join('');
            const pick = (prev && this.datasets.some(d => d.name === prev)) ? prev : this.datasets[0].name;
            sel.value = pick;
            await this.selectDataset(pick);
        } catch (e) {
            console.error('[Depot] loadDatasets failed:', e);
            sel.innerHTML = '<option value="">（加载失败）</option>';
            document.getElementById('datasetMeta').innerHTML =
                `<span style="color:var(--danger-color)">数据集列表加载失败: ${e.message}</span>`;
        }
    },

    async selectDataset(name) {
        if (!name) return;
        this.currentName = name;
        try {
            this.current = await api.getDataset(name);
        } catch (e) {
            console.error('[Depot] getDataset failed:', e);
            document.getElementById('datasetMeta').innerHTML =
                `<span style="color:var(--danger-color)">数据集详情加载失败: ${e.message}</span>`;
            return;
        }

        const m = this.current;
        document.getElementById('datasetMeta').innerHTML = [
            `repo_id <code>${m.repo_id || '-'}</code>`,
            `机器人 <b>${m.robot_type || '-'}</b>`,
            `fps <b>${m.fps ?? '-'}</b>`,
            `格式 <code>${m.format || '-'}</code>`,
            `相机 <b>${m.image_keys.length}</b>`,
            `通道 <b>${m.numeric_keys.length}</b>`,
        ].join(' · ');

        // 机械单元 chips(默认全选)
        this.units = this.deriveUnits(m.numeric_keys || []);
        this.selectedUnits = new Set(this.units.map(u => u.key));
        this.renderUnitChips();

        const epSel = document.getElementById('episodeSelect');
        const eps = m.episodes || [];
        epSel.disabled = eps.length === 0;
        epSel.innerHTML = eps.length
            ? eps.map(e => `<option value="${e.episode_index}">#${e.episode_index} · ${e.num_frames}帧</option>`).join('')
            : '<option value="">（无 episode）</option>';

        if (eps.length) {
            epSel.value = eps[0].episode_index;
            await this.selectEpisode(eps[0].episode_index);
        } else {
            this.episodeIndex = null;
            document.getElementById('trajPlot').innerHTML = '<p style="color:var(--text-secondary)">该数据集无 episode</p>';
            document.getElementById('depotVideos').innerHTML = '';
        }
    },

    renderUnitChips() {
        const el = document.getElementById('unitChips');
        if (!el) return;
        if (this.units.length === 0) { el.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">无数值通道</span>'; return; }
        el.innerHTML = this.units.map(u => {
            const on = this.selectedUnits.has(u.key);
            return `<label class="depot-chan ${on ? 'on' : ''}">
                <input type="checkbox" data-unit="${u.key}" ${on ? 'checked' : ''}> ${u.label} <span style="opacity:.6">·${u.count}</span>
            </label>`;
        }).join('');
        el.querySelectorAll('input[data-unit]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const u = e.target.dataset.unit;
                if (e.target.checked) this.selectedUnits.add(u);
                else this.selectedUnits.delete(u);
                e.target.closest('.depot-chan').classList.toggle('on', e.target.checked);
                this.drawPlot();
            });
        });
    },

    async selectEpisode(idx) {
        if (idx == null || Number.isNaN(idx)) return;
        this.stopPlaybackSync();
        this.episodeIndex = idx;
        this.hoverFrame = null;
        await Promise.all([this.loadTrajectory(), this.renderVideos()]);
    },

    async loadTrajectory() {
        const plot = document.getElementById('trajPlot');
        if (!plot) return;
        plot.innerHTML = '<div class="spinner"></div>';
        try {
            this.traj = await api.getEpisodeTrajectory(this.currentName, this.episodeIndex);
            this.drawPlot();
        } catch (e) {
            console.error('[Depot] loadTrajectory failed:', e);
            plot.innerHTML = `<p style="color:var(--danger-color)">轨迹加载失败: ${e.message}</p>`;
        }
    },

    drawPlot() {
        const plot = document.getElementById('trajPlot');
        if (!plot || !this.traj) return;
        const vis = new Set(this.visibleKeys());
        const groups = (this.traj.groups || []).filter(g => vis.has(g.key));
        const hint = document.getElementById('trajHint');

        if (groups.length === 0) {
            plot.innerHTML = '<p style="color:var(--text-secondary)">未选中任何机械单元</p>';
            if (hint) hint.textContent = '';
            return;
        }

        const ts = this.traj.timestamps || [];
        this.n = ts.length || 1;
        this.innerW = this.W - this.padL - this.padR;
        // 点数过多时不画离散点标记(避免 DOM 爆炸),折线仍为原始全采样
        this.showMarkers = this.n <= 800;
        if (hint) {
            hint.textContent = `共 ${this.traj.num_frames} 帧（原始全采样）`
                + (this.showMarkers ? '' : ' · 点过多，仅画线');
        }

        plot.innerHTML = `<div class="depot-plot-grid">${groups.map(g => this.svgForGroup(g, ts)).join('')}</div>`;

        // 绑定悬浮(事件委托到容器)
        plot.onmousemove = (e) => this.onPlotMove(e);
        plot.onmouseleave = () => this.clearHover();

        // 放大/缩小按钮
        plot.querySelectorAll('.depot-zoom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.zoom;
                if (this.expandedKeys.has(key)) this.expandedKeys.delete(key);
                else this.expandedKeys.add(key);
                this.drawPlot();
            });
        });

        // 若已有悬浮帧,重画后恢复光标
        if (this.hoverFrame != null) this.updateCursor(this.hoverFrame);
    },

    svgForGroup(group, ts) {
        const { W, H, padL, padR, padT, padB } = this;
        const innerW = W - padL - padR;
        const innerH = H - padT - padB;
        const channels = group.channels || [];

        let yMin = Infinity, yMax = -Infinity;
        channels.forEach(ch => ch.values.forEach(v => {
            if (v == null || Number.isNaN(v)) return;
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
        }));
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
        if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
        const pad = (yMax - yMin) * 0.08;
        yMin -= pad; yMax += pad;

        const n = ts.length || 1;
        const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
        const yAt = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

        const paths = channels.map((ch, ci) => {
            const color = this._palette[ci % this._palette.length];
            let d = '', pen = false;
            ch.values.forEach((v, i) => {
                if (v == null || Number.isNaN(v)) { pen = false; return; }
                d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
                pen = true;
            });
            return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
        }).join('');

        // 原始数据点标记
        let markers = '';
        if (this.showMarkers) {
            markers = channels.map((ch, ci) => {
                const color = this._palette[ci % this._palette.length];
                return ch.values.map((v, i) =>
                    (v == null || Number.isNaN(v)) ? '' :
                    `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="1.6" fill="${color}"/>`
                ).join('');
            }).join('');
        }

        const ticks = [yMin, (yMin + yMax) / 2, yMax].map(val => {
            const y = yAt(val);
            return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5"/>
                    <text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${val.toFixed(2)}</text>`;
        }).join('');

        // X 轴时间刻度(底部, 5 等分)
        const axisY = padT + innerH;
        const xticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
            const i = Math.round(f * (n - 1));
            const x = xAt(i);
            const tv = ts[i];
            const label = (tv != null && isFinite(tv)) ? `${tv.toFixed(1)}s` : `${i}`;
            const anchor = f === 0 ? 'start' : (f === 1 ? 'end' : 'middle');
            return `<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY + 3}" stroke="var(--border-color)" stroke-width="0.5"/>
                    <text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" font-size="9" fill="var(--text-secondary)">${label}</text>`;
        }).join('');

        const legend = channels.length > 1
            ? `<div class="depot-legend">${channels.map((ch, ci) =>
                `<span><i style="background:${this._palette[ci % this._palette.length]}"></i>${ch.label.replace(group.key + '[', '[')}</span>`
              ).join('')}</div>`
            : '';

        const short = this.shortKey(group.key);
        const expanded = this.expandedKeys.has(group.key);
        // data-* 存几何,供悬浮高亮点定位
        return `
            <div class="depot-plot-group${expanded ? ' expanded' : ''}" data-group="${group.key}">
                <div class="depot-plot-title">
                    <span>${short} <span style="color:var(--text-secondary)">·${group.dim}D</span></span>
                    <button class="depot-zoom-btn" data-zoom="${group.key}" title="${expanded ? '缩小' : '放大'}">${expanded ? '🗕' : '🗖'}</button>
                </div>
                <svg viewBox="0 0 ${W} ${H}" class="depot-svg" data-key="${group.key}"
                     data-ymin="${yMin}" data-ymax="${yMax}" preserveAspectRatio="none">
                    ${ticks}
                    ${xticks}
                    ${paths}
                    ${markers}
                    <line class="depot-cursor" x1="0" y1="${padT}" x2="0" y2="${axisY}" stroke="var(--primary-color)" stroke-width="1" style="display:none"/>
                </svg>
                ${legend}
            </div>`;
    },

    shortKey(key) {
        return key.replace(/^observation\.state\./, 'obs.').replace(/^action\./, 'act.');
    },

    // ---- 悬浮联动 ----
    onPlotMove(evt) {
        const svg = evt.target.closest('svg.depot-svg');
        if (!svg || !this.n) return;
        const rect = svg.getBoundingClientRect();
        const vbX = (evt.clientX - rect.left) / rect.width * this.W;
        const frac = (vbX - this.padL) / this.innerW;
        let i = Math.round(frac * (this.n - 1));
        i = Math.max(0, Math.min(this.n - 1, i));
        this.setHoverFrame(i);
    },

    setHoverFrame(i) {
        if (i === this.hoverFrame) return;
        this.hoverFrame = i;
        this.updateCursor(i);
        this.updateReadout(i);
        this.syncVideos(i);
    },

    clearHover() {
        this.hoverFrame = null;
        document.querySelectorAll('#trajPlot .depot-cursor').forEach(l => { l.style.display = 'none'; });
    },

    xAt(i) {
        return this.padL + (this.n <= 1 ? 0 : (i / (this.n - 1)) * this.innerW);
    },

    updateCursor(i) {
        const x = this.xAt(i).toFixed(1);
        document.querySelectorAll('#trajPlot .depot-cursor').forEach(l => {
            l.setAttribute('x1', x);
            l.setAttribute('x2', x);
            l.style.display = '';
        });
    },

    updateReadout(i) {
        const el = document.getElementById('depotReadout');
        const fEl = document.getElementById('readoutFrame');
        if (!el || !this.traj) return;
        const ts = this.traj.timestamps || [];
        const t = ts[i];
        if (fEl) fEl.textContent = `帧 ${i} / ${this.traj.num_frames - 1} · t=${t != null ? t.toFixed(3) : '-'}s`;

        const vis = new Set(this.visibleKeys());
        const groups = (this.traj.groups || []).filter(g => vis.has(g.key));

        // 时间/帧块放在读出最前
        const timeBlock = `<div class="depot-ro-block">
                        <div class="depot-ro-unit">时间</div>
                        <table class="depot-ro-table"><tbody>
                            <tr><td class="depot-ro-key">帧</td><td class="depot-ro-val">${i} / ${this.traj.num_frames - 1}</td></tr>
                            <tr><td class="depot-ro-key">时刻</td><td class="depot-ro-val">${t != null ? t.toFixed(3) + 's' : '—'}</td></tr>
                        </tbody></table>
                    </div>`;

        if (groups.length === 0) { el.innerHTML = timeBlock; return; }

        // 按机械单元分组读出
        const byUnit = {};
        groups.forEach(g => {
            const u = this.unitOf(g.key);
            (byUnit[u] = byUnit[u] || []).push(g);
        });

        el.innerHTML = timeBlock + Object.entries(byUnit).map(([u, gs]) => {
            const rows = gs.map(g => {
                const vals = g.channels.map(ch => {
                    const v = ch.values[i];
                    return (v == null || Number.isNaN(v)) ? '—' : v.toFixed(4);
                });
                return `<tr><td class="depot-ro-key">${this.shortKey(g.key)}</td>
                            <td class="depot-ro-val">${vals.join(', ')}</td></tr>`;
            }).join('');
            return `<div class="depot-ro-block">
                        <div class="depot-ro-unit">${this.UNIT_LABELS[u] || u}</div>
                        <table class="depot-ro-table"><tbody>${rows}</tbody></table>
                    </div>`;
        }).join('');
    },

    syncVideos(i) {
        if (this._seekRAF) return;
        this._seekRAF = requestAnimationFrame(() => {
            this._seekRAF = null;
            const ts = this.traj?.timestamps || [];
            const t = ts[i];
            if (this.current?.use_videos !== false) {
                if (t == null || !isFinite(t)) return;
                document.querySelectorAll('#depotVideos video').forEach(v => {
                    if (v.readyState >= 1) { try { v.pause(); v.currentTime = t; } catch (e) {} }
                });
            } else {
                // PNG 帧模式: 换首帧图为第 i 帧
                document.querySelectorAll('#depotVideos img[data-key]').forEach(img => {
                    img.src = api.datasetFrameUrl(this.currentName, this.episodeIndex, img.dataset.key, i);
                });
            }
        });
    },

    // 时间 -> 最近帧索引(二分)
    frameAtTime(t) {
        const ts = this.traj?.timestamps || [];
        const n = ts.length;
        if (n === 0) return 0;
        if (t <= ts[0]) return 0;
        if (t >= ts[n - 1]) return n - 1;
        let lo = 0, hi = n - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (ts[mid] < t) lo = mid + 1; else hi = mid;
        }
        return (lo > 0 && (t - ts[lo - 1]) < (ts[lo] - t)) ? lo - 1 : lo;
    },

    // 视频播放时反向驱动光标+读数(不 seek 视频, 避免反馈环)
    startPlaybackSync() {
        if (this._playRAF) return;
        const tick = () => {
            const vids = document.querySelectorAll('#depotVideos video');
            const master = Array.from(vids).find(v => !v.paused && !v.ended);
            if (!master) { this._playRAF = null; return; }
            const i = this.frameAtTime(master.currentTime);
            if (i !== this.hoverFrame) {
                this.hoverFrame = i;
                this.updateCursor(i);
                this.updateReadout(i);
            }
            this._playRAF = requestAnimationFrame(tick);
        };
        this._playRAF = requestAnimationFrame(tick);
    },

    stopPlaybackSync() {
        if (this._playRAF) { cancelAnimationFrame(this._playRAF); this._playRAF = null; }
    },


    renderVideos() {
        const el = document.getElementById('depotVideos');
        if (!el || !this.current) return;
        const allKeys = this.current.image_keys || [];
        if (allKeys.length === 0) {
            el.innerHTML = '<p style="color:var(--text-secondary)">该数据集无图像通道</p>';
            return;
        }
        // 最多显示 3 个相机
        const keys = allKeys.slice(0, 3);
        const useVideos = this.current.use_videos !== false;
        el.innerHTML = keys.map(key => {
            const short = key.replace(/^observation\.images\./, '');
            if (useVideos) {
                const src = api.datasetVideoUrl(this.currentName, this.episodeIndex, key);
                return `
                    <div class="depot-video-card" data-key="${key}">
                        <div class="depot-video-label">${short}</div>
                        <video class="depot-video" data-key="${key}" src="${src}"
                               controls loop muted playsinline preload="metadata"></video>
                    </div>`;
            }
            const src = api.datasetFrameUrl(this.currentName, this.episodeIndex, key, 0);
            return `
                <div class="depot-video-card" data-key="${key}">
                    <div class="depot-video-label">${short} <span style="color:var(--text-secondary);font-size:0.8rem">(帧序列)</span></div>
                    <img class="depot-frame" data-key="${key}" src="${src}" alt="${short}">
                </div>`;
        }).join('');

        if (allKeys.length > 3) {
            el.insertAdjacentHTML('beforeend',
                `<p style="grid-column:1/-1;margin:0;font-size:0.78rem;color:var(--text-secondary)">仅显示前 3 路相机（共 ${allKeys.length} 路）</p>`);
        }

        // 视频播放时反向驱动光标+读数
        if (useVideos) {
            el.querySelectorAll('video').forEach(v => {
                v.playbackRate = this.playbackRate;  // 应用当前倍速
                v.addEventListener('play', () => this.startPlaybackSync());
                v.addEventListener('pause', () => this.stopPlaybackSync());
                v.addEventListener('ended', () => this.stopPlaybackSync());
            });
        }
    },

    toggleVideos() {
        const btn = document.getElementById('btnDepotPlay');
        const vids = document.querySelectorAll('#depotVideos video');
        if (vids.length === 0) return;
        const anyPlaying = Array.from(vids).some(v => !v.paused);
        vids.forEach(v => { if (anyPlaying) v.pause(); else v.play().catch(() => {}); });
        btn.textContent = anyPlaying ? '▶ 播放全部' : '⏸ 暂停全部';
    },

};
