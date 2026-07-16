/*
 * Homepage Three.js environment
 * Light: cinematic robotics laboratory (PBR + soft shadows + holographics).
 * Dark: deep-space neural cosmos (shader starfield, FBM nebulae, synapse pulses).
 *
 * Built with Three.js r160 (core build only). Everything is procedural —
 * custom GLSL shaders, PMREM studio lighting and seeded randomness, so the
 * homepage performs no model or texture requests.
 */
(function () {
    'use strict';

    let activeController = null;
    let waitingForMotionPreference = false;

    function markUnavailable(canvas) {
        document.documentElement.classList.remove('webgl-ready');
        document.documentElement.classList.add('webgl-unavailable');
        if (canvas) canvas.setAttribute('hidden', '');
    }

    function seededRandom(seed) {
        let state = seed >>> 0;
        return function () {
            state += 0x6D2B79F5;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function initThreeBackground() {
        if (activeController) return activeController;

        const canvas = document.getElementById('neural-canvas');
        if (!canvas) return null;

        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (motionQuery.matches) {
            document.documentElement.classList.add('webgl-reduced-motion');
            if (!waitingForMotionPreference) {
                waitingForMotionPreference = true;
                const resumeWhenAllowed = event => {
                    if (event.matches) return;
                    waitingForMotionPreference = false;
                    document.documentElement.classList.remove('webgl-reduced-motion');
                    if (typeof motionQuery.removeEventListener === 'function') {
                        motionQuery.removeEventListener('change', resumeWhenAllowed);
                    } else if (typeof motionQuery.removeListener === 'function') {
                        motionQuery.removeListener(resumeWhenAllowed);
                    }
                    initThreeBackground();
                };
                if (typeof motionQuery.addEventListener === 'function') {
                    motionQuery.addEventListener('change', resumeWhenAllowed);
                } else if (typeof motionQuery.addListener === 'function') {
                    motionQuery.addListener(resumeWhenAllowed);
                }
            }
            return null;
        }

        if (!window.THREE) {
            markUnavailable(canvas);
            return null;
        }

        const THREE = window.THREE;
        const html = document.documentElement;
        const random = seededRandom(23051996);
        const finePointerQuery = window.matchMedia('(pointer: fine)');
        /* Same predicate as the CSS breakpoint (max-width: 767px). */
        const mobileQuery = window.matchMedia('(max-width: 767px)');
        const initialMobile = mobileQuery.matches;
        const lowPowerDevice = initialMobile || !finePointerQuery.matches ||
            (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: !lowPowerDevice,
                powerPreference: lowPowerDevice ? 'low-power' : 'high-performance',
                premultipliedAlpha: true
            });
        } catch (error) {
            markUnavailable(canvas);
            return null;
        }

        canvas.removeAttribute('hidden');
        canvas.setAttribute('aria-hidden', 'true');
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initialMobile ? 1.25 : 1.75));
        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        if (THREE.ACESFilmicToneMapping) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.1;
        }
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = lowPowerDevice ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
        const labGroup = new THREE.Group();
        const spaceGroup = new THREE.Group();
        const labInner = new THREE.Group();
        const spaceInner = new THREE.Group();
        labGroup.add(labInner);
        spaceGroup.add(spaceInner);
        labGroup.name = 'Robotics laboratory';
        spaceGroup.name = 'Neural cosmos';
        scene.add(labGroup, spaceGroup);

        const labMaterials = [];
        const spaceMaterials = [];

        /* Shared uniforms (single objects reused across shader materials). */
        const uTime = { value: 0 };
        const uPixelRatio = { value: renderer.getPixelRatio() };
        const uPointer3 = { value: new THREE.Vector3(9999, 9999, 0) };
        const uPointerStrength = { value: 0 };

        function registerMaterial(collection, material, baseOpacity, keepDepthWrite) {
            material.transparent = true;
            material.userData.baseOpacity = baseOpacity;
            material.userData.keepDepthWrite = Boolean(keepDepthWrite);
            if (material.isShaderMaterial) {
                if (!material.uniforms.uOpacity) {
                    material.uniforms.uOpacity = { value: baseOpacity };
                }
                material.userData.isShader = true;
            } else {
                material.opacity = baseOpacity;
            }
            if (!keepDepthWrite) material.depthWrite = false;
            collection.push(material);
            return material;
        }

        /* ------------------------------------------------------------------
         * GLSL library
         * ------------------------------------------------------------------ */

        const NOISE_GLSL = [
            'float hash21(vec2 p) {',
            '    p = fract(p * vec2(234.34, 435.345));',
            '    p += dot(p, p + 34.23);',
            '    return fract(p.x * p.y);',
            '}',
            'float vnoise(vec2 p) {',
            '    vec2 i = floor(p);',
            '    vec2 f = fract(p);',
            '    f = f * f * (3.0 - 2.0 * f);',
            '    float a = hash21(i);',
            '    float b = hash21(i + vec2(1.0, 0.0));',
            '    float c = hash21(i + vec2(0.0, 1.0));',
            '    float d = hash21(i + vec2(1.0, 1.0));',
            '    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
            '}',
            'float fbm(vec2 p) {',
            '    float value = 0.0;',
            '    float amplitude = 0.55;',
            '    for (int i = 0; i < 4; i++) {',
            '        value += amplitude * vnoise(p);',
            '        p = p * 2.03 + 17.7;',
            '        amplitude *= 0.5;',
            '    }',
            '    return value;',
            '}'
        ].join('\n');

        const OUTPUT_GLSL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

        const starVertexShader = [
            'attribute float aSize;',
            'attribute float aPhase;',
            'attribute float aSpeed;',
            'attribute vec3 aColor;',
            'attribute float aSpike;',
            'uniform float uTime;',
            'uniform float uPixelRatio;',
            'varying vec3 vColor;',
            'varying float vSpike;',
            'varying float vTwinkle;',
            'void main() {',
            '    vColor = aColor;',
            '    vSpike = aSpike;',
            '    float twinkle = 0.72 + 0.28 * sin(uTime * aSpeed + aPhase);',
            '    vTwinkle = twinkle;',
            '    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
            '    gl_PointSize = aSize * uPixelRatio * (150.0 / -mvPosition.z) * (0.82 + 0.34 * twinkle);',
            '    gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n');

        const starFragmentShader = [
            'uniform float uOpacity;',
            'varying vec3 vColor;',
            'varying float vSpike;',
            'varying float vTwinkle;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float core = exp(-d * d * 7.0);',
            '    float halo = exp(-d * 3.2) * 0.42;',
            '    float spikes = 0.0;',
            '    if (vSpike > 0.5) {',
            '        float sx = exp(-abs(p.y) * 34.0) * max(0.0, 1.0 - abs(p.x) * 2.1);',
            '        float sy = exp(-abs(p.x) * 34.0) * max(0.0, 1.0 - abs(p.y) * 2.1);',
            '        spikes = (sx + sy) * 0.65;',
            '    }',
            '    float alpha = (core + halo + spikes) * vTwinkle * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    vec3 color = vColor * (core * 1.7 + halo + spikes * 1.2);',
            '    gl_FragColor = vec4(color, alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const nebulaVertexShader = [
            'varying vec2 vUv;',
            'void main() {',
            '    vUv = uv;',
            '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n');

        const nebulaFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'uniform float uSeed;',
            'uniform float uScale;',
            'uniform vec3 uColorA;',
            'uniform vec3 uColorB;',
            'uniform vec3 uColorC;',
            'varying vec2 vUv;',
            NOISE_GLSL,
            'void main() {',
            '    vec2 centered = vUv - 0.5;',
            '    float falloff = smoothstep(0.5, 0.1, length(centered * vec2(1.0, 1.4)));',
            '    if (falloff * uOpacity < 0.003) discard;',
            '    vec2 uv = (vUv - 0.5) * uScale + uSeed;',
            '    float t = uTime * 0.016;',
            '    vec2 q = vec2(fbm(uv + t), fbm(uv - t * 0.7 + 4.7));',
            '    float n = fbm(uv + 1.65 * q + vec2(t * 0.5, -t * 0.3));',
            '    float body = smoothstep(0.38, 0.92, n);',
            '    vec3 color = mix(uColorA, uColorB, smoothstep(0.3, 0.78, n));',
            '    color = mix(color, uColorC, smoothstep(0.68, 0.97, fbm(uv * 1.7 - q)));',
            '    float alpha = body * falloff * uOpacity;',
            '    if (alpha < 0.003) discard;',
            '    gl_FragColor = vec4(color * (0.3 + 0.9 * body), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const nodeVertexShader = [
            'attribute float aSize;',
            'attribute float aPhase;',
            'attribute float aSpeed;',
            'attribute vec3 aColor;',
            'uniform float uTime;',
            'uniform float uPixelRatio;',
            'uniform vec3 uPointer3;',
            'uniform float uPointerStrength;',
            'varying vec3 vColor;',
            'varying float vFire;',
            'varying float vHover;',
            'void main() {',
            '    vColor = aColor;',
            '    float fire = pow(0.5 + 0.5 * sin(uTime * aSpeed + aPhase), 18.0);',
            '    vFire = fire;',
            '    vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
            '    float hover = smoothstep(2.1, 0.0, distance(worldPosition.xyz, uPointer3)) * uPointerStrength;',
            '    vHover = hover;',
            '    vec4 mvPosition = viewMatrix * worldPosition;',
            '    gl_PointSize = aSize * uPixelRatio * (240.0 / -mvPosition.z) * (1.0 + fire * 1.25 + hover * 0.85);',
            '    gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n');

        const nodeFragmentShader = [
            'uniform float uOpacity;',
            'varying vec3 vColor;',
            'varying float vFire;',
            'varying float vHover;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float core = exp(-d * d * 9.0);',
            '    float halo = exp(-d * 2.6) * 0.5;',
            '    float energy = 0.62 + vFire * 1.5 + vHover * 0.9;',
            '    float alpha = (core + halo) * uOpacity * min(1.35, energy);',
            '    if (alpha < 0.004) discard;',
            '    vec3 color = mix(vColor, vec3(1.0), min(0.85, vFire * 0.8 + vHover * 0.45));',
            '    gl_FragColor = vec4(color * (core * 1.9 + halo) * energy, alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const edgeVertexShader = [
            'attribute float aT;',
            'attribute float aSeed;',
            'varying float vT;',
            'varying float vSeed;',
            'varying vec3 vWorld;',
            'void main() {',
            '    vT = aT;',
            '    vSeed = aSeed;',
            '    vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
            '    vWorld = worldPosition.xyz;',
            '    gl_Position = projectionMatrix * viewMatrix * worldPosition;',
            '}'
        ].join('\n');

        const edgeFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'uniform vec3 uPointer3;',
            'uniform float uPointerStrength;',
            'varying float vT;',
            'varying float vSeed;',
            'varying vec3 vWorld;',
            'void main() {',
            '    float speedA = 0.09 + fract(vSeed * 7.31) * 0.1;',
            '    float speedB = 0.05 + fract(vSeed * 3.77) * 0.07;',
            '    float pA = fract(vT - uTime * speedA - vSeed);',
            '    float pB = fract(1.0 - vT - uTime * speedB - vSeed * 1.71);',
            '    float pulse = exp(-pA * 15.0) + 0.55 * exp(-pB * 22.0);',
            '    float hover = smoothstep(2.1, 0.0, distance(vWorld, uPointer3)) * uPointerStrength;',
            '    float fade = sin(vT * 3.14159);',
            '    float intensity = 0.17 + pulse * 1.25 + hover * 0.6;',
            '    vec3 cool = vec3(0.35, 0.8, 0.98);',
            '    vec3 warm = vec3(0.65, 0.55, 0.99);',
            '    vec3 color = mix(cool, warm, fract(vSeed * 5.13));',
            '    float alpha = min(1.0, intensity) * (0.45 + 0.55 * fade) * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(color * intensity * 1.9, alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const meteorVertexShader = [
            'varying vec2 vUv;',
            'void main() {',
            '    vUv = uv;',
            '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n');

        const meteorFragmentShader = [
            'uniform float uOpacity;',
            'uniform float uLife;',
            'varying vec2 vUv;',
            'void main() {',
            '    float head = pow(vUv.x, 2.4);',
            '    float widthFalloff = 1.0 - abs(vUv.y - 0.5) * 2.0;',
            '    widthFalloff = pow(max(widthFalloff, 0.0), 1.6 + 3.2 * (1.0 - vUv.x));',
            '    float envelope = sin(3.14159 * clamp(uLife, 0.0, 1.0));',
            '    float alpha = head * widthFalloff * envelope * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    vec3 color = mix(vec3(0.45, 0.75, 1.0), vec3(1.0), pow(vUv.x, 3.0));',
            '    gl_FragColor = vec4(color * (0.7 + head), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const gridFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec2 p = (vUv - 0.5) * 26.0;',
            '    vec2 minor = abs(fract(p / 0.55 - 0.5) - 0.5) * 0.55;',
            '    vec2 major = abs(fract(p / 2.75 - 0.5) - 0.5) * 2.75;',
            '    float minorLine = 1.0 - smoothstep(0.0, 0.045, min(minor.x, minor.y));',
            '    float majorLine = 1.0 - smoothstep(0.0, 0.055, min(major.x, major.y));',
            '    float radius = length(p - vec2(0.3, 0.1));',
            '    float fade = smoothstep(8.5, 2.0, radius);',
            '    float ringRadius = mod(uTime * 1.35, 8.0);',
            '    float ring = exp(-abs(radius - ringRadius) * 2.4) * smoothstep(8.0, 3.5, ringRadius) * 0.6;',
            '    float strength = minorLine * 0.1 + majorLine * 0.22 + ring;',
            '    float alpha = strength * fade * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    vec3 lineColor = mix(vec3(0.06, 0.42, 0.4), vec3(0.1, 0.62, 0.58), ring);',
            '    gl_FragColor = vec4(lineColor, alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const screenFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'varying vec2 vUv;',
            NOISE_GLSL,
            'void main() {',
            '    vec3 background = vec3(0.016, 0.075, 0.096);',
            '    float rows = 13.0;',
            '    float row = floor(vUv.y * rows);',
            '    float step2 = floor(uTime * 0.7);',
            '    float lineWidth = 0.12 + 0.68 * hash21(vec2(row * 1.7, step2 + row));',
            '    float indent = 0.05 + 0.12 * step(0.72, hash21(vec2(row, 3.3)));',
            '    float inRow = step(fract(vUv.y * rows), 0.55);',
            '    float text = step(indent, vUv.x) * step(vUv.x, indent + lineWidth) * inRow;',
            '    float cursorRow = step(row, 0.5);',
            '    float cursor = cursorRow * step(0.45, fract(uTime * 1.2)) *',
            '        step(indent + lineWidth, vUv.x) * step(vUv.x, indent + lineWidth + 0.03) * inRow;',
            '    float scan = 0.92 + 0.08 * sin(vUv.y * 240.0 + uTime * 5.0);',
            '    vec3 textColor = mix(vec3(0.2, 0.85, 0.75), vec3(0.55, 0.95, 0.9), hash21(vec2(row, 8.8)));',
            '    vec3 color = background + textColor * (text * 0.85 + cursor);',
            '    gl_FragColor = vec4(color * scan, uOpacity);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const panelFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'uniform float uSeed;',
            'uniform vec3 uAccent;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec2 p = vUv - 0.5;',
            '    vec2 halfSize = vec2(0.46, 0.43);',
            '    vec2 boxDist = abs(p) - halfSize + 0.05;',
            '    float dist = length(max(boxDist, 0.0)) - 0.05;',
            '    float panel = smoothstep(0.006, -0.006, dist);',
            '    float border = smoothstep(0.016, 0.002, abs(dist));',
            '    vec3 glass = vec3(0.03, 0.16, 0.19);',
            '    float bars = 0.0;',
            '    float barHeat = 0.0;',
            '    for (int i = 0; i < 6; i++) {',
            '        float fi = float(i);',
            '        float x0 = 0.1 + fi * 0.135;',
            '        float inCol = step(x0, vUv.x) * step(vUv.x, x0 + 0.09);',
            '        float h = 0.14 + 0.42 * (0.5 + 0.5 * sin(uTime * 0.8 + fi * 1.9 + uSeed * 4.0));',
            '        float inBar = inCol * step(0.12, vUv.y) * step(vUv.y, 0.12 + h);',
            '        bars = max(bars, inBar);',
            '        barHeat = max(barHeat, inBar * (0.4 + h));',
            '    }',
            '    float header = step(0.86, vUv.y) * step(vUv.y, 0.9) *',
            '        step(0.1, vUv.x) * step(vUv.x, 0.4 + 0.12 * sin(uTime * 0.6 + uSeed));',
            '    float baseline = step(0.105, vUv.y) * step(vUv.y, 0.118) *',
            '        step(0.08, vUv.x) * step(vUv.x, 0.92);',
            '    vec3 color = glass;',
            '    color = mix(color, uAccent * (0.75 + barHeat), bars);',
            '    color += uAccent * header * 1.1;',
            '    color += uAccent * baseline * 0.55;',
            '    color += uAccent * border * 1.25;',
            '    float flicker = 0.97 + 0.03 * sin(uTime * 19.0 + uSeed * 11.0);',
            '    float alpha = panel * (0.42 + bars * 0.5 + border * 0.58 + header * 0.5) *',
            '        flicker * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(color * flicker, min(alpha, 1.0));',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const holoPointsVertexShader = [
            'attribute float aPhase;',
            'uniform float uTime;',
            'uniform float uPixelRatio;',
            'varying float vY;',
            'varying float vPhase;',
            'void main() {',
            '    vY = position.y;',
            '    vPhase = aPhase;',
            '    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
            '    gl_PointSize = 2.4 * uPixelRatio * (150.0 / -mvPosition.z) * 0.5;',
            '    gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n');

        const holoPointsFragmentShader = [
            'uniform float uTime;',
            'uniform float uOpacity;',
            'varying float vY;',
            'varying float vPhase;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float disc = exp(-d * d * 5.0);',
            '    float scan = 0.62 + 0.38 * sin(vY * 34.0 - uTime * 4.5 + vPhase);',
            '    float alpha = disc * scan * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vec3(0.03, 0.42, 0.38) * (1.4 + scan), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const coneFragmentShader = [
            'uniform float uOpacity;',
            'uniform float uTime;',
            'varying vec2 vUv;',
            'void main() {',
            '    float vertical = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));',
            '    float shimmer = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0);',
            '    float alpha = vertical * 0.3 * shimmer * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vec3(0.09, 0.55, 0.5), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const sweepFragmentShader = [
            'uniform float uOpacity;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec2 p = vUv * 2.0 - 1.0;',
            '    float radius = length(p);',
            '    float angle = atan(p.y, p.x);',
            '    float sector = smoothstep(-0.05, 0.46, angle) * (1.0 - smoothstep(0.46, 0.56, angle));',
            '    float leadingEdge = smoothstep(0.045, 0.0, abs(angle - 0.46)) * step(radius, 0.97);',
            '    float radial = smoothstep(1.0, 0.12, radius);',
            '    float alpha = (sector * radial * 0.62 + leadingEdge * 0.5) * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vec3(0.05, 0.4, 0.36), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const contactShadowFragmentShader = [
            'uniform float uOpacity;',
            'varying vec2 vUv;',
            'void main() {',
            '    float radius = length(vUv - 0.5) * 2.0;',
            '    float alpha = smoothstep(1.0, 0.1, radius) * 0.3 * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vec3(0.04, 0.15, 0.14), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const dustVertexShader = [
            'attribute float aPhase;',
            'attribute float aSpeed;',
            'attribute float aSize;',
            'uniform float uTime;',
            'uniform float uPixelRatio;',
            'varying float vAlpha;',
            'void main() {',
            '    vec3 displaced = position;',
            '    displaced.x += sin(uTime * 0.14 * aSpeed + aPhase) * 0.35;',
            '    displaced.y += mod(position.y + uTime * 0.045 * aSpeed, 3.6) - position.y;',
            '    displaced.z += cos(uTime * 0.1 * aSpeed + aPhase * 1.7) * 0.25;',
            '    vAlpha = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase * 3.0);',
            '    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);',
            '    gl_PointSize = aSize * uPixelRatio * (150.0 / -mvPosition.z) * 0.05;',
            '    gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n');

        const dustFragmentShader = [
            'uniform float uOpacity;',
            'varying float vAlpha;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float disc = exp(-d * d * 6.0);',
            '    float alpha = disc * vAlpha * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vec3(0.1, 0.5, 0.47), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        function makeShaderMaterial(collection, options) {
            const uniforms = { uTime, uPixelRatio };
            const extra = options.uniforms || {};
            Object.keys(extra).forEach(key => { uniforms[key] = extra[key]; });
            const material = new THREE.ShaderMaterial({
                vertexShader: options.vertexShader,
                fragmentShader: options.fragmentShader,
                uniforms,
                depthTest: options.depthTest !== false,
                side: options.side || THREE.FrontSide,
                blending: options.blending || THREE.NormalBlending
            });
            return registerMaterial(collection, material, options.opacity, options.keepDepthWrite);
        }

        /* ------------------------------------------------------------------
         * Studio environment map (PMREM) for physically based lab materials.
         * ------------------------------------------------------------------ */

        let environmentTarget = null;
        function buildEnvironment() {
            if (environmentTarget || !THREE.PMREMGenerator) return;
            const envScene = new THREE.Scene();
            const gradientMaterial = new THREE.ShaderMaterial({
                side: THREE.BackSide,
                vertexShader: [
                    'varying vec3 vDir;',
                    'void main() {',
                    '    vDir = normalize(position);',
                    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'varying vec3 vDir;',
                    'void main() {',
                    '    vec3 direction = normalize(vDir);',
                    '    vec3 base = mix(vec3(0.52, 0.6, 0.58), vec3(1.5, 1.58, 1.55),',
                    '        smoothstep(-0.4, 0.75, direction.y));',
                    '    float boxKey = smoothstep(0.82, 0.94,',
                    '        dot(direction, normalize(vec3(0.55, 0.7, 0.45))));',
                    '    float boxFill = smoothstep(0.86, 0.96,',
                    '        dot(direction, normalize(vec3(-0.7, 0.45, 0.35))));',
                    '    float boxRim = smoothstep(0.9, 0.98,',
                    '        dot(direction, normalize(vec3(0.1, 0.35, -0.95))));',
                    '    vec3 color = base + vec3(3.4, 3.35, 3.2) * boxKey +',
                    '        vec3(1.4, 1.75, 1.7) * boxFill + vec3(1.1, 1.5, 1.45) * boxRim;',
                    '    color += vec3(0.16, 0.24, 0.22) * smoothstep(-0.25, -0.9, direction.y);',
                    '    gl_FragColor = vec4(color, 1.0);',
                    '}'
                ].join('\n')
            });
            const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), gradientMaterial);
            envScene.add(sky);
            let generator = null;
            try {
                generator = new THREE.PMREMGenerator(renderer);
                environmentTarget = generator.fromScene(envScene, 0.04);
                scene.environment = environmentTarget.texture;
            } catch (error) {
                environmentTarget = null;
            } finally {
                if (generator) generator.dispose();
            }
            sky.geometry.dispose();
            gradientMaterial.dispose();
        }

        /* ------------------------------------------------------------------
         * Light theme — robotics laboratory
         * ------------------------------------------------------------------ */

        const labRefs = {
            armYaw: null,
            shoulder: null,
            elbow: null,
            wrist: null,
            wristRoll: null,
            fingerLeft: null,
            fingerRight: null,
            armLedRing: null,
            amr: null,
            amrWheels: [],
            amrSweep: null,
            amrLidar: null,
            quadruped: null,
            quadrupedBody: null,
            quadrupedHead: null,
            quadrupedLegs: [],
            holoGlobe: null,
            holoRings: [],
            panels: [],
            statusLights: [],
            pulseMaterials: []
        };

        function physicalMaterial(color, options) {
            const settings = options || {};
            const material = new THREE.MeshPhysicalMaterial({
                color,
                roughness: settings.roughness === undefined ? 0.42 : settings.roughness,
                metalness: settings.metalness === undefined ? 0.1 : settings.metalness,
                clearcoat: settings.clearcoat === undefined ? 0 : settings.clearcoat,
                clearcoatRoughness: 0.22,
                emissive: settings.emissive || 0x000000,
                emissiveIntensity: settings.emissiveIntensity === undefined ? 1 : settings.emissiveIntensity,
                envMapIntensity: settings.envMapIntensity === undefined ? 0.75 : settings.envMapIntensity
            });
            return registerMaterial(labMaterials, material, 1, true);
        }

        /* Shadow casting is opt-in: only silhouettes large enough to read at
         * the shadow-map resolution are worth a depth-pass draw call. */
        function solidMesh(parent, geometry, material, position, rotation, castShadow) {
            const mesh = new THREE.Mesh(geometry, material);
            if (position) mesh.position.set(position[0], position[1], position[2]);
            if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
            mesh.castShadow = castShadow === true;
            parent.add(mesh);
            return mesh;
        }

        function buildLaboratory() {
            const shellWhite = physicalMaterial(0xf2f7f5, {
                roughness: 0.26, metalness: 0.04, clearcoat: 0.85, envMapIntensity: 0.9
            });
            const shellMint = physicalMaterial(0xd7e9e4, {
                roughness: 0.34, metalness: 0.06, clearcoat: 0.5
            });
            const graphite = physicalMaterial(0x24403d, {
                roughness: 0.38, metalness: 0.55, envMapIntensity: 0.85
            });
            const tealMetal = physicalMaterial(0x0f766e, {
                roughness: 0.3, metalness: 0.75, envMapIntensity: 1.05
            });
            const rubber = physicalMaterial(0x18302e, { roughness: 0.88, metalness: 0.02, envMapIntensity: 0.3 });
            const amber = physicalMaterial(0xe97435, {
                roughness: 0.32, metalness: 0.15, clearcoat: 0.6,
                emissive: 0x93300a, emissiveIntensity: 0.32
            });
            const ledCyan = physicalMaterial(0x9ef7ec, {
                roughness: 0.2, metalness: 0,
                emissive: 0x19c8b8, emissiveIntensity: 1.5, envMapIntensity: 0.2
            });
            labRefs.pulseMaterials.push(ledCyan);

            /* Lighting rig. */
            const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa8c6c0, 1.15);
            const keyLight = new THREE.DirectionalLight(0xfff4e6, 3.1);
            keyLight.position.set(4.6, 8.2, 5.6);
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.set(lowPowerDevice ? 512 : 1024, lowPowerDevice ? 512 : 1024);
            keyLight.shadow.camera.left = -7;
            keyLight.shadow.camera.right = 7;
            keyLight.shadow.camera.top = 8;
            keyLight.shadow.camera.bottom = -4;
            keyLight.shadow.camera.near = 1;
            keyLight.shadow.camera.far = 24;
            keyLight.shadow.bias = -0.0004;
            keyLight.shadow.normalBias = 0.02;
            const keyTarget = new THREE.Object3D();
            keyTarget.position.set(0, 0, 0);
            keyLight.target = keyTarget;
            const rimLight = new THREE.PointLight(0x5eead4, 22, 16, 2);
            rimLight.position.set(-3.4, 3.4, 3.2);
            const warmFill = new THREE.PointLight(0xffb27a, 9, 9, 2);
            warmFill.position.set(1.4, 1.8, 2.4);
            labInner.add(hemisphere, keyLight, keyTarget, rimLight, warmFill);

            /* Floor: real soft shadows + holographic blueprint grid. */
            const shadowMaterial = registerMaterial(
                labMaterials,
                new THREE.ShadowMaterial({ color: 0x10312e }),
                0.3,
                false
            );
            const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), shadowMaterial);
            shadowPlane.rotation.x = -Math.PI / 2;
            shadowPlane.receiveShadow = true;
            labInner.add(shadowPlane);

            const gridMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: gridFragmentShader,
                opacity: 1,
                side: THREE.DoubleSide
            });
            const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), gridMaterial);
            gridPlane.rotation.x = -Math.PI / 2;
            gridPlane.position.y = 0.01;
            labInner.add(gridPlane);

            /* Soft radial contact shadows anchor each robot to the floor. */
            const contactMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: contactShadowFragmentShader,
                opacity: 1
            });
            [
                [0.3, 0.15, 1.9], [-2.45, 0.7, 3.4], [2.62, -0.25, 2.2], [-0.55, -2.1, 3.3]
            ].forEach(entry => {
                const contact = new THREE.Mesh(
                    new THREE.CircleGeometry(entry[2] * 0.5, 28),
                    contactMaterial
                );
                contact.rotation.x = -Math.PI / 2;
                contact.position.set(entry[0], 0.005, entry[1]);
                contact.castShadow = false;
                labInner.add(contact);
            });

            /* Workbench with a live monitor. */
            const bench = new THREE.Group();
            bench.position.set(-0.55, 0, -2.1);
            const benchTop = solidMesh(bench, new THREE.BoxGeometry(2.75, 0.1, 0.95), shellWhite,
                [0, 1.04, 0], null, true);
            benchTop.receiveShadow = true;
            solidMesh(bench, new THREE.BoxGeometry(2.55, 0.05, 0.8), graphite, [0, 0.96, 0]);
            [[-1.2, -0.32], [1.2, -0.32], [-1.2, 0.32], [1.2, 0.32]].forEach(entry => {
                solidMesh(bench, new THREE.CylinderGeometry(0.045, 0.05, 0.96, 12), graphite,
                    [entry[0], 0.48, entry[1]], null, true);
            });
            solidMesh(bench, new THREE.BoxGeometry(0.98, 0.62, 0.05), graphite,
                [-0.55, 1.62, -0.12], [-0.06, 0.12, 0], true);
            const screenMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: screenFragmentShader,
                opacity: 0.96
            });
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.52), screenMaterial);
            screen.position.set(-0.55, 1.62, -0.09);
            screen.rotation.set(-0.06, 0.12, 0);
            screen.castShadow = false;
            bench.add(screen);
            solidMesh(bench, new THREE.CylinderGeometry(0.05, 0.09, 0.28, 10), graphite, [-0.55, 1.24, -0.14]);
            solidMesh(bench, new THREE.CylinderGeometry(0.085, 0.095, 0.13, 14), shellMint, [0.62, 1.16, 0.24]);
            solidMesh(bench, new THREE.BoxGeometry(0.4, 0.1, 0.3), tealMetal, [1.02, 1.14, -0.08]);
            labRefs.statusLights.push(
                solidMesh(bench, new THREE.SphereGeometry(0.028, 10, 8), ledCyan, [1.02, 1.21, 0.04], null, false)
            );
            labInner.add(bench);

            /* Holographic globe projected above the bench. */
            const holo = new THREE.Group();
            holo.position.set(0.45, 0, 0);
            bench.add(holo);
            solidMesh(holo, new THREE.CylinderGeometry(0.14, 0.17, 0.07, 20), graphite, [0, 1.13, 0.1]);
            solidMesh(holo, new THREE.TorusGeometry(0.15, 0.012, 8, 28), tealMetal,
                [0, 1.17, 0.1], [Math.PI / 2, 0, 0], false);
            const coneMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: coneFragmentShader,
                opacity: 0.75,
                side: THREE.DoubleSide,
                depthTest: true
            });
            const cone = new THREE.Mesh(
                new THREE.CylinderGeometry(0.42, 0.05, 0.62, 24, 1, true),
                coneMaterial
            );
            cone.position.set(0, 1.49, 0.1);
            cone.castShadow = false;
            holo.add(cone);

            const globe = new THREE.Group();
            globe.position.set(0, 1.92, 0.1);
            holo.add(globe);
            labRefs.holoGlobe = globe;
            const globePointCount = lowPowerDevice ? 150 : 260;
            const globePositions = new Float32Array(globePointCount * 3);
            const globePhases = new Float32Array(globePointCount);
            const golden = Math.PI * (3 - Math.sqrt(5));
            for (let index = 0; index < globePointCount; index += 1) {
                const y = 1 - (index / (globePointCount - 1)) * 2;
                const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
                const theta = golden * index;
                globePositions[index * 3] = Math.cos(theta) * ringRadius * 0.34;
                globePositions[index * 3 + 1] = y * 0.34;
                globePositions[index * 3 + 2] = Math.sin(theta) * ringRadius * 0.34;
                globePhases[index] = random() * Math.PI * 2;
            }
            const globeGeometry = new THREE.BufferGeometry();
            globeGeometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3));
            globeGeometry.setAttribute('aPhase', new THREE.BufferAttribute(globePhases, 1));
            const globeMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: holoPointsVertexShader,
                fragmentShader: holoPointsFragmentShader,
                opacity: 0.9
            });
            globe.add(new THREE.Points(globeGeometry, globeMaterial));
            const ringMaterial = registerMaterial(
                labMaterials,
                new THREE.MeshBasicMaterial({ color: 0x0f8e83, side: THREE.DoubleSide }),
                0.62,
                false
            );
            [0.42, 0.48].forEach((ringRadius, ringIndex) => {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(ringRadius, 0.01, 6, 48),
                    ringMaterial
                );
                ring.rotation.x = Math.PI / 2 + (ringIndex === 0 ? 0.42 : -0.3);
                ring.castShadow = false;
                globe.add(ring);
                labRefs.holoRings.push(ring);
            });

            /* Floating holo dashboards. */
            [
                {
                    position: [2.15, 2.5, 0.35], size: [0.85, 0.55],
                    seed: 1.7, tilt: -0.22, accent: 0x11a597
                },
                {
                    position: [2.9, 1.72, 0.75], size: [0.6, 0.42],
                    seed: 6.3, tilt: -0.3, accent: 0xe08236
                }
            ].forEach(config => {
                const panelMaterial = makeShaderMaterial(labMaterials, {
                    vertexShader: nebulaVertexShader,
                    fragmentShader: panelFragmentShader,
                    opacity: 0.95,
                    side: THREE.DoubleSide,
                    uniforms: {
                        uSeed: { value: config.seed },
                        uAccent: { value: new THREE.Color(config.accent) }
                    }
                });
                const panel = new THREE.Mesh(
                    new THREE.PlaneGeometry(config.size[0], config.size[1]),
                    panelMaterial
                );
                panel.position.set(config.position[0], config.position[1], config.position[2]);
                panel.rotation.y = config.tilt;
                panel.castShadow = false;
                panel.userData.baseY = config.position[1];
                panel.userData.seed = config.seed;
                labInner.add(panel);
                labRefs.panels.push(panel);
            });

            /* Industrial 6-axis arm running a pick-and-place loop. */
            const arm = new THREE.Group();
            arm.position.set(0.3, 0, 0.15);
            solidMesh(arm, new THREE.CylinderGeometry(0.6, 0.68, 0.14, 28), graphite,
                [0, 0.07, 0], null, true);
            const ledRing = solidMesh(arm, new THREE.TorusGeometry(0.55, 0.02, 8, 40), ledCyan,
                [0, 0.15, 0], [Math.PI / 2, 0, 0], false);
            labRefs.armLedRing = ledRing;
            solidMesh(arm, new THREE.CylinderGeometry(0.34, 0.46, 0.5, 24), shellWhite,
                [0, 0.4, 0], null, true);

            const armYaw = new THREE.Group();
            armYaw.position.set(0, 0.66, 0);
            arm.add(armYaw);
            labRefs.armYaw = armYaw;
            solidMesh(armYaw, new THREE.CylinderGeometry(0.3, 0.34, 0.26, 24), tealMetal,
                [0, 0.1, 0], null, true);
            solidMesh(armYaw, new THREE.BoxGeometry(0.1, 0.32, 0.3), graphite, [-0.18, 0.34, 0]);
            solidMesh(armYaw, new THREE.BoxGeometry(0.1, 0.32, 0.3), graphite, [0.18, 0.34, 0]);

            const shoulder = new THREE.Group();
            shoulder.position.set(0, 0.4, 0);
            armYaw.add(shoulder);
            labRefs.shoulder = shoulder;
            solidMesh(shoulder, new THREE.SphereGeometry(0.2, 24, 16), graphite, [0, 0, 0]);
            solidMesh(shoulder, new THREE.CapsuleGeometry(0.13, 0.92, 6, 18), shellWhite,
                [0, 0.56, 0], null, true);
            solidMesh(shoulder, new THREE.BoxGeometry(0.08, 0.7, 0.06), tealMetal, [0.13, 0.52, 0]);

            const elbow = new THREE.Group();
            elbow.position.set(0, 1.1, 0);
            shoulder.add(elbow);
            labRefs.elbow = elbow;
            solidMesh(elbow, new THREE.SphereGeometry(0.16, 24, 16), tealMetal, [0, 0, 0]);
            solidMesh(elbow, new THREE.CapsuleGeometry(0.1, 0.7, 6, 18), shellWhite,
                [0, 0.44, 0], null, true);
            labRefs.statusLights.push(
                solidMesh(elbow, new THREE.SphereGeometry(0.032, 10, 8), amber, [0.11, 0.2, 0], null, false)
            );

            const wrist = new THREE.Group();
            wrist.position.set(0, 0.86, 0);
            elbow.add(wrist);
            labRefs.wrist = wrist;
            solidMesh(wrist, new THREE.SphereGeometry(0.12, 20, 14), graphite, [0, 0, 0]);
            const wristRoll = new THREE.Group();
            wristRoll.position.set(0, 0.1, 0);
            wrist.add(wristRoll);
            labRefs.wristRoll = wristRoll;
            solidMesh(wristRoll, new THREE.CylinderGeometry(0.085, 0.095, 0.16, 18), tealMetal, [0, 0.05, 0]);
            solidMesh(wristRoll, new THREE.BoxGeometry(0.32, 0.07, 0.16), graphite, [0, 0.17, 0]);
            const fingerGeometry = new THREE.TorusGeometry(0.15, 0.032, 8, 14, 2.3);
            const fingerLeft = solidMesh(wristRoll, fingerGeometry, graphite,
                [-0.09, 0.24, 0], [0, 0, -0.45]);
            const fingerRight = solidMesh(wristRoll, fingerGeometry, graphite,
                [0.09, 0.24, 0], [0, 0, Math.PI - 2.3 + 0.45]);
            labRefs.fingerLeft = fingerLeft;
            labRefs.fingerRight = fingerRight;
            labInner.add(arm);

            /* Sagging service cable from the arm base to the bench. */
            const cableCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0.05, 0.16, -0.35),
                new THREE.Vector3(-0.15, 0.05, -1.0),
                new THREE.Vector3(-0.45, 0.03, -1.55),
                new THREE.Vector3(-0.75, 0.5, -1.95)
            ]);
            solidMesh(labInner, new THREE.TubeGeometry(cableCurve, 24, 0.022, 6), rubber,
                [0.3, 0, 0.15], null, false);

            /* Autonomous mobile robot patrolling an elliptical route. */
            const amr = new THREE.Group();
            labRefs.amr = amr;
            solidMesh(amr, new THREE.BoxGeometry(1.05, 0.2, 0.66), graphite,
                [0, 0.24, 0], null, true);
            solidMesh(amr, new THREE.BoxGeometry(0.95, 0.14, 0.58), shellWhite,
                [0, 0.41, 0], null, true);
            solidMesh(amr, new THREE.BoxGeometry(0.2, 0.06, 0.5), amber, [0.46, 0.32, 0]);
            solidMesh(amr, new THREE.BoxGeometry(0.2, 0.06, 0.5), amber, [-0.46, 0.32, 0]);
            const wheelTire = new THREE.TorusGeometry(0.13, 0.05, 10, 20);
            const hubGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12);
            const spokeGeometry = new THREE.BoxGeometry(0.2, 0.024, 0.02);
            [[-0.34, -0.36], [0.34, -0.36], [-0.34, 0.36], [0.34, 0.36]].forEach(entry => {
                const wheel = new THREE.Group();
                wheel.position.set(entry[0], 0.17, entry[1]);
                solidMesh(wheel, wheelTire, rubber, [0, 0, 0], null, true);
                solidMesh(wheel, hubGeometry, tealMetal, [0, 0, 0], [Math.PI / 2, 0, 0]);
                for (let spoke = 0; spoke < 3; spoke += 1) {
                    solidMesh(wheel, spokeGeometry, shellMint, [0, 0, 0],
                        [0, 0, spoke * Math.PI / 3], false);
                }
                amr.add(wheel);
                labRefs.amrWheels.push(wheel);
            });
            solidMesh(amr, new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10), graphite, [0, 0.62, 0]);
            const lidar = solidMesh(amr, new THREE.CylinderGeometry(0.085, 0.095, 0.1, 18), tealMetal, [0, 0.82, 0]);
            solidMesh(lidar, new THREE.BoxGeometry(0.02, 0.05, 0.19), ledCyan, [0, 0, 0], null, false);
            labRefs.amrLidar = lidar;
            labRefs.statusLights.push(
                solidMesh(amr, new THREE.SphereGeometry(0.03, 10, 8), amber, [-0.5, 0.46, 0.2], null, false)
            );
            const sweepSpinner = new THREE.Group();
            sweepSpinner.position.y = 0.04;
            const sweepMaterial = makeShaderMaterial(labMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: sweepFragmentShader,
                opacity: 0.9,
                side: THREE.DoubleSide
            });
            const sweep = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), sweepMaterial);
            sweep.rotation.x = -Math.PI / 2;
            sweep.castShadow = false;
            sweepSpinner.add(sweep);
            amr.add(sweepSpinner);
            labRefs.amrSweep = sweepSpinner;
            labInner.add(amr);

            /* Quadruped inspection robot. */
            const quadruped = new THREE.Group();
            quadruped.position.set(2.62, 0, -0.25);
            quadruped.rotation.y = -0.55;
            labRefs.quadruped = quadruped;
            const body = new THREE.Group();
            body.position.y = 0.98;
            quadruped.add(body);
            labRefs.quadrupedBody = body;
            solidMesh(body, new THREE.CapsuleGeometry(0.24, 0.66, 6, 18), shellWhite,
                [0, 0, 0], [0, 0, Math.PI / 2], true);
            solidMesh(body, new THREE.BoxGeometry(0.42, 0.12, 0.3), tealMetal, [-0.08, 0.24, 0]);
            solidMesh(body, new THREE.CylinderGeometry(0.008, 0.008, 0.4, 6), graphite, [-0.42, 0.42, 0]);
            labRefs.statusLights.push(
                solidMesh(body, new THREE.SphereGeometry(0.02, 8, 6), amber, [-0.42, 0.63, 0], null, false)
            );
            const head = new THREE.Group();
            head.position.set(0.5, 0.08, 0);
            body.add(head);
            labRefs.quadrupedHead = head;
            solidMesh(head, new THREE.BoxGeometry(0.28, 0.22, 0.26), shellMint,
                [0.05, 0, 0], null, true);
            solidMesh(head, new THREE.BoxGeometry(0.05, 0.11, 0.24), ledCyan, [0.2, 0.01, 0], null, false);
            const legAnchors = [
                [0.38, 0.17, 0], [0.38, -0.17, Math.PI],
                [-0.38, 0.17, Math.PI], [-0.38, -0.17, 0]
            ];
            legAnchors.forEach(anchor => {
                const hip = new THREE.Group();
                hip.position.set(anchor[0], 0.84, anchor[1]);
                solidMesh(hip, new THREE.SphereGeometry(0.08, 14, 10), tealMetal, [0, 0, 0]);
                solidMesh(hip, new THREE.CapsuleGeometry(0.062, 0.3, 4, 12), shellWhite,
                    [0, -0.19, 0], null, true);
                const knee = new THREE.Group();
                knee.position.set(0, -0.38, 0);
                hip.add(knee);
                solidMesh(knee, new THREE.SphereGeometry(0.058, 12, 8), graphite, [0, 0, 0]);
                solidMesh(knee, new THREE.CapsuleGeometry(0.045, 0.3, 4, 12), shellMint,
                    [0, -0.19, 0], null, true);
                solidMesh(knee, new THREE.SphereGeometry(0.05, 10, 8), rubber, [0, -0.4, 0]);
                hip.rotation.z = 0.1;
                knee.rotation.z = -0.16;
                quadruped.add(hip);
                labRefs.quadrupedLegs.push({
                    hip,
                    knee,
                    hipBase: hip.rotation.z,
                    kneeBase: knee.rotation.z,
                    phase: anchor[2]
                });
            });
            labInner.add(quadruped);

            /* Drifting holographic motes give the air some depth. */
            if (!lowPowerDevice) {
                const moteCount = 110;
                const motePositions = new Float32Array(moteCount * 3);
                const motePhases = new Float32Array(moteCount);
                const moteSpeeds = new Float32Array(moteCount);
                const moteSizes = new Float32Array(moteCount);
                for (let index = 0; index < moteCount; index += 1) {
                    motePositions[index * 3] = (random() - 0.5) * 8;
                    motePositions[index * 3 + 1] = 0.2 + random() * 3.4;
                    motePositions[index * 3 + 2] = (random() - 0.5) * 5;
                    motePhases[index] = random() * Math.PI * 2;
                    moteSpeeds[index] = 0.5 + random() * 1.4;
                    moteSizes[index] = 18 + random() * 30;
                }
                const moteGeometry = new THREE.BufferGeometry();
                moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
                moteGeometry.setAttribute('aPhase', new THREE.BufferAttribute(motePhases, 1));
                moteGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(moteSpeeds, 1));
                moteGeometry.setAttribute('aSize', new THREE.BufferAttribute(moteSizes, 1));
                const moteMaterial = makeShaderMaterial(labMaterials, {
                    vertexShader: dustVertexShader,
                    fragmentShader: dustFragmentShader,
                    opacity: 0.5
                });
                const motes = new THREE.Points(moteGeometry, moteMaterial);
                labInner.add(motes);
            }
        }

        /* Arm pick-and-place choreography. */
        const armTimeline = {
            transition: 1.35,
            poses: [
                { yaw: 0.15, shoulder: -0.35, elbow: 0.95, wrist: -0.55, grip: 0.075, hold: 0.8 },
                { yaw: 0.85, shoulder: 0.28, elbow: 1.35, wrist: -1.15, grip: 0.075, hold: 0.15 },
                { yaw: 0.85, shoulder: 0.34, elbow: 1.42, wrist: -1.22, grip: 0.02, hold: 0.4 },
                { yaw: -0.7, shoulder: -0.45, elbow: 0.7, wrist: -0.25, grip: 0.02, hold: 0.25 },
                { yaw: -0.7, shoulder: -0.12, elbow: 1.05, wrist: -0.85, grip: 0.075, hold: 0.5 }
            ]
        };
        armTimeline.total = armTimeline.poses.reduce(
            (sum, pose) => sum + armTimeline.transition + pose.hold, 0
        );

        const armPose = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0, grip: 0.075 };
        function evaluateArmPose(time) {
            let cursor = time % armTimeline.total;
            const poses = armTimeline.poses;
            for (let index = 0; index < poses.length; index += 1) {
                const current = poses[index];
                const next = poses[(index + 1) % poses.length];
                if (cursor < current.hold) {
                    armPose.yaw = current.yaw;
                    armPose.shoulder = current.shoulder;
                    armPose.elbow = current.elbow;
                    armPose.wrist = current.wrist;
                    armPose.grip = current.grip;
                    return;
                }
                cursor -= current.hold;
                if (cursor < armTimeline.transition) {
                    const blend = easeInOutCubic(cursor / armTimeline.transition);
                    armPose.yaw = current.yaw + (next.yaw - current.yaw) * blend;
                    armPose.shoulder = current.shoulder + (next.shoulder - current.shoulder) * blend;
                    armPose.elbow = current.elbow + (next.elbow - current.elbow) * blend;
                    armPose.wrist = current.wrist + (next.wrist - current.wrist) * blend;
                    armPose.grip = current.grip + (next.grip - current.grip) * blend;
                    return;
                }
                cursor -= armTimeline.transition;
            }
        }

        /* ------------------------------------------------------------------
         * Dark theme — neural cosmos
         * ------------------------------------------------------------------ */

        const spaceRefs = {
            starLayers: [],
            nebulae: [],
            network: null,
            meteors: []
        };

        function makeStarField(count, spread, sizeRange, brightRatio, baseOpacity) {
            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const phases = new Float32Array(count);
            const speeds = new Float32Array(count);
            const colors = new Float32Array(count * 3);
            const spikes = new Float32Array(count);
            const palette = [
                new THREE.Color(0xffffff),
                new THREE.Color(0xfff3d6),
                new THREE.Color(0xbfe3ff),
                new THREE.Color(0xd9ccff)
            ];
            for (let index = 0; index < count; index += 1) {
                positions[index * 3] = (random() - 0.5) * spread[0];
                positions[index * 3 + 1] = (random() - 0.5) * spread[1];
                positions[index * 3 + 2] = (random() - 0.5) * spread[2] - 5;
                const bright = random() < brightRatio;
                sizes[index] = bright
                    ? sizeRange[1] * (0.85 + random() * 0.5)
                    : sizeRange[0] + random() * (sizeRange[1] - sizeRange[0]) * 0.55;
                phases[index] = random() * Math.PI * 2;
                speeds[index] = 0.35 + random() * 1.6;
                spikes[index] = bright ? 1 : 0;
                const color = palette[Math.floor(random() * palette.length)];
                colors[index * 3] = color.r;
                colors[index * 3 + 1] = color.g;
                colors[index * 3 + 2] = color.b;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSpike', new THREE.BufferAttribute(spikes, 1));
            const material = makeShaderMaterial(spaceMaterials, {
                vertexShader: starVertexShader,
                fragmentShader: starFragmentShader,
                opacity: baseOpacity,
                blending: THREE.AdditiveBlending,
                depthTest: false
            });
            return new THREE.Points(geometry, material);
        }

        function makeNebulaPlane(config) {
            const material = makeShaderMaterial(spaceMaterials, {
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthTest: false,
                uniforms: {
                    uSeed: { value: config.seed },
                    uScale: { value: config.scale },
                    uColorA: { value: new THREE.Color(config.colors[0]) },
                    uColorB: { value: new THREE.Color(config.colors[1]) },
                    uColorC: { value: new THREE.Color(config.colors[2]) }
                }
            });
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(config.size[0], config.size[1]),
                material
            );
            plane.position.set(config.position[0], config.position[1], config.position[2]);
            plane.renderOrder = -2;
            return plane;
        }

        function buildNeuralNetwork() {
            const network = new THREE.Group();
            network.position.set(0.4, 0.3, 0);
            network.rotation.y = -0.16;
            spaceInner.add(network);
            spaceRefs.network = network;

            const nodeCount = lowPowerDevice ? 72 : 118;
            const clusterCenters = [
                new THREE.Vector3(-1.8, 0.75, -0.35),
                new THREE.Vector3(0.55, -0.5, 0.4),
                new THREE.Vector3(2.25, 0.95, -0.15)
            ];
            const nodePositions = [];
            for (let index = 0; index < nodeCount; index += 1) {
                let position;
                if (index % 9 === 8) {
                    position = new THREE.Vector3(
                        (random() - 0.5) * 6.4,
                        (random() - 0.5) * 3.6,
                        (random() - 0.5) * 2.4
                    );
                } else {
                    const center = clusterCenters[index % clusterCenters.length];
                    position = new THREE.Vector3(
                        center.x + (random() + random() + random() - 1.5) * 1.4,
                        center.y + (random() + random() + random() - 1.5) * 1.05,
                        center.z + (random() + random() + random() - 1.5) * 0.85
                    );
                }
                nodePositions.push(position);
            }

            const positionArray = new Float32Array(nodeCount * 3);
            const sizeArray = new Float32Array(nodeCount);
            const phaseArray = new Float32Array(nodeCount);
            const speedArray = new Float32Array(nodeCount);
            const colorArray = new Float32Array(nodeCount * 3);
            const cyan = new THREE.Color(0x7dd3fc);
            const violet = new THREE.Color(0xa78bfa);
            const white = new THREE.Color(0xeef6ff);
            const hubIndices = new Set();
            for (let index = 0; index < nodeCount; index += 1) {
                if (index % 8 === 3) hubIndices.add(index);
            }
            nodePositions.forEach((position, index) => {
                positionArray[index * 3] = position.x;
                positionArray[index * 3 + 1] = position.y;
                positionArray[index * 3 + 2] = position.z;
                const isHub = hubIndices.has(index);
                sizeArray[index] = isHub ? 1.25 + random() * 0.45 : 0.55 + random() * 0.4;
                phaseArray[index] = random() * Math.PI * 2;
                speedArray[index] = isHub ? 0.9 + random() * 0.8 : 0.35 + random() * 0.7;
                const roll = random();
                const color = isHub
                    ? (roll < 0.6 ? white : cyan)
                    : (roll < 0.5 ? cyan : (roll < 0.85 ? violet : white));
                colorArray[index * 3] = color.r;
                colorArray[index * 3 + 1] = color.g;
                colorArray[index * 3 + 2] = color.b;
            });
            const nodeGeometry = new THREE.BufferGeometry();
            nodeGeometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            nodeGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizeArray, 1));
            nodeGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phaseArray, 1));
            nodeGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speedArray, 1));
            nodeGeometry.setAttribute('aColor', new THREE.BufferAttribute(colorArray, 3));
            const nodeMaterial = makeShaderMaterial(spaceMaterials, {
                vertexShader: nodeVertexShader,
                fragmentShader: nodeFragmentShader,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthTest: false,
                uniforms: { uPointer3, uPointerStrength }
            });
            network.add(new THREE.Points(nodeGeometry, nodeMaterial));

            /* Edges: nearest-neighbour synapses sampled as gentle arcs. */
            const edgeKeys = new Set();
            const edges = [];
            function addEdge(a, b) {
                if (a === b) return;
                const key = a < b ? a + '-' + b : b + '-' + a;
                if (edgeKeys.has(key)) return;
                edgeKeys.add(key);
                edges.push([a, b]);
            }
            nodePositions.forEach((position, index) => {
                const neighbours = nodePositions
                    .map((other, otherIndex) => ({
                        index: otherIndex,
                        distance: position.distanceTo(other)
                    }))
                    .filter(entry => entry.index !== index)
                    .sort((a, b) => a.distance - b.distance);
                const linkCount = hubIndices.has(index) ? 3 : 2;
                for (let link = 0; link < linkCount; link += 1) {
                    addEdge(index, neighbours[link].index);
                }
            });
            const hubs = Array.from(hubIndices);
            for (let link = 0; link < Math.min(10, hubs.length); link += 1) {
                addEdge(
                    hubs[Math.floor(random() * hubs.length)],
                    hubs[Math.floor(random() * hubs.length)]
                );
            }

            const segmentsPerEdge = 7;
            const vertexCount = edges.length * segmentsPerEdge * 2;
            const edgePositions = new Float32Array(vertexCount * 3);
            const edgeTs = new Float32Array(vertexCount);
            const edgeSeeds = new Float32Array(vertexCount);
            const start = new THREE.Vector3();
            const end = new THREE.Vector3();
            const middle = new THREE.Vector3();
            const direction = new THREE.Vector3();
            const perpendicular = new THREE.Vector3();
            const pointA = new THREE.Vector3();
            const pointB = new THREE.Vector3();
            let cursor = 0;
            edges.forEach(edge => {
                start.copy(nodePositions[edge[0]]);
                end.copy(nodePositions[edge[1]]);
                direction.subVectors(end, start);
                const length = direction.length();
                perpendicular.set(random() - 0.5, random() - 0.5, random() - 0.5)
                    .cross(direction).normalize()
                    .multiplyScalar(length * 0.14 * (random() - 0.5) * 2);
                middle.addVectors(start, end).multiplyScalar(0.5).add(perpendicular);
                const seed = random();
                function sampleCurve(t, target) {
                    const inverse = 1 - t;
                    target.set(
                        inverse * inverse * start.x + 2 * inverse * t * middle.x + t * t * end.x,
                        inverse * inverse * start.y + 2 * inverse * t * middle.y + t * t * end.y,
                        inverse * inverse * start.z + 2 * inverse * t * middle.z + t * t * end.z
                    );
                }
                for (let segment = 0; segment < segmentsPerEdge; segment += 1) {
                    const t0 = segment / segmentsPerEdge;
                    const t1 = (segment + 1) / segmentsPerEdge;
                    sampleCurve(t0, pointA);
                    sampleCurve(t1, pointB);
                    edgePositions[cursor * 3] = pointA.x;
                    edgePositions[cursor * 3 + 1] = pointA.y;
                    edgePositions[cursor * 3 + 2] = pointA.z;
                    edgeTs[cursor] = t0;
                    edgeSeeds[cursor] = seed;
                    cursor += 1;
                    edgePositions[cursor * 3] = pointB.x;
                    edgePositions[cursor * 3 + 1] = pointB.y;
                    edgePositions[cursor * 3 + 2] = pointB.z;
                    edgeTs[cursor] = t1;
                    edgeSeeds[cursor] = seed;
                    cursor += 1;
                }
            });
            const edgeGeometry = new THREE.BufferGeometry();
            edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
            edgeGeometry.setAttribute('aT', new THREE.BufferAttribute(edgeTs, 1));
            edgeGeometry.setAttribute('aSeed', new THREE.BufferAttribute(edgeSeeds, 1));
            const edgeMaterial = makeShaderMaterial(spaceMaterials, {
                vertexShader: edgeVertexShader,
                fragmentShader: edgeFragmentShader,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthTest: false,
                uniforms: { uPointer3, uPointerStrength }
            });
            network.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
        }

        function spawnMeteor(meteor, initial) {
            meteor.duration = 0.85 + random() * 0.5;
            meteor.delay = initial ? random() * 5 : 2.5 + random() * 6.5;
            meteor.elapsed = -meteor.delay;
            meteor.from.set(
                -4.5 + random() * 11,
                2.6 + random() * 3,
                -5.5 - random() * 2
            );
            const speed = 7 + random() * 3.5;
            const angle = -0.45 - random() * 0.35;
            meteor.velocity.set(
                Math.cos(angle) * (random() < 0.5 ? -1 : 1),
                Math.sin(angle),
                0
            ).multiplyScalar(speed);
            meteor.mesh.scale.set(2.2 + random() * 1.2, 0.055, 1);
            meteor.mesh.rotation.z = Math.atan2(meteor.velocity.y, meteor.velocity.x);
        }

        function buildSpace() {
            const farStars = makeStarField(
                lowPowerDevice ? 620 : 1500, [26, 15, 16], [0.28, 1.1], 0.045, 0.85
            );
            const nearStars = makeStarField(
                lowPowerDevice ? 90 : 230, [20, 11, 10], [0.5, 1.7], 0.12, 0.95
            );
            spaceInner.add(farStars, nearStars);
            spaceRefs.starLayers.push(farStars, nearStars);

            const nebulaConfigs = [
                {
                    size: [17, 10.5], position: [1.6, 1.1, -9],
                    colors: [0x2e1065, 0x7c3aed, 0x22d3ee],
                    opacity: 0.62, scale: 2.5, seed: 3.1
                },
                {
                    size: [12.5, 8], position: [4.6, -1.7, -7.5],
                    colors: [0x172554, 0x0891b2, 0x67e8f9],
                    opacity: 0.48, scale: 2.9, seed: 9.4
                },
                {
                    size: [18, 11], position: [-2.8, 0.3, -10.5],
                    colors: [0x3b0764, 0x9333ea, 0xf0abfc],
                    opacity: 0.5, scale: 2.2, seed: 15.9
                }
            ];
            const nebulaCount = lowPowerDevice ? 2 : nebulaConfigs.length;
            for (let index = 0; index < nebulaCount; index += 1) {
                const nebula = makeNebulaPlane(nebulaConfigs[index]);
                spaceInner.add(nebula);
                spaceRefs.nebulae.push(nebula);
            }

            buildNeuralNetwork();

            const meteorCount = lowPowerDevice ? 2 : 3;
            for (let index = 0; index < meteorCount; index += 1) {
                const material = makeShaderMaterial(spaceMaterials, {
                    vertexShader: meteorVertexShader,
                    fragmentShader: meteorFragmentShader,
                    opacity: 0.95,
                    blending: THREE.AdditiveBlending,
                    depthTest: false,
                    uniforms: { uLife: { value: -1 } }
                });
                const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
                mesh.visible = false;
                spaceInner.add(mesh);
                const meteor = {
                    mesh,
                    material,
                    from: new THREE.Vector3(),
                    velocity: new THREE.Vector3(),
                    duration: 1,
                    delay: 0,
                    elapsed: 0
                };
                spawnMeteor(meteor, true);
                spaceRefs.meteors.push(meteor);
            }
        }

        /* Each theme's scene is built lazily: the active one synchronously,
         * the hidden one on idle so first paint stays cheap. */
        let labBuilt = false;
        let spaceBuilt = false;
        let disposed = false;

        function ensureLab() {
            if (labBuilt) return;
            labBuilt = true;
            buildEnvironment();
            buildLaboratory();
        }

        function ensureSpace() {
            if (spaceBuilt) return;
            spaceBuilt = true;
            buildSpace();
        }

        if (html.dataset.theme === 'dark') {
            ensureSpace();
        } else {
            ensureLab();
        }

        /* ------------------------------------------------------------------
         * Layout, theme crossfade, pointer interaction
         * ------------------------------------------------------------------ */

        let viewportWidth = 0;
        let viewportHeight = 0;
        let mobileLayout = initialMobile;
        let resizeFrame = null;
        const cameraBase = new THREE.Vector3();
        const cameraTarget = new THREE.Vector3();
        const pointerTarget = new THREE.Vector2();
        const pointerCurrent = new THREE.Vector2();
        const pointerNdc = new THREE.Vector2(99, 99);
        let pointerActive = false;

        function applyLayout() {
            /* Size from the canvas's CSS box (100vw x 100vh) rather than the
             * window so mobile URL-bar show/hide doesn't stretch the scene. */
            const rect = canvas.getBoundingClientRect();
            viewportWidth = Math.max(1, Math.round(rect.width) || window.innerWidth);
            viewportHeight = Math.max(1, Math.round(rect.height) || window.innerHeight);
            mobileLayout = mobileQuery.matches;
            if (mobileLayout || !finePointerQuery.matches) {
                pointerActive = false;
                pointerTarget.set(0, 0);
            }

            camera.aspect = viewportWidth / viewportHeight;
            camera.fov = mobileLayout ? 43 : 34;
            cameraBase.set(0, mobileLayout ? 3.6 : 3.75, mobileLayout ? 15.5 : 15);
            cameraTarget.set(0, mobileLayout ? 0.25 : 0.55, 0);
            camera.position.copy(cameraBase);
            camera.lookAt(cameraTarget);
            camera.updateProjectionMatrix();

            if (mobileLayout) {
                labGroup.position.set(0.35, -2.9, -2.65);
                labGroup.scale.setScalar(0.72);
                spaceGroup.position.set(0.1, -1.7, -2.6);
                spaceGroup.scale.setScalar(1);
            } else {
                labGroup.position.set(3.3, -1.7, -0.3);
                labGroup.scale.setScalar(1.12);
                spaceGroup.position.set(3.05, 0.05, -0.9);
                spaceGroup.scale.setScalar(1);
            }

            renderer.setPixelRatio(
                Math.min(window.devicePixelRatio || 1, mobileLayout ? 1.25 : 1.75)
            );
            uPixelRatio.value = renderer.getPixelRatio();
            renderer.setSize(viewportWidth, viewportHeight, false);
        }

        let themeMix = html.dataset.theme === 'dark' ? 1 : 0;
        let targetThemeMix = themeMix;

        function applyMaterialWeight(materials, weight) {
            materials.forEach(material => {
                const base = material.userData.baseOpacity;
                if (material.userData.isShader) {
                    material.uniforms.uOpacity.value = base * weight;
                } else {
                    material.opacity = base * weight;
                }
                material.visible = weight > 0.008;
                if (material.userData.keepDepthWrite) {
                    /* Fully opaque materials go back to the opaque pass so the
                     * depth pre-sort can reject hidden fragments. */
                    const solid = weight > 0.985;
                    material.depthWrite = solid;
                    material.transparent = !solid;
                }
            });
        }

        function applyThemeWeights() {
            const labWeight = 1 - themeMix;
            const spaceWeight = themeMix;
            labGroup.visible = labWeight > 0.008;
            spaceGroup.visible = spaceWeight > 0.008;
            applyMaterialWeight(labMaterials, labWeight);
            applyMaterialWeight(spaceMaterials, spaceWeight);
            const labEase = easeInOutCubic(labWeight);
            const spaceEase = easeInOutCubic(spaceWeight);
            labInner.scale.setScalar(0.93 + 0.07 * labEase);
            spaceInner.scale.setScalar(0.93 + 0.07 * spaceEase);
            labInner.position.y = (1 - labEase) * -0.5;
            spaceInner.position.y = (1 - spaceEase) * 0.6;
            renderer.toneMappingExposure = 1.0 + labWeight * 0.14;
        }

        function setTheme(theme, immediate) {
            if (theme === 'dark') {
                ensureSpace();
            } else {
                ensureLab();
            }
            targetThemeMix = theme === 'dark' ? 1 : 0;
            if (immediate) themeMix = targetThemeMix;
            applyThemeWeights();
            if (document.hidden) renderFrame(performance.now(), 0);
        }

        /* Project the pointer onto scene planes for shader + robot reactions. */
        const pointerRay = new THREE.Vector3();
        const pointerWorld = new THREE.Vector3();
        const pointerLabLocal = new THREE.Vector3();
        function updatePointerTargets() {
            const strengthTarget = pointerActive && !mobileLayout && finePointerQuery.matches ? 1 : 0;
            uPointerStrength.value += (strengthTarget - uPointerStrength.value) * 0.06;
            if (uPointerStrength.value < 0.01) return;

            pointerRay.set(pointerNdc.x, pointerNdc.y, 0.5).unproject(camera)
                .sub(camera.position).normalize();

            /* Dark theme: intersection with the network plane (world z). */
            const planeZ = spaceGroup.position.z;
            if (Math.abs(pointerRay.z) > 0.0001) {
                const distance = (planeZ - camera.position.z) / pointerRay.z;
                if (distance > 0) {
                    pointerWorld.copy(camera.position).addScaledVector(pointerRay, distance);
                    uPointer3.value.copy(pointerWorld);
                }
            }

            /* Light theme: intersection with the lab floor (world y). */
            const floorY = labGroup.position.y;
            if (Math.abs(pointerRay.y) > 0.0001) {
                const distance = (floorY - camera.position.y) / pointerRay.y;
                if (distance > 0) {
                    pointerLabLocal.copy(camera.position).addScaledVector(pointerRay, distance);
                    labGroup.worldToLocal(pointerLabLocal);
                }
            }
        }

        /* ------------------------------------------------------------------
         * Animation
         * ------------------------------------------------------------------ */

        function updateLaboratory(time) {
            if (!labBuilt) return;
            evaluateArmPose(time);
            const wobble = Math.sin(time * 2.3) * 0.008;
            if (labRefs.armYaw) labRefs.armYaw.rotation.y = armPose.yaw;
            if (labRefs.shoulder) labRefs.shoulder.rotation.z = armPose.shoulder + wobble;
            if (labRefs.elbow) labRefs.elbow.rotation.z = armPose.elbow + wobble * 1.4;
            if (labRefs.wrist) labRefs.wrist.rotation.z = armPose.wrist;
            if (labRefs.wristRoll) labRefs.wristRoll.rotation.y = Math.sin(time * 0.4) * 0.9;
            if (labRefs.fingerLeft) labRefs.fingerLeft.position.x = -0.03 - armPose.grip;
            if (labRefs.fingerRight) labRefs.fingerRight.position.x = 0.03 + armPose.grip;

            /* AMR patrol loop. */
            if (labRefs.amr) {
                const theta = time * 0.24;
                const centerX = -2.45;
                const centerZ = 0.7;
                const radiusX = 1.05;
                const radiusZ = 0.6;
                labRefs.amr.position.set(
                    centerX + Math.cos(theta) * radiusX,
                    0,
                    centerZ + Math.sin(theta) * radiusZ
                );
                const dx = -Math.sin(theta) * radiusX;
                const dz = Math.cos(theta) * radiusZ;
                labRefs.amr.rotation.y = Math.atan2(-dz, dx);
                labRefs.amrWheels.forEach(wheel => {
                    wheel.rotation.z = -time * 2.1;
                });
                if (labRefs.amrSweep) labRefs.amrSweep.rotation.y = time * 1.7;
                if (labRefs.amrLidar) labRefs.amrLidar.rotation.y = time * 5.0;
            }

            /* Quadruped idles, breathes and watches the cursor. */
            if (labRefs.quadrupedBody) {
                labRefs.quadrupedBody.position.y = 0.98 + Math.sin(time * 1.1) * 0.02;
                labRefs.quadrupedBody.rotation.x = Math.sin(time * 0.55) * 0.015;
            }
            if (labRefs.quadrupedHead) {
                let headYaw = Math.sin(time * 0.32) * 0.38 + Math.sin(time * 0.17 + 2.0) * 0.18;
                if (uPointerStrength.value > 0.05 && labRefs.quadruped) {
                    const local = pointerLabLocal;
                    const dx = local.x - labRefs.quadruped.position.x;
                    const dz = local.z - labRefs.quadruped.position.z;
                    let track = Math.atan2(-dz, dx) - labRefs.quadruped.rotation.y;
                    track = Math.max(-0.7, Math.min(0.7, track));
                    headYaw += (track - headYaw) * 0.55 * uPointerStrength.value;
                }
                labRefs.quadrupedHead.rotation.y += (headYaw - labRefs.quadrupedHead.rotation.y) * 0.08;
                labRefs.quadrupedHead.rotation.z = Math.sin(time * 0.9) * 0.03;
            }
            labRefs.quadrupedLegs.forEach((leg, index) => {
                const idle = Math.sin(time * 0.8 + leg.phase + index * 0.35);
                leg.hip.rotation.z = leg.hipBase + idle * 0.03;
                leg.knee.rotation.z = leg.kneeBase - idle * 0.024;
            });

            /* Holographics. */
            if (labRefs.holoGlobe) {
                labRefs.holoGlobe.rotation.y = time * 0.5;
                labRefs.holoGlobe.position.y = 1.92 + Math.sin(time * 1.4) * 0.03;
            }
            labRefs.holoRings.forEach((ring, index) => {
                ring.rotation.z = time * (index === 0 ? 0.7 : -0.5);
            });
            labRefs.panels.forEach((panel, index) => {
                panel.position.y = panel.userData.baseY + Math.sin(time * 0.9 + index * 2.1) * 0.05;
                panel.rotation.x = Math.sin(time * 0.6 + index) * 0.03;
            });

            /* Status LEDs breathe. */
            labRefs.statusLights.forEach((light, index) => {
                const pulse = 0.85 + Math.sin(time * 2.2 + index * 1.9) * 0.15;
                light.scale.setScalar(pulse);
            });
            labRefs.pulseMaterials.forEach(material => {
                material.emissiveIntensity = 1.2 + Math.sin(time * 2.6) * 0.5;
            });
        }

        function updateSpace(time, deltaSeconds) {
            if (!spaceBuilt) return;
            spaceRefs.starLayers.forEach((layer, index) => {
                layer.rotation.y = time * (index === 0 ? 0.0016 : -0.0034);
                layer.rotation.x = Math.sin(time * 0.02 + index) * 0.014;
            });
            if (spaceRefs.network) {
                spaceRefs.network.rotation.y = -0.16 + Math.sin(time * 0.11) * 0.09 +
                    pointerCurrent.x * 0.14;
                spaceRefs.network.rotation.x = Math.sin(time * 0.08) * 0.03 -
                    pointerCurrent.y * 0.1;
            }
            spaceRefs.meteors.forEach(meteor => {
                meteor.elapsed += deltaSeconds;
                if (meteor.elapsed < 0) {
                    meteor.mesh.visible = false;
                    return;
                }
                const life = meteor.elapsed / meteor.duration;
                if (life >= 1) {
                    spawnMeteor(meteor, false);
                    meteor.mesh.visible = false;
                    return;
                }
                meteor.mesh.visible = true;
                meteor.material.uniforms.uLife.value = life;
                meteor.mesh.position.copy(meteor.from)
                    .addScaledVector(meteor.velocity, life * meteor.duration);
            });
        }

        let sceneTime = 0;
        function renderFrame(now, deltaSeconds) {
            /* Accumulated & wrapped clock keeps shader sin()/fract() precise
             * however long the tab stays open. */
            sceneTime = (sceneTime + Math.max(deltaSeconds, 0)) % 3600;
            const time = sceneTime;
            uTime.value = time;
            if (Math.abs(themeMix - targetThemeMix) > 0.001) {
                const smoothing = 1 - Math.exp(-Math.max(deltaSeconds, 1 / 60) * 5.4);
                themeMix += (targetThemeMix - themeMix) * smoothing;
                if (Math.abs(themeMix - targetThemeMix) < 0.002) themeMix = targetThemeMix;
                applyThemeWeights();
            }

            updatePointerTargets();
            if (labGroup.visible) updateLaboratory(time);
            if (spaceGroup.visible) updateSpace(time, deltaSeconds);

            pointerCurrent.lerp(pointerTarget, 1 - Math.exp(-Math.max(deltaSeconds, 1 / 60) * 3.8));
            camera.position.set(
                cameraBase.x + pointerCurrent.x,
                cameraBase.y + pointerCurrent.y,
                cameraBase.z
            );
            camera.lookAt(cameraTarget);
            renderer.render(scene, camera);
        }

        let animationFrame = null;
        let lastPresentedAt = 0;

        function animate(now) {
            animationFrame = window.requestAnimationFrame(animate);
            const frameInterval = mobileLayout ? 1000 / 30 : 1000 / 45;
            if (lastPresentedAt && now - lastPresentedAt < frameInterval) return;
            const deltaSeconds = lastPresentedAt
                ? Math.min((now - lastPresentedAt) / 1000, 0.08)
                : 1 / 45;
            /* Carry the phase remainder so the cadence averages the target
             * rate instead of snapping to every other display refresh. */
            lastPresentedAt = lastPresentedAt
                ? now - ((now - lastPresentedAt) % frameInterval)
                : now;
            renderFrame(now, deltaSeconds);
        }

        function stopAnimation() {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        }

        function startAnimation() {
            if (animationFrame !== null || document.hidden || motionQuery.matches) return;
            lastPresentedAt = 0;
            animationFrame = window.requestAnimationFrame(animate);
        }

        function handlePointerMove(event) {
            if (!finePointerQuery.matches || mobileLayout) return;
            pointerActive = true;
            pointerTarget.x = (event.clientX / viewportWidth - 0.5) * 0.36;
            pointerTarget.y = -(event.clientY / viewportHeight - 0.5) * 0.2;
            pointerNdc.x = (event.clientX / viewportWidth) * 2 - 1;
            pointerNdc.y = -(event.clientY / viewportHeight) * 2 + 1;
        }

        function resetPointer() {
            pointerActive = false;
            pointerTarget.set(0, 0);
        }

        function handleResize() {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                resizeFrame = null;
                const rect = canvas.getBoundingClientRect();
                const nextWidth = Math.max(1, Math.round(rect.width) || window.innerWidth);
                const nextHeight = Math.max(1, Math.round(rect.height) || window.innerHeight);
                if (nextWidth === viewportWidth && nextHeight === viewportHeight &&
                    mobileQuery.matches === mobileLayout) {
                    return;
                }
                applyLayout();
                const now = performance.now();
                renderFrame(now, 1 / 60);
                lastPresentedAt = now;
            });
        }

        function handleThemeChange(event) {
            const theme = event.detail && event.detail.theme
                ? event.detail.theme
                : html.dataset.theme;
            setTheme(theme, false);
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                stopAnimation();
            } else {
                startAnimation();
            }
        }

        function handleMotionPreferenceChange(event) {
            html.classList.toggle('webgl-reduced-motion', event.matches);
            /* CSS hides the canvas while motion is reduced, so hand the
             * backdrop back to the static fallback layers. */
            html.classList.toggle('webgl-ready', !event.matches);
            if (event.matches) {
                stopAnimation();
            } else {
                startAnimation();
            }
        }

        function handleContextLost(event) {
            event.preventDefault();
            stopAnimation();
            markUnavailable(canvas);
        }

        function handleContextRestored() {
            canvas.removeAttribute('hidden');
            html.classList.remove('webgl-unavailable');
            html.classList.add('webgl-ready');
            /* Render-target contents die with the old context; regenerate the
             * PMREM environment or the lab loses its image-based lighting. */
            if (labBuilt) {
                if (environmentTarget) {
                    environmentTarget.dispose();
                    environmentTarget = null;
                    scene.environment = null;
                }
                buildEnvironment();
            }
            applyLayout();
            renderFrame(performance.now(), 1 / 60);
            startAnimation();
        }

        function disposeScene() {
            disposed = true;
            stopAnimation();
            if (resizeFrame !== null) {
                window.cancelAnimationFrame(resizeFrame);
                resizeFrame = null;
            }
            const geometries = new Set();
            const materials = new Set();
            scene.traverse(object => {
                if (object.isLight && object.shadow) object.shadow.dispose();
                if (object.geometry) geometries.add(object.geometry);
                if (object.material) {
                    const objectMaterials = Array.isArray(object.material)
                        ? object.material
                        : [object.material];
                    objectMaterials.forEach(material => materials.add(material));
                }
            });
            geometries.forEach(geometry => geometry.dispose());
            materials.forEach(material => material.dispose());
            if (environmentTarget) {
                environmentTarget.dispose();
                environmentTarget = null;
                scene.environment = null;
            }
            renderer.dispose();
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('blur', resetPointer);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('themechange', handleThemeChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (typeof motionQuery.removeEventListener === 'function') {
                motionQuery.removeEventListener('change', handleMotionPreferenceChange);
            } else if (typeof motionQuery.removeListener === 'function') {
                motionQuery.removeListener(handleMotionPreferenceChange);
            }
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            html.classList.remove('webgl-ready', 'webgl-reduced-motion');
            activeController = null;
        }

        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        window.addEventListener('blur', resetPointer);
        window.addEventListener('resize', handleResize, { passive: true });
        window.addEventListener('themechange', handleThemeChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', handleMotionPreferenceChange);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(handleMotionPreferenceChange);
        }
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        applyLayout();
        setTheme(html.dataset.theme, true);
        renderFrame(performance.now(), 1 / 60);
        html.classList.remove('webgl-unavailable', 'webgl-reduced-motion');
        html.classList.add('webgl-ready');
        startAnimation();

        /* Build the hidden theme and compile both shader sets off the
         * critical path, so the first theme toggle doesn't stutter. */
        function prewarmPrograms() {
            if (disposed || typeof renderer.compile !== 'function') return;
            const labVisible = labGroup.visible;
            const spaceVisible = spaceGroup.visible;
            labGroup.visible = true;
            spaceGroup.visible = true;
            applyMaterialWeight(labMaterials, 1);
            applyMaterialWeight(spaceMaterials, 1);
            try {
                renderer.compile(scene, camera);
            } catch (error) {
                /* Compilation is a warm-up only; rendering compiles lazily. */
            }
            labGroup.visible = labVisible;
            spaceGroup.visible = spaceVisible;
            applyThemeWeights();
        }

        const scheduleIdle = typeof window.requestIdleCallback === 'function'
            ? callback => window.requestIdleCallback(callback, { timeout: 2500 })
            : callback => window.setTimeout(callback, 400);
        scheduleIdle(() => {
            if (disposed) return;
            ensureLab();
            ensureSpace();
            applyThemeWeights();
            prewarmPrograms();
        });

        activeController = {
            dispose: disposeScene,
            render: () => renderFrame(performance.now(), 1 / 60),
            setTheme
        };
        return activeController;
    }

    window.initThreeBackground = initThreeBackground;
}());
