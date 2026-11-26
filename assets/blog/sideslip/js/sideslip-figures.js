/*
 * Side-slip post — interactive figures (vanilla JS + inline SVG).
 *
 *  [data-fig="tyre"]     tyre curve: EKF tangent vs. UKF sigma points
 *  [data-fig="results"]  beta estimates per manoeuvre (+ error strip)
 *  [data-fig="drift"]    kinematic integration vs. truth (slalom)
 *  [data-fig="restart"]  estimator restarted at the friction limit
 *  [data-fig="sweep"]    RMSE vs. process noise
 *
 * Colours come from CSS classes (see the page <style>), so both blog
 * themes work without redrawing. Data: window.SIDESLIP_DATA.
 */
(function () {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const DATA = window.SIDESLIP_DATA;

    function el(tag, attrs, parent) {
        const node = document.createElementNS(NS, tag);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (value !== undefined && value !== null) node.setAttribute(key, value);
            }
        }
        if (parent) parent.appendChild(node);
        return node;
    }

    /* SVG text with "_x" / "_{xy}" subscripts (dy shifts work in every engine). */
    function text(parent, x, y, content, attrs) {
        const node = el('text', Object.assign({ x, y }, attrs), parent);
        const pattern = /_(\{[^}]*\}|.)/g;
        let last = 0;
        let match;
        while ((match = pattern.exec(content))) {
            if (match.index > last) node.appendChild(document.createTextNode(content.slice(last, match.index)));
            const sub = el('tspan', { dy: '0.32em', 'font-size': '78%' }, node);
            sub.textContent = match[1].replace(/^\{|\}$/g, '');
            el('tspan', { dy: '-0.32em' }, node).textContent = '\u200b';
            last = pattern.lastIndex;
        }
        if (last < content.length) node.appendChild(document.createTextNode(content.slice(last)));
        return node;
    }

    function niceTicks(min, max, count) {
        const span = max - min;
        const raw = span / Math.max(count, 1);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5) * mag;
        const ticks = [];
        for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
            ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
        }
        return { ticks, step };
    }

    function fmt(value, digits) {
        return Number(value).toFixed(digits).replace('-', '−');
    }

    /* ------------------------------------------------------------------
     * A small line-chart primitive: one or more stacked panels sharing x.
     * ------------------------------------------------------------------ */
    /* Charts are drawn 1:1 in CSS pixels so text stays legible on phones. */
    function chartWidth(container) {
        return Math.round(Math.max(300, Math.min(760, container.clientWidth || 760)));
    }

    function makeChart(container, opts) {
        const width = opts.width || chartWidth(container);
        const narrow = width < 520;
        const margin = Object.assign({ top: 14, right: narrow ? 10 : 16, bottom: 34, left: narrow ? 46 : 52 }, opts.margin);
        const gap = 18;
        const heights = opts.panels.map(p => p.height);
        const height = margin.top + heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1) + margin.bottom;
        const svg = el('svg', {
            viewBox: `0 0 ${width} ${height}`, class: 'ss-svg', role: 'img',
            'aria-label': opts.label || '', preserveAspectRatio: 'xMidYMid meet',
        });
        container.appendChild(svg);
        const plotW = width - margin.left - margin.right;
        const [x0, x1] = opts.x;
        const sx = v => margin.left + (v - x0) / (x1 - x0) * plotW;

        let top = margin.top;
        const panels = opts.panels.map((p, index) => {
            const panelTop = top;
            const panel = { top: panelTop, height: p.height, y: p.y };
            panel.sy = v => panelTop + (p.y[1] - v) / (p.y[1] - p.y[0]) * p.height;
            const g = el('g', { class: 'ss-panel' }, svg);
            const clipId = `${opts.id}-clip-${index}`;
            const clip = el('clipPath', { id: clipId }, el('defs', null, svg));
            el('rect', { x: margin.left, y: top, width: plotW, height: p.height }, clip);
            const yTicks = niceTicks(p.y[0], p.y[1], p.ticks || 4);
            yTicks.ticks.forEach(v => {
                const y = panel.sy(v);
                el('line', { x1: margin.left, x2: margin.left + plotW, y1: y, y2: y, class: v === 0 ? 'ss-zero' : 'ss-grid' }, g);
                text(g, margin.left - 8, y + 4, fmt(v, yTicks.step < 1 ? 1 : 0), { class: 'ss-tick', 'text-anchor': 'end' });
            });
            el('rect', { x: margin.left, y: top, width: plotW, height: p.height, class: 'ss-frame' }, g);
            if (p.label) {
                text(g, 14, top + p.height / 2, p.label, {
                    class: 'ss-axis-label', 'text-anchor': 'middle',
                    transform: `rotate(-90 14 ${top + p.height / 2})`,
                });
            }
            panel.layer = el('g', { 'clip-path': `url(#${clipId})` }, svg);
            top += p.height + gap;
            return panel;
        });

        const bottom = top - gap;
        const xTicks = niceTicks(x0, x1, narrow ? Math.min(opts.xTicks || 8, 4) : (opts.xTicks || 8));
        const axis = el('g', null, svg);
        xTicks.ticks.forEach(v => {
            const x = sx(v);
            panels.forEach(panel => el('line', { x1: x, x2: x, y1: panel.top, y2: panel.top + panel.height, class: 'ss-grid ss-grid-v' }, axis));
            text(axis, x, bottom + 18, fmt(v, xTicks.step < 1 ? 1 : 0), { class: 'ss-tick', 'text-anchor': 'middle' });
        });
        if (opts.xLabel) {
            text(axis, margin.left + plotW, bottom + 32, opts.xLabel, { class: 'ss-axis-label', 'text-anchor': 'end' });
        }
        svg.appendChild(axis);
        panels.forEach(panel => svg.appendChild(panel.layer));

        return { svg, panels, sx, margin, plotW, width, height, bottom, narrow };
    }

    function pathFrom(xs, ys, sx, sy) {
        let d = '';
        let pen = false;
        for (let i = 0; i < xs.length; i++) {
            const y = ys[i];
            if (y === null || y === undefined || !Number.isFinite(y)) {
                pen = false;
                continue;
            }
            d += `${pen ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`;
            pen = true;
        }
        return d;
    }

    function bandFrom(xs, mid, sd, k, sx, sy) {
        const upper = [];
        const lower = [];
        for (let i = 0; i < xs.length; i++) {
            if (mid[i] === null || sd[i] === null) continue;
            upper.push(`${sx(xs[i]).toFixed(1)},${sy(mid[i] + k * sd[i]).toFixed(1)}`);
            lower.unshift(`${sx(xs[i]).toFixed(1)},${sy(mid[i] - k * sd[i]).toFixed(1)}`);
        }
        return upper.length ? `M${upper.join('L')}L${lower.join('L')}Z` : '';
    }

    /* Crosshair + readout that follows the pointer (or arrow keys). */
    function attachHover(chart, xs, readout, describe) {
        const { svg, sx, panels, margin, plotW } = chart;
        const line = el('line', { class: 'ss-cursor', y1: panels[0].top, y2: panels[panels.length - 1].top + panels[panels.length - 1].height }, svg);
        line.style.display = 'none';
        let index = -1;

        function show(i) {
            index = Math.max(0, Math.min(xs.length - 1, i));
            const x = sx(xs[index]);
            line.setAttribute('x1', x);
            line.setAttribute('x2', x);
            line.style.display = '';
            readout.innerHTML = describe(index);
        }
        function nearest(clientX) {
            const box = svg.getBoundingClientRect();
            const scale = chart.width / box.width;
            const x = (clientX - box.left) * scale;
            const t = xs[0] + (x - margin.left) / plotW * (xs[xs.length - 1] - xs[0]);
            let best = 0;
            for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - t) < Math.abs(xs[best] - t)) best = i;
            return best;
        }
        svg.addEventListener('pointermove', event => show(nearest(event.clientX)));
        svg.addEventListener('pointerdown', event => show(nearest(event.clientX)));
        svg.setAttribute('tabindex', '0');
        svg.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const step = event.shiftKey ? 10 : 1;
            show((index < 0 ? 0 : index) + (event.key === 'ArrowRight' ? step : -step));
        });
        return show;
    }

    function legend(container, items) {
        const wrap = document.createElement('div');
        wrap.className = 'ss-legend';
        items.forEach(([cls, label]) => {
            const item = document.createElement('span');
            item.className = `ss-key ${cls}`;
            item.innerHTML = `<i aria-hidden="true"></i>${label}`;
            wrap.appendChild(item);
        });
        container.appendChild(wrap);
        return wrap;
    }

    function tabs(container, items, onSelect, label) {
        const bar = document.createElement('div');
        bar.className = 'ss-tabs';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', label);
        const buttons = items.map((item, i) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.addEventListener('click', () => select(i));
            bar.appendChild(button);
            return button;
        });
        function select(i) {
            buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
            onSelect(items[i], i);
        }
        container.appendChild(bar);
        return select;
    }

    /* ------------------------------------------------------------------
     * Figure: tyre curve, EKF tangent vs. UKF sigma points
     * ------------------------------------------------------------------ */
    const TYRE = { B: 12.0, C: 1.3, E: -0.5 };
    const RAD = Math.PI / 180;

    function tyreForce(alphaDeg) {
        const ba = TYRE.B * alphaDeg * RAD;
        return Math.sin(TYRE.C * Math.atan(ba - TYRE.E * (ba - Math.atan(ba))));
    }

    function tyreSlope(alphaDeg) {
        const h = 1e-3;
        return (tyreForce(alphaDeg + h) - tyreForce(alphaDeg - h)) / (2 * h);
    }

    function trueMoments(mean, sd) {
        // Dense quadrature of E[F] and Cov(alpha, F) under N(mean, sd^2).
        let wSum = 0;
        let fMean = 0;
        const samples = [];
        for (let z = -5; z <= 5; z += 0.02) {
            const w = Math.exp(-0.5 * z * z);
            const a = mean + sd * z;
            const F = tyreForce(a);
            samples.push([a, F, w]);
            wSum += w;
            fMean += w * F;
        }
        fMean /= wSum;
        let cov = 0;
        let fVar = 0;
        samples.forEach(([a, F, w]) => {
            cov += w * (a - mean) * (F - fMean);
            fVar += w * (F - fMean) ** 2;
        });
        return { mean: fMean, slope: cov / wSum / (sd * sd), sd: Math.sqrt(fVar / wSum) };
    }

    function unscented(mean, sd) {
        // n = 1, kappa = 2 -> n + lambda = 3, same spread as the 2-state filter.
        const spread = Math.sqrt(3) * sd;
        const pts = [mean, mean + spread, mean - spread];
        const w = [2 / 3, 1 / 6, 1 / 6];
        const F = pts.map(tyreForce);
        const fMean = F.reduce((s, v, i) => s + w[i] * v, 0);
        const cov = pts.reduce((s, a, i) => s + w[i] * (a - mean) * (F[i] - fMean), 0);
        const fVar = F.reduce((s, v, i) => s + w[i] * (v - fMean) ** 2, 0);
        return { pts, F, mean: fMean, slope: cov / (sd * sd), sd: Math.sqrt(fVar) };
    }

    function initTyre(root, signal) {
        const plot = root.querySelector('.ss-plot');
        const readout = root.querySelector('.ss-readout');
        const meanInput = root.querySelector('[name="alpha-mean"]');
        const sdInput = root.querySelector('[name="alpha-sd"]');
        const meanOut = root.querySelector('[data-out="alpha-mean"]');
        const sdOut = root.querySelector('[data-out="alpha-sd"]');
        const presets = root.querySelectorAll('[data-preset]');

        const chart = makeChart(plot, {
            id: 'tyre', x: [-6, 24], xTicks: 6, xLabel: 'slip angle α [deg]',
            label: 'Normalised lateral tyre force versus slip angle with the EKF tangent and the UKF sigma points',
            margin: { left: 50, bottom: 36 },
            panels: [{ height: 330, y: [-1.1, 1.25], ticks: 5, label: 'F_y / μF_z' }],
        });
        const { sx } = chart;
        const p = chart.panels[0];
        const sy = p.sy;
        const L = p.layer;

        const xs = [];
        for (let a = -6; a <= 24; a += 0.1) xs.push(a);
        el('path', { d: pathFrom(xs, xs.map(tyreForce), sx, sy), class: 'ss-line ss-tyre' }, L);
        const linear = el('path', { class: 'ss-line ss-linear-region' }, L);
        linear.setAttribute('d', pathFrom([-6, 7], [-6 * RAD * TYRE.B * TYRE.C, 7 * RAD * TYRE.B * TYRE.C], sx, sy));
        text(L, sx(4.6), sy(1.16), 'linear tyre', { class: 'ss-note', 'text-anchor': 'end' });
        text(L, sx(10.2), sy(1.08), 'peak', { class: 'ss-note', 'text-anchor': 'middle' });
        text(L, sx(23.6), sy(0.88), 'saturated', { class: 'ss-note', 'text-anchor': 'end' });

        const pdf = el('path', { class: 'ss-pdf' }, L);
        const tangent = el('line', { class: 'ss-line ss-ekf ss-dash' }, L);
        const secant = el('line', { class: 'ss-line ss-ukf ss-dash' }, L);
        const sigmaGroup = el('g', null, L);
        const meanMark = el('circle', { r: 5, class: 'ss-dot ss-ekf-fill' }, L);
        const yMarks = el('g', null, L);

        function draw() {
            const mean = Number(meanInput.value);
            const sd = Number(sdInput.value);
            meanOut.textContent = `${fmt(mean, 1)}°`;
            sdOut.textContent = `${fmt(sd, 1)}°`;

            // Gaussian belief over alpha, drawn on the baseline.
            const base = sy(-1.1);
            const peakH = 78;
            const pts = [];
            for (let a = mean - 4 * sd; a <= mean + 4 * sd; a += sd / 20) {
                const z = (a - mean) / sd;
                pts.push(`${sx(a).toFixed(1)},${(base - peakH * Math.exp(-0.5 * z * z)).toFixed(1)}`);
            }
            pdf.setAttribute('d', `M${sx(mean - 4 * sd).toFixed(1)},${base}L${pts.join('L')}L${sx(mean + 4 * sd).toFixed(1)},${base}Z`);

            const F0 = tyreForce(mean);
            const k = tyreSlope(mean);
            const span = Math.max(4, 2.2 * sd);
            tangent.setAttribute('x1', sx(mean - span));
            tangent.setAttribute('x2', sx(mean + span));
            tangent.setAttribute('y1', sy(F0 - k * span));
            tangent.setAttribute('y2', sy(F0 + k * span));
            meanMark.setAttribute('cx', sx(mean));
            meanMark.setAttribute('cy', sy(F0));

            const ut = unscented(mean, sd);
            secant.setAttribute('x1', sx(mean - span));
            secant.setAttribute('x2', sx(mean + span));
            secant.setAttribute('y1', sy(ut.mean - ut.slope * span));
            secant.setAttribute('y2', sy(ut.mean + ut.slope * span));
            sigmaGroup.replaceChildren();
            ut.pts.forEach((a, i) => {
                el('line', { x1: sx(a), x2: sx(a), y1: base, y2: sy(ut.F[i]), class: 'ss-sigma-stem' }, sigmaGroup);
                el('circle', { cx: sx(a), cy: sy(ut.F[i]), r: i === 0 ? 5.5 : 4.5, class: 'ss-dot ss-ukf-fill' }, sigmaGroup);
            });

            const truth = trueMoments(mean, sd);
            yMarks.replaceChildren();
            [[F0, 'ss-ekf'], [ut.mean, 'ss-ukf'], [truth.mean, 'ss-truth']].forEach(([v, cls], i) => {
                el('line', { x1: sx(-6), x2: sx(-6) + 14 + i * 6, y1: sy(v), y2: sy(v), class: `ss-line ${cls} ss-tickmark` }, yMarks);
            });

            const per = v => fmt(v * 100, 1);
            readout.innerHTML =
                `<span class="ss-ekf-text">EKF</span> slope ${per(k)} %/° · mean force ${fmt(F0, 3)}<br>` +
                `<span class="ss-ukf-text">UKF</span> slope ${per(ut.slope)} %/° · mean force ${fmt(ut.mean, 3)}<br>` +
                `<span class="ss-truth-text">exact</span> slope ${per(truth.slope)} %/° · mean force ${fmt(truth.mean, 3)}`;
        }

        meanInput.addEventListener('input', draw, { signal });
        sdInput.addEventListener('input', draw, { signal });
        presets.forEach(button => button.addEventListener('click', () => {
            const [m, s] = button.dataset.preset.split(',').map(Number);
            meanInput.value = m;
            sdInput.value = s;
            draw();
        }, { signal }));
        draw();
    }

    /* ------------------------------------------------------------------
     * Figure: manoeuvre results
     * ------------------------------------------------------------------ */
    function initResults(root, signal) {
        const plot = root.querySelector('.ss-plot');
        const readout = root.querySelector('.ss-readout');
        const note = root.querySelector('.ss-caption-note');
        const stats = root.querySelector('.ss-stats');
        const bandToggle = root.querySelector('[name="show-band"]');
        let current = null;

        legend(root.querySelector('.ss-legend-slot'), [
            ['ss-truth', 'true β'], ['ss-ekf', 'EKF'], ['ss-ukf', 'UKF'], ['ss-band-key', 'UKF ±2σ'],
        ]);

        function render(m) {
            current = m;
            plot.replaceChildren();
            const t = m.t;
            const all = m.beta.concat(m.ekf, m.ukf).filter(v => v !== null);
            const lim = Math.max(1, Math.max(...all.map(Math.abs)) * 1.15);
            const errE = m.ekf.map((v, i) => v - m.beta[i]);
            const errU = m.ukf.map((v, i) => v - m.beta[i]);
            const errLim = Math.max(0.25, Math.max(...errE.concat(errU).map(Math.abs)) * 1.2);
            const ayLim = Math.max(...m.ay.map(Math.abs));

            const chart = makeChart(plot, {
                id: `res-${m.key}`, x: [t[0], t[t.length - 1]], xTicks: 6, xLabel: 'time [s]',
                label: `Side-slip estimates for the ${m.name} manoeuvre`,
                panels: [
                    { height: 70, y: [-Math.max(10, ayLim * 1.1), Math.max(10, ayLim * 1.1)], ticks: 2, label: 'a_y' },
                    { height: 210, y: [-lim, lim], ticks: 4, label: 'β [deg]' },
                    { height: 90, y: [-errLim, errLim], ticks: 2, label: 'error' },
                ],
            });
            const [pa, pb, pe] = chart.panels;
            el('path', { d: pathFrom(t, m.ay, chart.sx, pa.sy), class: 'ss-line ss-ay' }, pa.layer);
            if (m.mu < 1) {
                [1, -1].forEach(s => el('line', {
                    x1: chart.sx(t[0]), x2: chart.sx(t[t.length - 1]), y1: pa.sy(s * m.mu * 9.81), y2: pa.sy(s * m.mu * 9.81), class: 'ss-limit',
                }, pa.layer));
            }
            [1, -1].forEach(s => el('line', {
                x1: chart.sx(t[0]), x2: chart.sx(t[t.length - 1]), y1: pa.sy(s * 9.81), y2: pa.sy(s * 9.81), class: 'ss-limit ss-limit-dry',
            }, pa.layer));
            const band = el('path', { d: bandFrom(t, m.ukf, m.ukf_sd, 2, chart.sx, pb.sy), class: 'ss-band' }, pb.layer);
            band.style.display = bandToggle.checked ? '' : 'none';
            el('path', { d: pathFrom(t, m.beta, chart.sx, pb.sy), class: 'ss-line ss-truth ss-thick' }, pb.layer);
            el('path', { d: pathFrom(t, m.ekf, chart.sx, pb.sy), class: 'ss-line ss-ekf' }, pb.layer);
            el('path', { d: pathFrom(t, m.ukf, chart.sx, pb.sy), class: 'ss-line ss-ukf ss-dash-fine' }, pb.layer);
            el('path', { d: pathFrom(t, errE, chart.sx, pe.sy), class: 'ss-line ss-ekf' }, pe.layer);
            el('path', { d: pathFrom(t, errU, chart.sx, pe.sy), class: 'ss-line ss-ukf ss-dash-fine' }, pe.layer);
            text(chart.svg, chart.margin.left + 8, pa.top + 14, 'a_y [m/s²] · dashed: friction limit', { class: 'ss-note' });

            const describe = i => `t = ${fmt(t[i], 2)} s · a<sub>y</sub> ${fmt(m.ay[i], 2)} m/s² · ` +
                `<span class="ss-truth-text">β ${fmt(m.beta[i], 2)}°</span> · ` +
                `<span class="ss-ekf-text">EKF ${fmt(m.ekf[i], 2)}°</span> · ` +
                `<span class="ss-ukf-text">UKF ${fmt(m.ukf[i], 2)}° ± ${fmt(2 * m.ukf_sd[i], 2)}</span>`;
            attachHover(chart, t, readout, describe);
            readout.innerHTML = 'Hover, tap or use ← → on the chart to read values.';
            note.textContent = m.note;

            const s = m.summary;
            const cell = (v, d = 3) => (v ? fmt(v[0], d) : '–');
            stats.innerHTML =
                `<div><dt>RMSE (${DATA.runs} runs)</dt><dd><span class="ss-ekf-text">${cell(s.EKF.rmse)}°</span> / <span class="ss-ukf-text">${cell(s.UKF.rmse)}°</span></dd></div>` +
                `<div><dt>Peak |β| · peak |a<sub>y</sub>|</dt><dd>${fmt(s.peak.beta, 2)}° · ${fmt(s.peak.ay, 2)} m/s²</dd></div>` +
                `<div><dt>Truth inside ±2σ</dt><dd><span class="ss-ekf-text">${cell(s.EKF.cover ? [s.EKF.cover[0] * 100] : null, 0)}%</span> / <span class="ss-ukf-text">${cell(s.UKF.cover ? [s.UKF.cover[0] * 100] : null, 0)}%</span></dd></div>`;
        }

        bandToggle.addEventListener('change', () => current && render(current), { signal });
        const select = tabs(root.querySelector('.ss-tab-slot'), DATA.maneuvers.map(m => ({ label: m.name, m })),
            (item, i) => {
                root.dataset.selected = i;
                render(item.m);
            }, 'Manoeuvre');
        select(Number(root.dataset.selected) || 0);
    }

    /* ------------------------------------------------------------------
     * Figure: why not just integrate?
     * ------------------------------------------------------------------ */
    function initDrift(root) {
        const m = DATA.maneuvers.find(x => x.key === 'slalom');
        if (!m || !m.kin) return;
        legend(root.querySelector('.ss-legend-slot'), [['ss-truth', 'true β'], ['ss-kin', '∫(a<sub>y</sub>/v<sub>x</sub> − r) dt'], ['ss-ukf', 'UKF']]);
        const all = m.beta.concat(m.kin);
        const lim = Math.max(...all.map(Math.abs)) * 1.15;
        const chart = makeChart(root.querySelector('.ss-plot'), {
            id: 'drift', x: [0, m.t[m.t.length - 1]], xTicks: 6, xLabel: 'time [s]',
            label: 'Kinematic integration of side-slip drifting away from the true value during a slalom',
            panels: [{ height: 190, y: [-lim, lim], ticks: 4, label: 'β [deg]' }],
        });
        const p = chart.panels[0];
        el('path', { d: pathFrom(m.t, m.beta, chart.sx, p.sy), class: 'ss-line ss-truth ss-thick' }, p.layer);
        el('path', { d: pathFrom(m.t, m.ukf, chart.sx, p.sy), class: 'ss-line ss-ukf ss-dash-fine' }, p.layer);
        el('path', { d: pathFrom(m.t, m.kin, chart.sx, p.sy), class: 'ss-line ss-kin' }, p.layer);
    }

    /* ------------------------------------------------------------------
     * Figure: restart at the friction limit
     * ------------------------------------------------------------------ */
    function initRestart(root) {
        const plot = root.querySelector('.ss-plot');
        const readout = root.querySelector('.ss-readout');
        const note = root.querySelector('.ss-caption-note');
        legend(root.querySelector('.ss-legend-slot'), [
            ['ss-truth', 'true β'], ['ss-ekf', 'EKF'], ['ss-ukf', 'UKF'], ['ss-band-key ss-band-ekf', 'EKF ±2σ'], ['ss-band-key', 'UKF ±2σ'],
        ]);
        const cases = [];
        DATA.restart.forEach(r => {
            [5, 10].forEach(sd0 => cases.push({ r, sd0, label: `${r.key === 'ramp' ? 'Ramp steer' : 'Sine with dwell'} · σ₀ = ${sd0}°` }));
        });

        function render(c) {
            plot.replaceChildren();
            const { r, sd0 } = c;
            const e = r.runs[`ekf_${sd0}`];
            const u = r.runs[`ukf_${sd0}`];
            const t = r.t;
            const tEnd = Math.min(t[t.length - 1], r.start + 3);
            const n = t.findIndex(v => v > tEnd + 1e-9);
            const cut = a => (n > 0 ? a.slice(0, n) : a);
            const tt = cut(t);
            const vals = cut(r.beta).concat(cut(e.beta), cut(u.beta)).filter(v => v !== null);
            const lo = Math.min(...vals, -1);
            const hi = Math.max(...vals, 1);
            const pad = (hi - lo) * 0.12;
            const clampLo = Math.max(lo - pad, -16);
            const clampHi = Math.min(hi + pad, 16);
            const chart = makeChart(plot, {
                id: `restart-${r.key}-${sd0}`, x: [tt[0], tt[tt.length - 1]], xTicks: 6, xLabel: 'time [s]',
                label: 'Side-slip estimates after restarting both filters at the friction limit',
                panels: [{ height: 250, y: [clampLo, clampHi], ticks: 5, label: 'β [deg]' }],
            });
            const p = chart.panels[0];
            el('path', { d: bandFrom(tt, cut(e.beta), cut(e.sd), 2, chart.sx, p.sy), class: 'ss-band ss-band-ekf' }, p.layer);
            el('path', { d: bandFrom(tt, cut(u.beta), cut(u.sd), 2, chart.sx, p.sy), class: 'ss-band' }, p.layer);
            el('path', { d: pathFrom(tt, cut(r.beta), chart.sx, p.sy), class: 'ss-line ss-truth ss-thick' }, p.layer);
            el('path', { d: pathFrom(tt, cut(e.beta), chart.sx, p.sy), class: 'ss-line ss-ekf' }, p.layer);
            el('path', { d: pathFrom(tt, cut(u.beta), chart.sx, p.sy), class: 'ss-line ss-ukf' }, p.layer);
            const x = chart.sx(r.start);
            el('line', { x1: x, x2: x, y1: p.top, y2: p.top + p.height, class: 'ss-restart' }, chart.svg);
            text(chart.svg, x + 6, p.top + 14, chart.narrow ? 'restart, estimate = 0°' : 'filters restarted, estimate reset to 0°', { class: 'ss-note' });
            const offScale = cut(u.beta).some(v => v !== null && (v > clampHi || v < clampLo));
            if (offScale) {
                text(chart.svg, chart.margin.left + chart.plotW - 8, p.top + p.height - 12, 'UKF left the chart: diverged', { class: 'ss-note ss-ukf-label', 'text-anchor': 'end' });
            }

            const describe = i => `t = ${fmt(tt[i], 2)} s · <span class="ss-truth-text">β ${fmt(r.beta[i], 2)}°</span> · ` +
                (e.beta[i] === null ? 'filters off' :
                    `<span class="ss-ekf-text">EKF ${fmt(e.beta[i], 2)}° (σ ${fmt(e.sd[i], 2)})</span> · ` +
                    `<span class="ss-ukf-text">UKF ${fmt(u.beta[i], 2)}° (σ ${fmt(u.sd[i], 2)})</span>`);
            attachHover(chart, tt, readout, describe);
            readout.innerHTML = 'Hover, tap or use ← → on the chart to read values.';
            const row = r.rows.find(x => x.sd0 === sd0);
            note.innerHTML = `Restart at t = ${r.start} s (true β = ${fmt(r.beta_at_start, 2)}°, a<sub>y</sub> = ${fmt(Math.abs(r.ay_at_start), 2)} m/s²), ` +
                `initial σ<sub>β</sub> = ${sd0}°. Mean over ${DATA.runs} runs — RMSE after restart: ` +
                `<span class="ss-ekf-text">EKF ${fmt(row.EKF.rmse[0], 2)}°</span>, <span class="ss-ukf-text">UKF ${fmt(row.UKF.rmse[0], 2)}°</span>.`;
        }

        const select = tabs(root.querySelector('.ss-tab-slot'), cases, (c, i) => {
            root.dataset.selected = i;
            render(c);
        }, 'Restart case');
        select(Number(root.dataset.selected) || 0);
    }

    /* ------------------------------------------------------------------
     * Figure: process-noise sweep
     * ------------------------------------------------------------------ */
    function initSweep(root) {
        const rows = DATA.sweep.rows;
        legend(root.querySelector('.ss-legend-slot'), [['ss-ekf', 'EKF'], ['ss-ukf', 'UKF']]);
        const plotHost = root.querySelector('.ss-plot');
        const width = chartWidth(plotHost);
        const narrow = width < 520;
        const height = 250;
        const m = { top: 16, right: narrow ? 8 : 18, bottom: 42, left: narrow ? 44 : 52 };
        const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'ss-svg', role: 'img', 'aria-label': 'RMSE of both filters against the process noise on beta' });
        plotHost.appendChild(svg);
        const plotW = width - m.left - m.right;
        const plotH = height - m.top - m.bottom;
        const maxV = Math.max(...rows.map(r => Math.max(r.EKF.rmse[0], r.UKF.rmse[0]))) * 1.15;
        const sy = v => m.top + plotH - v / maxV * plotH;
        const group = plotW / rows.length;
        const ticks = niceTicks(0, maxV, 4);
        ticks.ticks.forEach(v => {
            el('line', { x1: m.left, x2: m.left + plotW, y1: sy(v), y2: sy(v), class: v === 0 ? 'ss-zero' : 'ss-grid' }, svg);
            text(svg, m.left - 8, sy(v) + 4, fmt(v, 1), { class: 'ss-tick', 'text-anchor': 'end' });
        });
        text(svg, 14, m.top + plotH / 2, 'RMSE [deg]', { class: 'ss-axis-label', 'text-anchor': 'middle', transform: `rotate(-90 14 ${m.top + plotH / 2})` });
        rows.forEach((r, i) => {
            const cx = m.left + group * (i + 0.5);
            const bw = Math.min(34, group * 0.32);
            [['EKF', -1], ['UKF', 1]].forEach(([name, side]) => {
                const v = r[name].rmse[0];
                const x = cx + side * (bw / 2 + 2) - bw / 2;
                el('rect', { x, y: sy(v), width: bw, height: sy(0) - sy(v), rx: 3, class: `ss-bar ss-${name.toLowerCase()}-fill` }, svg);
                text(svg, x + bw / 2, sy(v) - 6, fmt(v, 2), { class: 'ss-tick ss-bar-label', 'text-anchor': 'middle' });
            });
            text(svg, cx, m.top + plotH + 18, `${r.q}°`, { class: 'ss-tick', 'text-anchor': 'middle' });
        });
        text(svg, m.left + plotW, height - 6, narrow ? '√Q_β per step' : '√Q_β per step (process noise on β)', { class: 'ss-axis-label', 'text-anchor': 'end' });
    }

    function init() {
        if (!DATA) return;
        const map = { tyre: initTyre, results: initResults, drift: initDrift, restart: initRestart, sweep: initSweep };
        const figures = [];
        document.querySelectorAll('[data-fig]').forEach(root => {
            const fn = map[root.dataset.fig];
            if (!fn) return;
            const figure = { root, fn, controller: null, width: 0 };
            figure.build = () => {
                if (figure.controller) figure.controller.abort();
                figure.controller = new AbortController();
                root.querySelectorAll('.ss-legend-slot, .ss-tab-slot, .ss-plot').forEach(node => node.replaceChildren());
                figure.width = root.querySelector('.ss-plot').clientWidth;
                try {
                    fn(root, figure.controller.signal);
                    root.classList.add('is-ready');
                } catch (error) {
                    console.error(error);
                }
            };
            figure.build();
            figures.push(figure);
        });

        // Redraw at the new pixel width when the column changes size noticeably.
        let pending = 0;
        window.addEventListener('resize', () => {
            window.clearTimeout(pending);
            pending = window.setTimeout(() => {
                figures.forEach(figure => {
                    const width = figure.root.querySelector('.ss-plot').clientWidth;
                    if (Math.abs(width - figure.width) >= 24) figure.build();
                });
            }, 180);
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
