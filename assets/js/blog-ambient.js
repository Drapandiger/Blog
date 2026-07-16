/*
 * Shared ambient background for long-form blog pages.
 *
 * A lightweight Canvas-2D companion to the homepage Three.js environment:
 * light theme drifts holographic lab motes, dark theme renders a twinkling
 * starfield with nebula glows and the occasional meteor. Deliberately cheap —
 * no WebGL, capped at 30fps, static under prefers-reduced-motion — so article
 * reading stays smooth on any device. The CSS body background remains the
 * no-JS fallback.
 */
(function () {
    'use strict';

    var TAU = Math.PI * 2;

    function initBlogAmbient() {
        var body = document.body;
        if (!body || !body.classList.contains('blog-page') || body.dataset.blogAmbientReady === 'true') {
            return;
        }
        body.dataset.blogAmbientReady = 'true';

        var canvas = document.createElement('canvas');
        canvas.id = 'blog-ambient-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        body.insertBefore(canvas, body.firstChild);
        var ctx = canvas.getContext('2d');
        if (!ctx) {
            canvas.remove();
            return;
        }

        var root = document.documentElement;
        var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        var width = 0;
        var height = 0;
        var stars = [];
        var motes = [];
        var nebulae = [];
        var meteor = {
            active: false,
            nextAt: 4 + Math.random() * 6,
            x: 0, y: 0, vx: 0, vy: 0,
            life: 0,
            duration: 1
        };

        var themeMix = root.dataset.theme === 'dark' ? 1 : 0;
        var targetMix = themeMix;

        function makeStar() {
            var radius = 0.4 + Math.random() * 1.05;
            var roll = Math.random();
            return {
                x: Math.random(),
                y: Math.random(),
                r: radius,
                phase: Math.random() * TAU,
                speed: 0.5 + Math.random() * 1.3,
                flare: radius > 1.2 && Math.random() < 0.5,
                color: roll < 0.62 ? '255, 255, 255'
                    : (roll < 0.84 ? '165, 210, 255' : '196, 181, 253')
            };
        }

        function makeMote() {
            return {
                x: Math.random(),
                y: Math.random(),
                r: 1 + Math.random() * 1.6,
                phase: Math.random() * TAU,
                speed: 0.4 + Math.random() * 0.9,
                rise: 0.006 + Math.random() * 0.012,
                sway: 0.004 + Math.random() * 0.008,
                warm: Math.random() < 0.12
            };
        }

        /* Particles live in normalized 0-1 coordinates, so a resize only has
         * to trim or top up the counts — never teleport the existing field. */
        function buildField() {
            var area = width * height;
            var starCount = Math.max(80, Math.min(210, Math.round(area / 9000)));
            while (stars.length > starCount) stars.pop();
            while (stars.length < starCount) stars.push(makeStar());

            var moteCount = Math.max(22, Math.min(60, Math.round(area / 26000)));
            while (motes.length > moteCount) motes.pop();
            while (motes.length < moteCount) motes.push(makeMote());

            nebulae = [
                { fx: 0.78, fy: 0.2, fr: 0.42, color: '124, 58, 237', strength: 0.1, drift: 0.05, phase: 0.6 },
                { fx: 0.16, fy: 0.68, fr: 0.38, color: '34, 211, 238', strength: 0.065, drift: 0.04, phase: 2.8 },
                { fx: 0.52, fy: 0.05, fr: 0.3, color: '147, 51, 234', strength: 0.07, drift: 0.06, phase: 4.4 }
            ];
        }

        function spawnMeteor(time) {
            meteor.active = true;
            meteor.duration = 0.8 + Math.random() * 0.5;
            meteor.life = 0;
            meteor.x = width * (0.15 + Math.random() * 0.75);
            meteor.y = height * (0.05 + Math.random() * 0.3);
            var speed = (240 + Math.random() * 160);
            var angle = 0.6 + Math.random() * 0.35;
            var direction = Math.random() < 0.5 ? 1 : -1;
            meteor.vx = Math.cos(angle) * speed * direction;
            meteor.vy = Math.sin(angle) * speed * 0.55;
            meteor.nextAt = time + 6 + Math.random() * 9;
        }

        function drawDark(time, alpha) {
            var i;
            ctx.globalCompositeOperation = 'lighter';
            for (i = 0; i < nebulae.length; i += 1) {
                var nebula = nebulae[i];
                var cx = (nebula.fx + Math.sin(time * nebula.drift + nebula.phase) * 0.03) * width;
                var cy = (nebula.fy + Math.cos(time * nebula.drift * 0.8 + nebula.phase) * 0.02) * height;
                var radius = nebula.fr * Math.max(width, height);
                var breathe = 1 + Math.sin(time * 0.12 + nebula.phase) * 0.12;
                var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * breathe);
                gradient.addColorStop(0, 'rgba(' + nebula.color + ', ' + (nebula.strength * alpha) + ')');
                gradient.addColorStop(1, 'rgba(' + nebula.color + ', 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, width, height);
            }

            for (i = 0; i < stars.length; i += 1) {
                var star = stars[i];
                var twinkle = 0.5 + 0.5 * Math.sin(time * star.speed + star.phase);
                var starAlpha = (0.25 + twinkle * 0.65) * alpha;
                var x = star.x * width;
                var y = star.y * height;
                ctx.fillStyle = 'rgba(' + star.color + ', ' + starAlpha + ')';
                ctx.beginPath();
                ctx.arc(x, y, star.r, 0, TAU);
                ctx.fill();
                if (star.flare && twinkle > 0.6) {
                    var flareAlpha = (twinkle - 0.6) * 1.2 * alpha;
                    var reach = star.r * 7;
                    ctx.strokeStyle = 'rgba(' + star.color + ', ' + flareAlpha * 0.55 + ')';
                    ctx.lineWidth = 0.7;
                    ctx.beginPath();
                    ctx.moveTo(x - reach, y);
                    ctx.lineTo(x + reach, y);
                    ctx.moveTo(x, y - reach);
                    ctx.lineTo(x, y + reach);
                    ctx.stroke();
                }
            }

            if (!meteor.active && time >= meteor.nextAt) spawnMeteor(time);
            if (meteor.active) {
                var progress = meteor.life / meteor.duration;
                if (progress >= 1) {
                    meteor.active = false;
                } else {
                    var envelope = Math.sin(Math.PI * progress) * alpha;
                    var hx = meteor.x + meteor.vx * meteor.life;
                    var hy = meteor.y + meteor.vy * meteor.life;
                    var tailScale = 0.22;
                    var tx = hx - meteor.vx * tailScale;
                    var ty = hy - meteor.vy * tailScale;
                    var trail = ctx.createLinearGradient(tx, ty, hx, hy);
                    trail.addColorStop(0, 'rgba(165, 210, 255, 0)');
                    trail.addColorStop(1, 'rgba(240, 249, 255, ' + envelope * 0.85 + ')');
                    ctx.strokeStyle = trail;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.moveTo(tx, ty);
                    ctx.lineTo(hx, hy);
                    ctx.stroke();
                }
            }
            ctx.globalCompositeOperation = 'source-over';
        }

        function drawLight(time, alpha) {
            var glowPulse = 0.75 + 0.25 * Math.sin(time * 0.16);
            var gradientA = ctx.createRadialGradient(
                width * 0.85, height * 0.12, 0,
                width * 0.85, height * 0.12, Math.max(width, height) * 0.4
            );
            gradientA.addColorStop(0, 'rgba(13, 148, 136, ' + 0.05 * glowPulse * alpha + ')');
            gradientA.addColorStop(1, 'rgba(13, 148, 136, 0)');
            ctx.fillStyle = gradientA;
            ctx.fillRect(0, 0, width, height);

            var gradientB = ctx.createRadialGradient(
                width * 0.1, height * 0.78, 0,
                width * 0.1, height * 0.78, Math.max(width, height) * 0.36
            );
            gradientB.addColorStop(0, 'rgba(14, 116, 144, ' + 0.045 * (2 - glowPulse) * alpha + ')');
            gradientB.addColorStop(1, 'rgba(14, 116, 144, 0)');
            ctx.fillStyle = gradientB;
            ctx.fillRect(0, 0, width, height);

            for (var i = 0; i < motes.length; i += 1) {
                var mote = motes[i];
                var y = (mote.y - time * mote.rise) % 1;
                if (y < 0) y += 1;
                var x = mote.x + Math.sin(time * mote.speed * 0.5 + mote.phase) * mote.sway;
                var pulse = 0.55 + 0.45 * Math.sin(time * mote.speed + mote.phase);
                var moteAlpha = 0.16 * pulse * alpha;
                ctx.fillStyle = mote.warm
                    ? 'rgba(217, 119, 6, ' + moteAlpha + ')'
                    : 'rgba(13, 148, 136, ' + moteAlpha + ')';
                ctx.beginPath();
                ctx.arc(x * width, y * height, mote.r, 0, TAU);
                ctx.fill();
            }
        }

        function drawFrame(time, deltaSeconds) {
            if (Math.abs(themeMix - targetMix) > 0.001) {
                var smoothing = 1 - Math.exp(-Math.max(deltaSeconds, 1 / 60) * 8);
                themeMix += (targetMix - themeMix) * smoothing;
                if (Math.abs(themeMix - targetMix) < 0.004) themeMix = targetMix;
            }
            if (meteor.active) meteor.life += deltaSeconds;

            ctx.clearRect(0, 0, width, height);
            if (themeMix < 0.996) drawLight(time, 1 - themeMix);
            if (themeMix > 0.004) drawDark(time, themeMix);
        }

        var animationFrame = null;
        var lastTick = 0;
        var clock = 0;

        function animate(now) {
            animationFrame = window.requestAnimationFrame(animate);
            if (lastTick && now - lastTick < 1000 / 30) return;
            var deltaSeconds = lastTick ? Math.min((now - lastTick) / 1000, 0.1) : 1 / 30;
            lastTick = lastTick ? now - ((now - lastTick) % (1000 / 30)) : now;
            /* Plain accumulation: float64 keeps ample precision for any
             * session, and meteor.nextAt stays comparable to the clock. */
            clock += deltaSeconds;
            drawFrame(clock, deltaSeconds);
        }

        function stopAnimation() {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        }

        function startAnimation() {
            if (animationFrame !== null || document.hidden || motionQuery.matches) return;
            lastTick = 0;
            animationFrame = window.requestAnimationFrame(animate);
        }

        /* Measure the canvas's own 100vh CSS box, not the window: the mobile
         * URL bar changes innerHeight on every scroll flick, but the fixed
         * 100vh box stays put, so those events short-circuit below. */
        var appliedDpr = 0;
        function measure() {
            return {
                width: Math.max(1, Math.round(canvas.clientWidth) || window.innerWidth),
                height: Math.max(1, Math.round(canvas.clientHeight) || window.innerHeight),
                dpr: Math.min(window.devicePixelRatio || 1, 1.5)
            };
        }

        var resizeFrame = null;
        function handleResize() {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(function () {
                resizeFrame = null;
                var next = measure();
                if (next.width === width && next.height === height && next.dpr === appliedDpr) {
                    return;
                }
                applySize(next);
                drawFrame(clock, 0);
            });
        }

        function applySize(next) {
            width = next.width;
            height = next.height;
            appliedDpr = next.dpr;
            canvas.width = Math.round(width * next.dpr);
            canvas.height = Math.round(height * next.dpr);
            ctx.setTransform(next.dpr, 0, 0, next.dpr, 0, 0);
            buildField();
        }

        function handleThemeChange(event) {
            var theme = event && event.detail && event.detail.theme
                ? event.detail.theme
                : root.dataset.theme;
            targetMix = theme === 'dark' ? 1 : 0;
            if (motionQuery.matches || document.hidden) {
                themeMix = targetMix;
                drawFrame(clock, 0);
            } else {
                startAnimation();
            }
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                stopAnimation();
            } else {
                startAnimation();
            }
        }

        function handleMotionPreferenceChange(event) {
            if (event.matches) {
                stopAnimation();
                themeMix = targetMix;
                meteor.active = false;
                drawFrame(clock, 0);
            } else {
                startAnimation();
            }
        }

        window.addEventListener('resize', handleResize, { passive: true });
        window.addEventListener('themechange', handleThemeChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', handleMotionPreferenceChange);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(handleMotionPreferenceChange);
        }

        applySize(measure());
        drawFrame(0, 0);
        startAnimation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlogAmbient, { once: true });
    } else {
        initBlogAmbient();
    }
}());
