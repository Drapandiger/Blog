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
        /* Dims the neural network while a robot constellation is on stage. */
        const uNetworkDim = { value: 1 };

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
            'uniform float uDim;',
            'varying vec3 vColor;',
            'varying float vFire;',
            'varying float vHover;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float core = exp(-d * d * 9.0);',
            '    float halo = exp(-d * 2.6) * 0.5;',
            '    float energy = 0.62 + vFire * 1.5 + vHover * 0.9;',
            '    float alpha = (core + halo) * uOpacity * uDim * min(1.35, energy);',
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
            'uniform float uDim;',
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
            '    float alpha = min(1.0, intensity) * (0.45 + 0.55 * fade) * uOpacity * uDim;',
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

        /* Robot constellations (Cosmos): per-point alpha so stars can gather,
         * draw and dissolve without touching the shared crossfade opacity. */
        const chartStarVertexShader = [
            'attribute float aSize;',
            'attribute float aAlpha;',
            'attribute float aSpike;',
            'attribute vec3 aColor;',
            'uniform float uPixelRatio;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying float vSpike;',
            'void main() {',
            '    vColor = aColor;',
            '    vAlpha = aAlpha;',
            '    vSpike = aSpike;',
            '    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
            '    gl_PointSize = aSize * uPixelRatio * (240.0 / -mvPosition.z);',
            '    gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n');

        const chartStarFragmentShader = [
            'uniform float uOpacity;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying float vSpike;',
            'void main() {',
            '    vec2 p = gl_PointCoord - 0.5;',
            '    float d = length(p) * 2.0;',
            '    float core = exp(-d * d * 10.0);',
            '    float halo = exp(-d * 3.0) * 0.42;',
            '    float sx = exp(-abs(p.y) * 38.0) * max(0.0, 1.0 - abs(p.x) * 2.1);',
            '    float sy = exp(-abs(p.x) * 38.0) * max(0.0, 1.0 - abs(p.y) * 2.1);',
            '    float spikes = (sx + sy) * 0.7 * vSpike;',
            '    float alpha = (core + halo + spikes) * vAlpha * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    gl_FragColor = vec4(vColor * (core * 1.8 + halo + spikes * 1.2), alpha);',
            OUTPUT_GLSL,
            '}'
        ].join('\n');

        const chartLineVertexShader = [
            'attribute float aAlpha;',
            'attribute float aMix;',
            'varying float vAlpha;',
            'varying float vMix;',
            'void main() {',
            '    vAlpha = aAlpha;',
            '    vMix = aMix;',
            '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n');

        const chartLineFragmentShader = [
            'uniform float uOpacity;',
            'varying float vAlpha;',
            'varying float vMix;',
            'void main() {',
            '    float alpha = vAlpha * uOpacity;',
            '    if (alpha < 0.004) discard;',
            '    vec3 color = mix(vec3(0.45, 0.86, 1.0), vec3(0.76, 0.64, 1.0), vMix);',
            '    gl_FragColor = vec4(color * 1.35, alpha);',
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
            gripAnchor: null,
            parcels: [],
            amrCargo: null,
            dogCargo: null,
            scanLamp: null,
            scanLine: null,
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

        /* Pick-and-place geometry, in lab-local units. The arm joints below
         * are built from these numbers so the IK and the mesh agree. */
        const ARM_BASE = { x: 0.3, z: 0.15 };
        const SHOULDER_HEIGHT = 1.06;            // yaw column (0.66) + shoulder (0.4)
        const UPPER_ARM = 1.1;                   // shoulder -> elbow
        const FOREARM = 0.86;                    // elbow -> wrist
        const WRIST_ROLL_OFFSET = 0.1;           // wrist -> roll flange
        const GRIP_CENTER = 0.335;               // roll flange -> held block centre
        const TOOL_LENGTH = WRIST_ROLL_OFFSET + GRIP_CENTER;
        const SAMPLE_SIZE = 0.16;
        const FINGER_THICKNESS = 0.035;
        const FINGER_PAD = 0.012;
        const JAW_OPEN = 0.13;                   // half gap between the pads
        const JAW_CLOSED = SAMPLE_SIZE / 2;

        /* Logistics cell: the AMR brings a parcel in from the left, the arm
         * has it scanned at the vision station, then hands it to the
         * quadruped (which walks it off-stage) or drops a failed one in the
         * reject bin. One parcel every ITEM_PERIOD seconds; the 48 s cycle
         * divides the 3600 s clock wrap so nothing ever jumps. Times below
         * are seconds from the start of a parcel's slot. */
        const ITEM_PERIOD = 16;
        const PARCELS = [
            { color: 0xe97435, pass: true },
            { color: 0x3b82f6, pass: true },
            { color: 0xe8b62c, pass: false }
        ];
        const CELL_CYCLE = ITEM_PERIOD * PARCELS.length;
        const AMR_LANE_Z = 0.6;
        const AMR_DOCK_X = -1.05;
        const AMR_OFFSTAGE_X = -9;
        const AMR_CARGO_X = 0.18;                // cargo pad, ahead of the mast
        const AMR_CARGO_Y = 0.5 + SAMPLE_SIZE / 2;
        const AMR_WHEEL_RADIUS = 0.18;
        const DOG_DOCK = { x: 1.8, z: 0.62 };
        const DOG_EXIT = { x: 7.5, z: -1.35 };
        const DOG_HEADING = Math.atan2(-(DOG_EXIT.z - DOG_DOCK.z), DOG_EXIT.x - DOG_DOCK.x);
        const DOG_ROUTE = Math.hypot(DOG_EXIT.x - DOG_DOCK.x, DOG_EXIT.z - DOG_DOCK.z);
        const DOG_BODY_Y = 0.98;
        const DOG_CARGO = { x: -0.05, y: 0.27 + SAMPLE_SIZE / 2 };   // body-local
        const SCAN_POINT = { x: 1.1, y: 1.2, z: -0.95 };
        const SCAN_POST = { x: 1.55, z: -1.35 };
        const SCAN_HEAD_Y = 2.2;
        const BIN = { x: -0.6, z: -0.85, radius: 0.26, height: 0.5, releaseY: 0.95 };
        const TIMING = {
            amrArrive: -1.5, amrDocked: 4.0, amrTurn: 6.5, amrLeave: 7.7, amrGone: 11.7,
            grasp: 5.9, scanStart: 8.2, scanEnd: 9.1, verdictEnd: 10.8,
            handoff: 11.9, binRelease: 11.3,
            dogLeave: 12.5, dogOffstage: 17.7, dogReturn: 18.5, dogBack: 23.7, dogSettled: 24.9
        };

        /* Arm cylindrical coordinates (yaw 0 = arm bends toward -x). */
        function armCoordinates(x, y, z) {
            const dx = x - ARM_BASE.x;
            const dz = z - ARM_BASE.z;
            return { yaw: Math.atan2(dz, -dx), reach: Math.hypot(dx, dz), y };
        }

        /* With the tool pointing down, a held block's yaw is armYaw - roll;
         * pick the smallest roll that squares the jaws to a block of blockYaw. */
        function alignRoll(armYaw, blockYaw) {
            const quarter = Math.PI / 2;
            const roll = armYaw - blockYaw;
            return roll - Math.round(roll / quarter) * quarter;
        }

        const DOG_CARGO_WORLD = {
            x: DOG_DOCK.x + DOG_CARGO.x * Math.cos(DOG_HEADING),
            y: DOG_BODY_Y + DOG_CARGO.y,
            z: DOG_DOCK.z - DOG_CARGO.x * Math.sin(DOG_HEADING)
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
                /* Arm, bench, bin, scanner post. The AMR and the quadruped
                 * carry their own contact shadows because they move. */
                [ARM_BASE.x, ARM_BASE.z, 1.9], [-0.55, -2.1, 3.3],
                [BIN.x, BIN.z, 0.8], [SCAN_POST.x, SCAN_POST.z, 0.6]
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
            arm.position.set(ARM_BASE.x, 0, ARM_BASE.z);
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
            shoulder.position.set(0, SHOULDER_HEIGHT - 0.66, 0);
            armYaw.add(shoulder);
            labRefs.shoulder = shoulder;
            solidMesh(shoulder, new THREE.SphereGeometry(0.2, 24, 16), graphite, [0, 0, 0]);
            solidMesh(shoulder, new THREE.CapsuleGeometry(0.13, 0.92, 6, 18), shellWhite,
                [0, 0.56, 0], null, true);
            solidMesh(shoulder, new THREE.BoxGeometry(0.08, 0.7, 0.06), tealMetal, [0.13, 0.52, 0]);

            const elbow = new THREE.Group();
            elbow.position.set(0, UPPER_ARM, 0);
            shoulder.add(elbow);
            labRefs.elbow = elbow;
            solidMesh(elbow, new THREE.SphereGeometry(0.16, 24, 16), tealMetal, [0, 0, 0]);
            solidMesh(elbow, new THREE.CapsuleGeometry(0.1, 0.7, 6, 18), shellWhite,
                [0, 0.44, 0], null, true);
            labRefs.statusLights.push(
                solidMesh(elbow, new THREE.SphereGeometry(0.032, 10, 8), amber, [0.11, 0.2, 0], null, false)
            );

            const wrist = new THREE.Group();
            wrist.position.set(0, FOREARM, 0);
            elbow.add(wrist);
            labRefs.wrist = wrist;
            solidMesh(wrist, new THREE.SphereGeometry(0.12, 20, 14), graphite, [0, 0, 0]);
            const wristRoll = new THREE.Group();
            wristRoll.position.set(0, WRIST_ROLL_OFFSET, 0);
            wrist.add(wristRoll);
            labRefs.wristRoll = wristRoll;
            solidMesh(wristRoll, new THREE.CylinderGeometry(0.085, 0.095, 0.16, 18), tealMetal, [0, 0.05, 0]);
            solidMesh(wristRoll, new THREE.BoxGeometry(0.4, 0.07, 0.16), graphite, [0, 0.17, 0]);

            /* Parallel-jaw gripper: two fingers slide along the palm and
             * clamp the sample block, whose centre sits at gripAnchor. */
            const fingerGeometry = new THREE.BoxGeometry(FINGER_THICKNESS, 0.2, 0.1);
            const fingerPadGeometry = new THREE.BoxGeometry(FINGER_PAD, 0.09, 0.08);
            const makeFinger = side => {
                const finger = new THREE.Group();
                finger.position.set(side * (JAW_OPEN + FINGER_PAD + FINGER_THICKNESS / 2), 0.305, 0);
                solidMesh(finger, fingerGeometry, graphite, [0, 0, 0]);
                solidMesh(finger, fingerPadGeometry, tealMetal,
                    [-side * (FINGER_THICKNESS + FINGER_PAD) / 2, 0.04, 0]);
                wristRoll.add(finger);
                return finger;
            };
            labRefs.fingerLeft = makeFinger(-1);
            labRefs.fingerRight = makeFinger(1);
            const gripAnchor = new THREE.Group();
            gripAnchor.position.set(0, GRIP_CENTER, 0);
            wristRoll.add(gripAnchor);
            labRefs.gripAnchor = gripAnchor;
            labInner.add(arm);

            /* Vision QC station: a post with an overhead camera, a downlight
             * cone, a sweeping scan line and a verdict lamp. */
            const scanner = new THREE.Group();
            solidMesh(scanner, new THREE.CylinderGeometry(0.17, 0.2, 0.04, 24), graphite,
                [SCAN_POST.x, 0.02, SCAN_POST.z], null, true);
            solidMesh(scanner, new THREE.CylinderGeometry(0.035, 0.045, SCAN_HEAD_Y + 0.05, 12), shellWhite,
                [SCAN_POST.x, (SCAN_HEAD_Y + 0.05) / 2, SCAN_POST.z], null, true);
            const boomDx = SCAN_POINT.x - SCAN_POST.x;
            const boomDz = SCAN_POINT.z - SCAN_POST.z;
            solidMesh(scanner, new THREE.BoxGeometry(Math.hypot(boomDx, boomDz) + 0.08, 0.05, 0.05), graphite,
                [(SCAN_POST.x + SCAN_POINT.x) / 2, SCAN_HEAD_Y + 0.06, (SCAN_POST.z + SCAN_POINT.z) / 2],
                [0, Math.atan2(-boomDz, boomDx), 0], true);
            solidMesh(scanner, new THREE.BoxGeometry(0.22, 0.12, 0.18), shellWhite,
                [SCAN_POINT.x, SCAN_HEAD_Y, SCAN_POINT.z], null, true);
            solidMesh(scanner, new THREE.CylinderGeometry(0.05, 0.055, 0.05, 16), graphite,
                [SCAN_POINT.x, SCAN_HEAD_Y - 0.08, SCAN_POINT.z]);
            const scanLampMaterial = registerMaterial(labMaterials,
                new THREE.MeshBasicMaterial({ color: 0x2dd4bf }), 1, true);
            solidMesh(scanner, new THREE.SphereGeometry(0.04, 12, 8), scanLampMaterial,
                [SCAN_POINT.x, SCAN_HEAD_Y + 0.08, SCAN_POINT.z]);
            /* Status ring around the lens repeats the verdict colour. */
            solidMesh(scanner, new THREE.TorusGeometry(0.1, 0.018, 8, 32), scanLampMaterial,
                [SCAN_POINT.x, SCAN_HEAD_Y - 0.075, SCAN_POINT.z], [Math.PI / 2, 0, 0]);
            labRefs.scanLamp = scanLampMaterial;
            const scanCone = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.24, SCAN_HEAD_Y - 0.1 - (SCAN_POINT.y - 0.12), 24, 1, true),
                makeShaderMaterial(labMaterials, {
                    vertexShader: nebulaVertexShader,
                    fragmentShader: coneFragmentShader,
                    opacity: 0.7,
                    side: THREE.DoubleSide
                })
            );
            scanCone.position.set(SCAN_POINT.x, (SCAN_HEAD_Y - 0.1 + SCAN_POINT.y - 0.12) / 2, SCAN_POINT.z);
            scanner.add(scanCone);
            const scanLine = new THREE.Mesh(
                new THREE.PlaneGeometry(0.34, 0.34),
                registerMaterial(labMaterials,
                    new THREE.MeshBasicMaterial({ color: 0x2ee6d6, side: THREE.DoubleSide }), 0.55, false)
            );
            scanLine.rotation.x = -Math.PI / 2;
            scanLine.position.set(SCAN_POINT.x, SCAN_POINT.y, SCAN_POINT.z);
            scanLine.visible = false;
            scanner.add(scanLine);
            labRefs.scanLine = scanLine;
            labInner.add(scanner);

            /* Reject bin (open top, amber warning rim). */
            const binMaterial = registerMaterial(labMaterials, new THREE.MeshPhysicalMaterial({
                color: 0x2b4744, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.7
            }), 1, true);
            const bin = new THREE.Group();
            bin.position.set(BIN.x, 0, BIN.z);
            solidMesh(bin, new THREE.CylinderGeometry(BIN.radius, BIN.radius - 0.04, BIN.height, 28, 1, true),
                binMaterial, [0, BIN.height / 2, 0], null, true);
            solidMesh(bin, new THREE.CircleGeometry(BIN.radius - 0.04, 28), binMaterial,
                [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
            solidMesh(bin, new THREE.TorusGeometry(BIN.radius, 0.022, 8, 36), amber,
                [0, BIN.height, 0], [Math.PI / 2, 0, 0]);
            labInner.add(bin);

            /* One parcel per slot; each knows its own colour. */
            const parcelGeometry = new THREE.BoxGeometry(SAMPLE_SIZE, SAMPLE_SIZE, SAMPLE_SIZE);
            const parcelBandGeometry = new THREE.BoxGeometry(SAMPLE_SIZE + 0.008, 0.03, SAMPLE_SIZE + 0.008);
            labRefs.parcels = PARCELS.map(parcel => {
                const block = new THREE.Group();
                const shell = physicalMaterial(parcel.color, {
                    roughness: 0.32, metalness: 0.12, clearcoat: 0.6,
                    emissive: parcel.color, emissiveIntensity: 0.12
                });
                solidMesh(block, parcelGeometry, shell, [0, 0, 0], null, true);
                solidMesh(block, parcelBandGeometry, shellWhite, [0, 0, 0]);
                block.visible = false;
                labInner.add(block);
                return block;
            });

            /* Sagging service cable from the arm base to the bench. */
            const cableCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0.05, 0.16, -0.35),
                new THREE.Vector3(-0.15, 0.05, -1.0),
                new THREE.Vector3(-0.45, 0.03, -1.55),
                new THREE.Vector3(-0.75, 0.5, -1.95)
            ]);
            solidMesh(labInner, new THREE.TubeGeometry(cableCurve, 24, 0.022, 6), rubber,
                [0.3, 0, 0.15], null, false);

            /* Autonomous mobile robot shuttling parcels in from the left. */
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
            /* Sensor mast sits at the rear so the front half is a cargo pad. */
            solidMesh(amr, new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10), graphite, [-0.3, 0.62, 0]);
            const lidar = solidMesh(amr, new THREE.CylinderGeometry(0.085, 0.095, 0.1, 18), tealMetal, [-0.3, 0.82, 0]);
            solidMesh(amr, new THREE.BoxGeometry(0.3, 0.02, 0.3), tealMetal, [AMR_CARGO_X, 0.49, 0]);
            const amrCargo = new THREE.Group();
            amrCargo.position.set(AMR_CARGO_X, AMR_CARGO_Y, 0);
            amr.add(amrCargo);
            labRefs.amrCargo = amrCargo;
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
            const amrShadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 28), contactMaterial);
            amrShadow.rotation.x = -Math.PI / 2;
            amrShadow.position.y = 0.006;
            amr.add(amrShadow);
            amr.position.set(AMR_DOCK_X, 0, AMR_LANE_Z);
            labInner.add(amr);

            /* Quadruped inspection robot. */
            const quadruped = new THREE.Group();
            quadruped.position.set(DOG_DOCK.x, 0, DOG_DOCK.z);
            quadruped.rotation.y = DOG_HEADING;
            labRefs.quadruped = quadruped;
            const body = new THREE.Group();
            body.position.y = 0.98;
            quadruped.add(body);
            labRefs.quadrupedBody = body;
            solidMesh(body, new THREE.CapsuleGeometry(0.24, 0.66, 6, 18), shellWhite,
                [0, 0, 0], [0, 0, Math.PI / 2], true);
            /* Cargo tray on the back; the parcel centre sits at dogCargo. */
            solidMesh(body, new THREE.BoxGeometry(0.42, 0.06, 0.3), tealMetal, [DOG_CARGO.x, 0.24, 0]);
            solidMesh(body, new THREE.BoxGeometry(0.42, 0.04, 0.02), graphite, [DOG_CARGO.x, 0.29, 0.14]);
            solidMesh(body, new THREE.BoxGeometry(0.42, 0.04, 0.02), graphite, [DOG_CARGO.x, 0.29, -0.14]);
            const dogCargo = new THREE.Group();
            dogCargo.position.set(DOG_CARGO.x, DOG_CARGO.y, 0);
            body.add(dogCargo);
            labRefs.dogCargo = dogCargo;
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
            const dogShadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28), contactMaterial);
            dogShadow.rotation.x = -Math.PI / 2;
            dogShadow.position.y = 0.006;
            quadruped.add(dogShadow);
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

        /* ------------------------------------------------------------------
         * Logistics choreography. Every actor is a pure function of the
         * scene clock, so frames can be skipped (hidden tab, low FPS) and
         * everything stays in sync.
         * ------------------------------------------------------------------ */

        function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
        function easeInQuad(t) { return t * t; }
        function easeInOutSine(t) { return 0.5 - 0.5 * Math.cos(Math.PI * t); }
        function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
        /* Seconds since the start of slot `index`, wrapped into [-4, CELL_CYCLE - 4). */
        function slotTime(time, index) {
            let local = ((time - index * ITEM_PERIOD) % CELL_CYCLE + CELL_CYCLE) % CELL_CYCLE;
            if (local >= CELL_CYCLE - 4) local -= CELL_CYCLE;
            return local;
        }

        /* Arm keyframes: tool targets in the arm's cylindrical frame (yaw,
         * reach, parcel-centre height y) plus jaw gap and wrist roll. An
         * analytic two-link IK turns each frame into joint angles with the
         * tool pointing straight down, so parcels land exactly on the AMR
         * pad, under the scanner and on the quadruped's tray. */
        const ARM_TARGETS = {
            pickup: armCoordinates(AMR_DOCK_X + AMR_CARGO_X, AMR_CARGO_Y, AMR_LANE_Z),
            scan: armCoordinates(SCAN_POINT.x, SCAN_POINT.y, SCAN_POINT.z),
            handoff: armCoordinates(DOG_CARGO_WORLD.x, DOG_CARGO_WORLD.y, DOG_CARGO_WORLD.z),
            reject: armCoordinates(BIN.x, BIN.releaseY, BIN.z),
            ready: { yaw: 0.9, reach: 0.85, y: 1.3 }
        };
        /* Rolls that square the jaws to the parcel on the AMR (yaw 0) and to
         * the quadruped's tray; a held parcel's yaw is armYaw - roll. */
        const PICK_ROLL = alignRoll(ARM_TARGETS.pickup.yaw, 0);
        const PLACE_ROLL = alignRoll(ARM_TARGETS.handoff.yaw, DOG_HEADING);
        const REJECT_DROP_YAW = ARM_TARGETS.reject.yaw - PICK_ROLL;

        function buildArmTrack() {
            const { pickup, scan, handoff, reject, ready } = ARM_TARGETS;
            const pickRoll = PICK_ROLL;
            const placeRoll = PLACE_ROLL;
            const hover = 0.32;
            const lifted = (target, dy) => ({ yaw: target.yaw, reach: target.reach, y: target.y + dy });
            const keys = [];
            const key = (t, target, jaw, roll, arc) => keys.push({
                t, yaw: target.yaw, reach: target.reach, y: target.y, jaw, roll, arc: arc || 0
            });
            PARCELS.forEach((parcel, index) => {
                const b = index * ITEM_PERIOD;
                key(b, ready, JAW_OPEN, pickRoll);
                key(b + 4.1, ready, JAW_OPEN, pickRoll);
                key(b + 5.1, lifted(pickup, hover), JAW_OPEN, pickRoll);
                key(b + 5.6, pickup, JAW_OPEN, pickRoll);
                key(b + TIMING.grasp, pickup, JAW_CLOSED, pickRoll);
                key(b + 6.45, lifted(pickup, hover), JAW_CLOSED, pickRoll);
                key(b + 8.05, scan, JAW_CLOSED, pickRoll, 0.15);
                key(b + 9.6, scan, JAW_CLOSED, pickRoll);
                if (parcel.pass) {
                    key(b + 11.1, lifted(handoff, hover), JAW_CLOSED, placeRoll, 0.1);
                    key(b + 11.6, handoff, JAW_CLOSED, placeRoll);
                    key(b + TIMING.handoff, handoff, JAW_OPEN, placeRoll);
                    key(b + 12.4, lifted(handoff, hover), JAW_OPEN, placeRoll);
                    key(b + 13.9, ready, JAW_OPEN, pickRoll);
                } else {
                    key(b + 11.0, reject, JAW_CLOSED, pickRoll, 0.1);
                    key(b + TIMING.binRelease, reject, JAW_OPEN, pickRoll);
                    key(b + 12.9, ready, JAW_OPEN, pickRoll);
                }
            });
            key(CELL_CYCLE, ready, JAW_OPEN, pickRoll);
            /* Unwrap yaw so every move takes the short way round. */
            for (let index = 1; index < keys.length; index += 1) {
                let delta = keys[index].yaw - keys[index - 1].yaw;
                delta -= Math.round(delta / (Math.PI * 2)) * Math.PI * 2;
                keys[index].yaw = keys[index - 1].yaw + delta;
            }
            return keys;
        }
        const armKeys = buildArmTrack();

        const armTarget = { yaw: 0, reach: 0, y: 0, jaw: JAW_OPEN, roll: 0 };
        const armPose = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0, roll: 0, jaw: JAW_OPEN };

        function solveArmPose() {
            const maxReach = UPPER_ARM + FOREARM - 0.002;
            let horizontal = armTarget.reach;
            let vertical = armTarget.y + TOOL_LENGTH - SHOULDER_HEIGHT;
            const distance = Math.hypot(horizontal, vertical);
            if (distance > maxReach) {
                horizontal *= maxReach / distance;
                vertical *= maxReach / distance;
            }
            const reach = Math.min(distance, maxReach);
            const cosElbow = (reach * reach - UPPER_ARM * UPPER_ARM - FOREARM * FOREARM) /
                (2 * UPPER_ARM * FOREARM);
            /* Positive elbow angle = elbow-up solution. */
            const elbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
            const shoulder = Math.atan2(horizontal, vertical) -
                Math.atan2(FOREARM * Math.sin(elbow), UPPER_ARM + FOREARM * Math.cos(elbow));
            armPose.yaw = armTarget.yaw;
            armPose.shoulder = shoulder;
            armPose.elbow = elbow;
            /* Joint angles sum to pi: the tool axis points straight down. */
            armPose.wrist = Math.PI - shoulder - elbow;
            armPose.roll = armTarget.roll;
            armPose.jaw = armTarget.jaw;
        }

        let armKeyCursor = 0;
        function evaluateArmPose(time) {
            const cycleTime = ((time % CELL_CYCLE) + CELL_CYCLE) % CELL_CYCLE;
            if (cycleTime < armKeys[armKeyCursor].t || cycleTime >= armKeys[armKeyCursor + 1].t) {
                armKeyCursor = 0;
                while (armKeyCursor < armKeys.length - 2 && cycleTime >= armKeys[armKeyCursor + 1].t) {
                    armKeyCursor += 1;
                }
            }
            const from = armKeys[armKeyCursor];
            const to = armKeys[armKeyCursor + 1];
            const span = to.t - from.t;
            const blend = span > 0 ? easeInOutCubic(clamp01((cycleTime - from.t) / span)) : 1;
            armTarget.yaw = from.yaw + (to.yaw - from.yaw) * blend;
            armTarget.reach = from.reach + (to.reach - from.reach) * blend;
            armTarget.y = from.y + (to.y - from.y) * blend + Math.sin(Math.PI * blend) * to.arc;
            armTarget.jaw = from.jaw + (to.jaw - from.jaw) * blend;
            armTarget.roll = from.roll + (to.roll - from.roll) * blend;
            solveArmPose();
        }

        /* AMR: drives in loaded and brakes at the dock, waits for the pick,
         * turns on the spot and drives out empty; reloads off-stage. */
        const amrState = { x: AMR_DOCK_X, heading: 0, odometer: 0, turn: 0 };
        function evaluateAmr(time) {
            /* Slot-local time in [amrArrive, amrArrive + ITEM_PERIOD). */
            const slot = (((time - TIMING.amrArrive) % ITEM_PERIOD) + ITEM_PERIOD) % ITEM_PERIOD +
                TIMING.amrArrive;
            const run = AMR_DOCK_X - AMR_OFFSTAGE_X;
            if (slot >= TIMING.amrGone) {
                /* Off-stage: reloads and turns back while out of view. */
                amrState.x = AMR_OFFSTAGE_X;
                amrState.heading = Math.PI;
                amrState.odometer = run * 2;
                amrState.turn = Math.PI;
                return;
            }
            if (slot < TIMING.amrDocked) {
                const s = easeOutQuad(clamp01((slot - TIMING.amrArrive) / (TIMING.amrDocked - TIMING.amrArrive)));
                amrState.x = AMR_OFFSTAGE_X + run * s;
                amrState.heading = 0;
                amrState.odometer = run * s;
                amrState.turn = 0;
            } else if (slot < TIMING.amrTurn) {
                amrState.x = AMR_DOCK_X;
                amrState.heading = 0;
                amrState.odometer = run;
                amrState.turn = 0;
            } else if (slot < TIMING.amrLeave) {
                const s = easeInOutCubic((slot - TIMING.amrTurn) / (TIMING.amrLeave - TIMING.amrTurn));
                amrState.x = AMR_DOCK_X;
                amrState.heading = Math.PI * s;
                amrState.odometer = run;
                amrState.turn = Math.PI * s;
            } else {
                const s = easeInQuad((slot - TIMING.amrLeave) / (TIMING.amrGone - TIMING.amrLeave));
                amrState.x = AMR_DOCK_X - run * s;
                amrState.heading = Math.PI;
                amrState.odometer = run * (1 + s);
                amrState.turn = Math.PI;
            }
        }

        /* Quadruped: waits at the dock facing its exit; after each passed
         * parcel it trots off-stage, comes back and turns around. */
        const dogState = { x: DOG_DOCK.x, z: DOG_DOCK.z, heading: DOG_HEADING, odometer: 0 };
        function evaluateDog(time, target) {
            target.x = DOG_DOCK.x;
            target.z = DOG_DOCK.z;
            target.heading = DOG_HEADING;
            target.odometer = 0;
            PARCELS.forEach((parcel, index) => {
                if (!parcel.pass) return;
                const u = ((time - index * ITEM_PERIOD) % CELL_CYCLE + CELL_CYCLE) % CELL_CYCLE;
                if (u < TIMING.dogLeave || u >= TIMING.dogSettled) return;
                const turnArc = Math.PI * 0.45;
                if (u < TIMING.dogOffstage) {
                    const s = easeInOutSine((u - TIMING.dogLeave) / (TIMING.dogOffstage - TIMING.dogLeave));
                    target.x = DOG_DOCK.x + (DOG_EXIT.x - DOG_DOCK.x) * s;
                    target.z = DOG_DOCK.z + (DOG_EXIT.z - DOG_DOCK.z) * s;
                    target.odometer = DOG_ROUTE * s;
                } else if (u < TIMING.dogReturn) {
                    target.x = DOG_EXIT.x;
                    target.z = DOG_EXIT.z;
                    target.heading = DOG_HEADING + Math.PI;
                    target.odometer = DOG_ROUTE;
                } else if (u < TIMING.dogBack) {
                    const s = easeInOutSine((u - TIMING.dogReturn) / (TIMING.dogBack - TIMING.dogReturn));
                    target.x = DOG_EXIT.x + (DOG_DOCK.x - DOG_EXIT.x) * s;
                    target.z = DOG_EXIT.z + (DOG_DOCK.z - DOG_EXIT.z) * s;
                    target.heading = DOG_HEADING + Math.PI;
                    target.odometer = DOG_ROUTE * (1 + s);
                } else {
                    const s = easeInOutCubic((u - TIMING.dogBack) / (TIMING.dogSettled - TIMING.dogBack));
                    target.heading = DOG_HEADING + Math.PI * (1 - s);
                    target.odometer = DOG_ROUTE * 2 + turnArc * s;
                }
            });
        }
        const dogPrevious = { x: 0, z: 0, heading: 0, odometer: 0 };

        /* Phones: the portrait stage is too narrow to show the whole cell at
         * a useful size, so it acts as a pan camera that follows the work —
         * AMR dock, QC scanner, then the quadruped hand-off or the reject
         * bin — and frames the robots larger. Lab-local x to centre on. */
        const STAGE_FOCUS = { amr: -0.45, scan: 0.55, dog: 1.25, bin: -0.15 };
        const stageFocusKeys = [];
        PARCELS.forEach((parcel, index) => {
            const b = index * ITEM_PERIOD;
            stageFocusKeys.push(
                { t: b + 1.0, x: STAGE_FOCUS.amr }, { t: b + 6.3, x: STAGE_FOCUS.amr },
                { t: b + 8.0, x: STAGE_FOCUS.scan }, { t: b + 9.6, x: STAGE_FOCUS.scan }
            );
            if (parcel.pass) {
                stageFocusKeys.push({ t: b + 11.2, x: STAGE_FOCUS.dog }, { t: b + 13.0, x: STAGE_FOCUS.dog });
            } else {
                stageFocusKeys.push({ t: b + 10.9, x: STAGE_FOCUS.bin }, { t: b + 12.6, x: STAGE_FOCUS.bin });
            }
        });
        function stageFocusAt(time) {
            const t = ((time % CELL_CYCLE) + CELL_CYCLE) % CELL_CYCLE;
            let index = stageFocusKeys.length - 1;
            for (let key = 0; key < stageFocusKeys.length && stageFocusKeys[key].t <= t; key += 1) index = key;
            const from = stageFocusKeys[index];
            const to = stageFocusKeys[(index + 1) % stageFocusKeys.length];
            const span = ((to.t - from.t) % CELL_CYCLE + CELL_CYCLE) % CELL_CYCLE;
            const local = ((t - from.t) % CELL_CYCLE + CELL_CYCLE) % CELL_CYCLE;
            return from.x + (to.x - from.x) * easeInOutSine(clamp01(local / span));
        }

        /* Where each parcel is right now: on the AMR, in the gripper, on the
         * quadruped, falling into the reject bin, or off-stage (hidden). */
        function placeParcel(block, parcel, index, time) {
            const u = slotTime(time, index);
            const done = parcel.pass ? TIMING.handoff : TIMING.binRelease;
            let parent = null;
            if (u < TIMING.amrArrive) {
                parent = null;
            } else if (u < TIMING.grasp) {
                parent = labRefs.amrCargo;
            } else if (u < done) {
                parent = labRefs.gripAnchor;
            } else if (parcel.pass && u < TIMING.dogOffstage) {
                parent = labRefs.dogCargo;
            } else if (!parcel.pass) {
                /* Free fall into the bin; hidden once below the rim. */
                const fall = u - TIMING.binRelease;
                const y = BIN.releaseY - 6.5 * fall * fall;
                if (y > BIN.height - SAMPLE_SIZE / 2 - 0.02) {
                    if (block.parent !== labInner) labInner.add(block);
                    block.visible = true;
                    block.position.set(BIN.x, y, BIN.z);
                    block.rotation.set(fall * 2.2, REJECT_DROP_YAW, fall * 1.4);
                    return;
                }
            }
            if (!parent) {
                block.visible = false;
                return;
            }
            if (block.parent !== parent) parent.add(block);
            block.visible = true;
            block.position.set(0, 0, 0);
            block.rotation.set(0, 0, 0);
        }

        /* ------------------------------------------------------------------
         * Dark theme — neural cosmos
         * ------------------------------------------------------------------ */

        const spaceRefs = {
            starLayers: [],
            nebulae: [],
            network: null,
            meteors: [],
            chart: null,
            chartParts: null
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
                uniforms: { uPointer3, uPointerStrength, uDim: uNetworkDim }
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
                uniforms: { uPointer3, uPointerStrength, uDim: uNetworkDim }
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

            buildConstellations();
        }

        /* ------------------------------------------------------------------
         * Cosmos: robot constellations. The lab's three robots reappear as
         * living star charts and replay the lab's hand-off in the sky: the
         * rover brings a data packet, the manipulator swings it across, the
         * quadruped trots off with it and the packet leaves as a shooting
         * star. Pure function of the scene clock (36 s loop, divides 3600).
         * Chart units: x right, y up; the group is fitted on screen by
         * placeConstellations().
         * ------------------------------------------------------------------ */
        const CHART_CYCLE = 36;
        const CHART_BOUNDS = { minX: -1.95, maxX: 2.45, minY: -1.55, maxY: 1.3 };
        const CHART_PLANE_Z = 0.6;
        const ROVER_HOME = { x: -1.0, y: -0.6 };
        const ROVER_PACKET = { x: 0.35, y: 0.42 };
        const ARM_ROOT = { x: 0.15, y: -1.0 };
        const CHART_UPPER = 0.8;
        const CHART_FORE = 0.7;
        const CHART_TOOL = 0.2;
        const DOG_HOME = { x: 1.3, y: -0.55 };
        const DOG_PACKET_Y = 0.26;
        const PACKET_P1 = { x: ROVER_HOME.x + ROVER_PACKET.x, y: ROVER_HOME.y + ROVER_PACKET.y };
        const PACKET_P2 = { x: DOG_HOME.x, y: DOG_HOME.y + DOG_PACKET_Y };
        /* Every hand-off overlaps: the arm is formed before the rover is
         * left, the rover only drives off once the packet is lifted, and
         * the quadruped is drawn before the arm hovers over it. */
        const CHART_TIMES = {
            roverParked: 4.2, packetIn: 1.6,
            grip: 13.9, roverLeaves: 14.5, release: 18.5,
            dogWalk: 21.6, dogWalkSpan: 7.2,
            launch: 24.5, launchEnd: 25.9,
            activeIn: [0, 1.5], activeOut: [28.8, 30.8]
        };

        function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
        function easeInCubic(t) { return t * t * t; }
        function smoothWindow(t, inStart, inEnd, outStart, outEnd) {
            const rise = clamp01((t - inStart) / (inEnd - inStart));
            const fall = clamp01((t - outStart) / (outEnd - outStart));
            return easeInOutCubic(rise) * (1 - easeInOutCubic(fall));
        }

        /* Rover, side view: body, sensor mast, two rolling wheels. */
        function roverOffset(t) {
            if (t < CHART_TIMES.roverParked) {
                return -0.9 * (1 - easeOutCubic(clamp01(t / CHART_TIMES.roverParked)));
            }
            if (t > CHART_TIMES.roverLeaves) return -0.8 * easeInQuad(clamp01((t - CHART_TIMES.roverLeaves) / 2.0));
            return 0;
        }
        function poseRover(t, out) {
            const offset = roverOffset(t);
            const cx = ROVER_HOME.x + offset;
            const cy = ROVER_HOME.y + Math.sin(t * 2.1) * 0.008;
            const body = [[-0.75, -0.05], [0.75, -0.05], [0.75, 0.28], [-0.75, 0.28], [-0.45, 0.28], [-0.45, 0.68]];
            body.forEach((point, index) => out[index].set(cx + point[0], cy + point[1], 0));
            const wheelAngle = -offset / 0.19;
            [-0.45, 0.45].forEach((wheelX, wheel) => {
                for (let spoke = 0; spoke < 5; spoke += 1) {
                    const angle = wheelAngle + spoke * Math.PI * 2 / 5;
                    out[6 + wheel * 5 + spoke].set(
                        cx + wheelX + Math.cos(angle) * 0.19,
                        cy - 0.24 + Math.sin(angle) * 0.19,
                        0
                    );
                }
            });
        }
        function roverPacket(t, target) {
            const offset = t < CHART_TIMES.roverLeaves ? roverOffset(t) : 0;
            return target.set(PACKET_P1.x + offset, PACKET_P1.y + Math.sin(t * 2.1) * 0.008, 0);
        }

        /* Manipulator: keyframes in cylindrical coordinates (yaw psi, reach,
         * grip height). Projecting the yawed arm onto the chart makes the
         * swing read as a 3D turn and keeps the elbow on top throughout. */
        const chartArmKeys = (() => {
            const ready = { psi: 1.9, reach: 0.45, y: 0.45 };
            const left = { psi: Math.PI, reach: Math.abs(PACKET_P1.x - ARM_ROOT.x) };
            const right = { psi: 0, reach: Math.abs(PACKET_P2.x - ARM_ROOT.x) };
            const open = 0.12;
            const shut = 0.065;
            const key = (t, base, y, jaw, arc) => ({ t, psi: base.psi, reach: base.reach, y, jaw, arc: arc || 0 });
            const grip = CHART_TIMES.grip;
            const release = CHART_TIMES.release;
            return [
                key(0, ready, ready.y, open),
                key(grip - 1.9, ready, ready.y, open),
                key(grip - 0.8, left, PACKET_P1.y + 0.3, open),
                key(grip - 0.3, left, PACKET_P1.y, open),
                key(grip, left, PACKET_P1.y, shut),
                key(CHART_TIMES.roverLeaves, left, PACKET_P1.y + 0.35, shut),
                key(grip + 2.6, right, PACKET_P2.y + 0.35, shut, 0.2),
                key(release - 1.0, right, PACKET_P2.y + 0.35, shut),
                key(release - 0.3, right, PACKET_P2.y, shut),
                key(release, right, PACKET_P2.y, open),
                key(release + 0.7, right, PACKET_P2.y + 0.35, open),
                key(release + 1.8, ready, ready.y, open),
                key(CHART_CYCLE, ready, ready.y, open)
            ];
        })();
        const chartArm = { psi: 0, reach: 0, y: 0, jaw: 0 };
        const chartGrip = new THREE.Vector3();
        function solveChartArm(t, out) {
            let index = 0;
            while (index < chartArmKeys.length - 2 && t >= chartArmKeys[index + 1].t) index += 1;
            const from = chartArmKeys[index];
            const to = chartArmKeys[index + 1];
            const blend = easeInOutCubic(clamp01((t - from.t) / (to.t - from.t)));
            chartArm.psi = from.psi + (to.psi - from.psi) * blend;
            chartArm.reach = from.reach + (to.reach - from.reach) * blend;
            chartArm.y = from.y + (to.y - from.y) * blend + Math.sin(Math.PI * blend) * to.arc;
            chartArm.jaw = from.jaw + (to.jaw - from.jaw) * blend;

            /* In-plane two-link IK (r outward, y up), elbow-up branch. */
            const shoulderY = ARM_ROOT.y + 0.45;
            let dr = chartArm.reach;
            let dy = chartArm.y + CHART_TOOL - shoulderY;
            let distance = Math.hypot(dr, dy);
            const maxReach = CHART_UPPER + CHART_FORE - 0.001;
            if (distance > maxReach) {
                dr *= maxReach / distance;
                dy *= maxReach / distance;
                distance = maxReach;
            }
            const phi = Math.atan2(dy, dr);
            const beta = Math.acos(Math.max(-1, Math.min(1,
                (CHART_UPPER * CHART_UPPER + distance * distance - CHART_FORE * CHART_FORE) /
                (2 * CHART_UPPER * Math.max(distance, 0.001)))));
            const elbowR = Math.cos(phi + beta) * CHART_UPPER;
            const elbowY = shoulderY + Math.sin(phi + beta) * CHART_UPPER;
            const wristY = shoulderY + dy;
            const cosPsi = Math.cos(chartArm.psi);
            const depth = -Math.sin(chartArm.psi) * 0.6;
            const project = (r, y, point) => point.set(ARM_ROOT.x + r * cosPsi, y, r * depth);
            out[0].set(ARM_ROOT.x - 0.32, ARM_ROOT.y, 0);
            out[1].set(ARM_ROOT.x + 0.32, ARM_ROOT.y, 0);
            out[2].set(ARM_ROOT.x - 0.17, ARM_ROOT.y + 0.28, 0);
            out[3].set(ARM_ROOT.x + 0.17, ARM_ROOT.y + 0.28, 0);
            out[4].set(ARM_ROOT.x, shoulderY, 0);
            project(elbowR, elbowY, out[5]);
            project(dr, wristY, out[6]);
            project(dr, wristY - 0.1, out[7]);
            project(dr - chartArm.jaw, wristY - 0.24, out[8]);
            project(dr + chartArm.jaw, wristY - 0.24, out[9]);
            project(dr, wristY - CHART_TOOL, chartGrip);
        }

        /* Quadruped, side view: spine, head, antenna and four trotting legs
         * (far legs dimmer). Walks off to the right after the hand-off. */
        function dogWalk(t) {
            const start = CHART_TIMES.dogWalk;
            const span = CHART_TIMES.dogWalkSpan;
            const progress = clamp01((t - start) / span);
            return { distance: 2.1 * progress * progress, speed: t > start && t < start + span ? 4.2 * progress / span : 0 };
        }
        function poseDog(t, out) {
            const walk = dogWalk(t);
            const gait = clamp01(walk.speed / 0.25);
            const phase = walk.distance / 0.34 * Math.PI * 2;
            const cx = DOG_HOME.x + walk.distance;
            const cy = DOG_HOME.y + Math.sin(t * 1.3) * 0.008 * (1 - gait) +
                Math.abs(Math.sin(phase)) * 0.02 * gait;
            const nod = Math.sin(t * 0.9) * 0.025 * (1 - gait);
            out[0].set(cx - 0.5, cy, 0);
            out[1].set(cx, cy + 0.1, 0);
            out[2].set(cx + 0.5, cy + 0.02, 0);
            out[3].set(cx + 0.8, cy + 0.28 + nod, 0);
            out[4].set(cx + 1.02, cy + 0.2 + nod, 0);
            out[5].set(cx - 0.58, cy + 0.45, 0);
            /* near front, far front, near rear, far rear (trot pairs). */
            const legs = [[2, 0, 0], [2, Math.PI, -0.12], [0, Math.PI, 0], [0, 0, -0.12]];
            legs.forEach((leg, index) => {
                const hip = out[leg[0]];
                const step = phase + leg[1];
                const swing = 0.15 + 0.38 * Math.sin(step) * gait + Math.sin(t * 0.8 + index) * 0.03 * (1 - gait);
                const knee = -0.55 - 0.45 * Math.max(0, Math.cos(step)) * gait;
                const kneePoint = out[6 + index * 2];
                const footPoint = out[7 + index * 2];
                kneePoint.set(hip.x + Math.sin(swing) * 0.3 + leg[2] * 0.3, hip.y - Math.cos(swing) * 0.3, leg[2]);
                footPoint.set(kneePoint.x + Math.sin(swing + knee) * 0.3, kneePoint.y - Math.cos(swing + knee) * 0.3, leg[2]);
            });
        }
        function dogPacket(t, target) {
            poseDog(t, chartScratch);
            return target.set(chartScratch[1].x, chartScratch[1].y + DOG_PACKET_Y - 0.1, 0);
        }

        const WHITE_STAR = 0xeef6ff;
        const CYAN_STAR = 0xbfe8ff;
        const VIOLET_STAR = 0xd9ccff;
        const chartFigures = [
            {
                title: 'VEHICULUM ERRANS', subtitle: 'I · ROVER',
                label: [ROVER_HOME.x + 0.05, ROVER_HOME.y - 0.78],
                gather: [0, 2.6], draw: [1.5, 4.0], labelIn: [4.0, 4.8], labelOut: [14.0, 14.6],
                dissolve: [14.9, 17.1],
                stars: [
                    [1.3, WHITE_STAR, 0.6], [1.5, WHITE_STAR, 1], [1.5, WHITE_STAR, 1], [1.3, CYAN_STAR, 0.4],
                    [1.1, CYAN_STAR, 0], [1.8, CYAN_STAR, 1],
                    [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0],
                    [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0]
                ],
                edges: [[0, 1], [1, 2], [2, 4], [4, 3], [3, 0], [4, 5],
                    [6, 7], [7, 8], [8, 9], [9, 10], [10, 6],
                    [11, 12], [12, 13], [13, 14], [14, 15], [15, 11]],
                pose: poseRover
            },
            {
                title: 'BRACHIUM FABRILE', subtitle: 'II · MANIPULATOR',
                label: [ARM_ROOT.x - 0.05, 1.12],
                gather: [7.6, 10.0], draw: [8.8, 11.2], labelIn: [11.2, 12.0], labelOut: [19.7, 20.3],
                dissolve: [20.3, 22.5],
                stars: [
                    [1.1, VIOLET_STAR, 0], [1.1, VIOLET_STAR, 0], [1.0, VIOLET_STAR, 0], [1.0, VIOLET_STAR, 0],
                    [1.7, WHITE_STAR, 1], [1.6, WHITE_STAR, 1], [1.5, WHITE_STAR, 0.7],
                    [1.1, CYAN_STAR, 0], [0.9, CYAN_STAR, 0], [0.9, CYAN_STAR, 0]
                ],
                edges: [[0, 1], [1, 3], [3, 2], [2, 0], [2, 4], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [7, 9]],
                pose: solveChartArm
            },
            {
                title: 'CANIS MECHANICUS', subtitle: 'III · QUADRUPED',
                label: [DOG_HOME.x + 0.15, DOG_HOME.y - 0.82],
                gather: [13.9, 16.3], draw: [15.1, 17.5], labelIn: [17.5, 18.3], labelOut: [25.7, 26.3],
                dissolve: [26.3, 29.1],
                stars: [
                    [1.6, WHITE_STAR, 1], [1.2, WHITE_STAR, 0.3], [1.6, WHITE_STAR, 1], [1.4, CYAN_STAR, 0.5],
                    [1.0, CYAN_STAR, 0], [1.3, VIOLET_STAR, 0.8],
                    [1.0, CYAN_STAR, 0], [1.1, WHITE_STAR, 0], [0.75, VIOLET_STAR, 0], [0.8, VIOLET_STAR, 0],
                    [1.0, CYAN_STAR, 0], [1.1, WHITE_STAR, 0], [0.75, VIOLET_STAR, 0], [0.8, VIOLET_STAR, 0]
                ],
                edges: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5],
                    [2, 6], [6, 7], [2, 8], [8, 9], [0, 10], [10, 11], [0, 12], [12, 13]],
                faint: [7, 8, 11, 12],
                pose: poseDog
            }
        ];
        const chartScratch = Array.from({ length: 16 }, () => new THREE.Vector3());

        function drawSpacedText(context, text, centerX, y, spacing) {
            const glyphs = Array.from(text);
            const widths = glyphs.map(glyph => context.measureText(glyph).width);
            const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (glyphs.length - 1);
            let x = centerX - total / 2;
            glyphs.forEach((glyph, index) => {
                context.fillText(glyph, x, y);
                x += widths[index] + spacing;
            });
        }

        function makeChartLabel(title, subtitle) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 192;
            const texture = new THREE.CanvasTexture(canvas);
            if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
            const paint = () => {
                const context = canvas.getContext('2d');
                if (!context) return;
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.textBaseline = 'middle';
                context.textAlign = 'left';
                context.font = '600 56px Inter, "Helvetica Neue", Arial, sans-serif';
                context.fillStyle = 'rgba(236, 242, 255, 0.96)';
                drawSpacedText(context, title, 512, 66, 15);
                context.strokeStyle = 'rgba(125, 211, 252, 0.5)';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(392, 112);
                context.lineTo(632, 112);
                context.stroke();
                context.font = '600 34px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
                context.fillStyle = 'rgba(186, 200, 255, 0.95)';
                drawSpacedText(context, subtitle, 512, 152, 8);
                texture.needsUpdate = true;
            };
            paint();
            if (document.fonts && typeof document.fonts.load === 'function') {
                document.fonts.load('600 56px Inter').then(() => { if (!disposed) paint(); }, () => {});
            }
            const material = new THREE.SpriteMaterial({
                map: texture, transparent: true, depthTest: false, depthWrite: false, opacity: 0
            });
            material.toneMapped = false;
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(2.0, 0.375, 1);
            sprite.renderOrder = 6;
            return sprite;
        }

        function buildConstellations() {
            const chart = new THREE.Group();
            chart.name = 'Robot constellations';
            spaceGroup.add(chart);
            spaceRefs.chart = chart;

            const starCount = chartFigures.reduce((sum, figure) => sum + figure.stars.length, 0);
            const edgeCount = chartFigures.reduce((sum, figure) => sum + figure.edges.length, 0);
            /* stars + one drawing tip per edge + the packet */
            const pointCount = starCount + edgeCount + 1;
            const pointPositions = new Float32Array(pointCount * 3);
            const pointSizes = new Float32Array(pointCount);
            const pointAlphas = new Float32Array(pointCount);
            const pointSpikes = new Float32Array(pointCount);
            const pointColors = new Float32Array(pointCount * 3);
            const color = new THREE.Color();
            let starCursor = 0;
            let edgeCursor = 0;
            chartFigures.forEach(figure => {
                figure.starOffset = starCursor;
                figure.edgeOffset = edgeCursor;
                figure.home = figure.stars.map(() => new THREE.Vector3());
                figure.scatterIn = figure.stars.map(() => {
                    const angle = random() * Math.PI * 2;
                    const distance = 1.2 + random() * 1.4;
                    return new THREE.Vector3(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.7, (random() - 0.5) * 1.2);
                });
                figure.scatterOut = figure.stars.map(() => {
                    const angle = random() * Math.PI * 2;
                    const distance = 0.9 + random() * 1.6;
                    return new THREE.Vector3(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.7, (random() - 0.5) * 1.2);
                });
                figure.depth = figure.stars.map(() => (random() - 0.5) * 0.24);
                figure.stars.forEach((star, index) => {
                    const slot = starCursor + index;
                    pointSizes[slot] = star[0];
                    pointSpikes[slot] = star[2];
                    color.setHex(star[1]);
                    pointColors[slot * 3] = color.r;
                    pointColors[slot * 3 + 1] = color.g;
                    pointColors[slot * 3 + 2] = color.b;
                });
                figure.edges.forEach((edge, index) => {
                    const slot = starCount + edgeCursor + index;
                    pointSizes[slot] = 1.5;
                    pointSpikes[slot] = 0;
                    pointColors[slot * 3] = 0.85;
                    pointColors[slot * 3 + 1] = 0.97;
                    pointColors[slot * 3 + 2] = 1.0;
                });
                figure.sprite = makeChartLabel(figure.title, figure.subtitle);
                figure.sprite.position.set(figure.label[0], figure.label[1], 0.2);
                chart.add(figure.sprite);
                starCursor += figure.stars.length;
                edgeCursor += figure.edges.length;
            });
            const packetSlot = pointCount - 1;
            pointSizes[packetSlot] = 2.6;
            pointSpikes[packetSlot] = 1;
            color.setHex(0xffc56b);
            pointColors[packetSlot * 3] = color.r;
            pointColors[packetSlot * 3 + 1] = color.g;
            pointColors[packetSlot * 3 + 2] = color.b;

            const pointGeometry = new THREE.BufferGeometry();
            pointGeometry.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3).setUsage(THREE.DynamicDrawUsage));
            pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(pointSizes, 1));
            pointGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(pointAlphas, 1).setUsage(THREE.DynamicDrawUsage));
            pointGeometry.setAttribute('aSpike', new THREE.BufferAttribute(pointSpikes, 1));
            pointGeometry.setAttribute('aColor', new THREE.BufferAttribute(pointColors, 3));
            const chartUniformOpacity = { value: 0 };
            const pointMaterial = new THREE.ShaderMaterial({
                vertexShader: chartStarVertexShader,
                fragmentShader: chartStarFragmentShader,
                uniforms: { uOpacity: chartUniformOpacity, uPixelRatio },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            const points = new THREE.Points(pointGeometry, pointMaterial);
            points.frustumCulled = false;
            points.renderOrder = 5;

            const linePositions = new Float32Array(edgeCount * 2 * 3);
            const lineAlphas = new Float32Array(edgeCount * 2);
            const lineMix = new Float32Array(edgeCount * 2);
            for (let index = 0; index < edgeCount * 2; index += 1) lineMix[index] = random();
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
            lineGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(lineAlphas, 1).setUsage(THREE.DynamicDrawUsage));
            lineGeometry.setAttribute('aMix', new THREE.BufferAttribute(lineMix, 1));
            const lineMaterial = new THREE.ShaderMaterial({
                vertexShader: chartLineVertexShader,
                fragmentShader: chartLineFragmentShader,
                uniforms: { uOpacity: chartUniformOpacity },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
            lines.frustumCulled = false;
            lines.renderOrder = 4;

            /* Dashed "ecliptic" arc behind the figures, like a star atlas. */
            const dashCount = 46;
            const eclipticPositions = new Float32Array(dashCount * 2 * 3);
            const eclipticAlphas = new Float32Array(dashCount * 2);
            const eclipticMix = new Float32Array(dashCount * 2);
            const arcPoint = s => [
                -2.15 + 4.75 * s,
                -1.22 + 1.95 * s + 0.42 * Math.sin(Math.PI * s),
                -0.3
            ];
            for (let dash = 0; dash < dashCount; dash += 1) {
                const a = arcPoint(dash / dashCount);
                const b = arcPoint((dash + 0.5) / dashCount);
                eclipticPositions.set(a, dash * 6);
                eclipticPositions.set(b, dash * 6 + 3);
                const edgeFade = Math.sin(Math.PI * (dash + 0.25) / dashCount);
                eclipticAlphas[dash * 2] = 0.22 * edgeFade;
                eclipticAlphas[dash * 2 + 1] = 0.22 * edgeFade;
                eclipticMix[dash * 2] = 0.8;
                eclipticMix[dash * 2 + 1] = 0.8;
            }
            const eclipticGeometry = new THREE.BufferGeometry();
            eclipticGeometry.setAttribute('position', new THREE.BufferAttribute(eclipticPositions, 3));
            eclipticGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(eclipticAlphas, 1));
            eclipticGeometry.setAttribute('aMix', new THREE.BufferAttribute(eclipticMix, 1));
            const eclipticOpacity = { value: 0 };
            const ecliptic = new THREE.LineSegments(eclipticGeometry, new THREE.ShaderMaterial({
                vertexShader: chartLineVertexShader,
                fragmentShader: chartLineFragmentShader,
                uniforms: { uOpacity: eclipticOpacity },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            }));
            ecliptic.frustumCulled = false;
            ecliptic.renderOrder = 3;

            /* The packet's exit streak reuses the meteor shader. */
            const cometMaterial = new THREE.ShaderMaterial({
                vertexShader: meteorVertexShader,
                fragmentShader: meteorFragmentShader,
                uniforms: { uOpacity: { value: 0 }, uLife: { value: -1 } },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            const comet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cometMaterial);
            comet.visible = false;
            comet.renderOrder = 5;

            chart.add(ecliptic, lines, points, comet);
            spaceRefs.chartParts = {
                starCount, edgeCount, packetSlot,
                pointPositions, pointAlphas, pointGeometry, linePositions, lineAlphas, lineGeometry,
                opacity: chartUniformOpacity, eclipticOpacity, comet, cometMaterial
            };
        }

        const chartPacket = new THREE.Vector3();
        const chartLaunch = new THREE.Vector3();
        const CHART_LAUNCH_DIR = new THREE.Vector3(0.55, 0.835, 0);

        function updateConstellations(time, weight) {
            const parts = spaceRefs.chartParts;
            if (!parts) return;
            const t = ((time % CHART_CYCLE) + CHART_CYCLE) % CHART_CYCLE;
            const activity = smoothWindow(t, CHART_TIMES.activeIn[0], CHART_TIMES.activeIn[1],
                CHART_TIMES.activeOut[0], CHART_TIMES.activeOut[1]);
            uNetworkDim.value = 1 - 0.58 * activity;
            parts.opacity.value = weight;
            parts.eclipticOpacity.value = weight * activity;
            if (spaceRefs.chart) spaceRefs.chart.rotation.y = pointerCurrent.x * 0.1;

            const positions = parts.pointPositions;
            const alphas = parts.pointAlphas;
            const linePositions = parts.linePositions;
            const lineAlphas = parts.lineAlphas;

            chartFigures.forEach(figure => {
                const starTotal = figure.stars.length;
                const edgeTotal = figure.edges.length;
                const live = t >= figure.gather[0] && t < figure.dissolve[1];
                if (live) figure.pose(t, figure.home);
                for (let index = 0; index < starTotal; index += 1) {
                    const slot = figure.starOffset + index;
                    if (!live) {
                        alphas[slot] = 0;
                        continue;
                    }
                    const gatherSpan = figure.gather[1] - figure.gather[0] - 1.1;
                    const gatherStart = figure.gather[0] + gatherSpan * index / Math.max(1, starTotal - 1);
                    const gathered = easeOutCubic(clamp01((t - gatherStart) / 1.1));
                    const dissolveSpan = figure.dissolve[1] - figure.dissolve[0] - 1.3;
                    const dissolveStart = figure.dissolve[0] + 0.3 + dissolveSpan * index / Math.max(1, starTotal - 1);
                    const scattered = easeInCubic(clamp01((t - dissolveStart) / 1.0));
                    const home = figure.home[index];
                    const from = figure.scatterIn[index];
                    const to = figure.scatterOut[index];
                    const zBase = home.z + figure.depth[index];
                    positions[slot * 3] = home.x + from.x * (1 - gathered) + to.x * scattered;
                    positions[slot * 3 + 1] = home.y + from.y * (1 - gathered) + to.y * scattered;
                    positions[slot * 3 + 2] = zBase + from.z * (1 - gathered) + to.z * scattered;
                    let twinkle = 0.85 + 0.15 * Math.sin(time * (1.3 + index * 0.37) + index);
                    if (figure.faint && figure.faint.indexOf(index) !== -1) twinkle *= 0.55;
                    alphas[slot] = gathered * (1 - scattered) * twinkle;
                }
                /* Rover lidar blinks once it has arrived. */
                if (figure === chartFigures[0] && live && t > CHART_TIMES.roverParked) {
                    alphas[figure.starOffset + 5] *= 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(time * 5.2), 6) * 2;
                }
                const lineFade = 1 - clamp01((t - figure.dissolve[0]) / 0.8);
                const drawSpan = figure.draw[1] - figure.draw[0] - 0.55;
                for (let index = 0; index < edgeTotal; index += 1) {
                    const edge = figure.edges[index];
                    const lineSlot = figure.edgeOffset + index;
                    const tipSlot = parts.starCount + lineSlot;
                    const drawStart = figure.draw[0] + drawSpan * index / Math.max(1, edgeTotal - 1);
                    const drawn = live ? easeInOutCubic(clamp01((t - drawStart) / 0.55)) : 0;
                    const a = figure.starOffset + edge[0];
                    const b = figure.starOffset + edge[1];
                    const ax = positions[a * 3];
                    const ay = positions[a * 3 + 1];
                    const az = positions[a * 3 + 2];
                    const bx = ax + (positions[b * 3] - ax) * drawn;
                    const by = ay + (positions[b * 3 + 1] - ay) * drawn;
                    const bz = az + (positions[b * 3 + 2] - az) * drawn;
                    linePositions[lineSlot * 6] = ax;
                    linePositions[lineSlot * 6 + 1] = ay;
                    linePositions[lineSlot * 6 + 2] = az;
                    linePositions[lineSlot * 6 + 3] = bx;
                    linePositions[lineSlot * 6 + 4] = by;
                    linePositions[lineSlot * 6 + 5] = bz;
                    let strength = drawn > 0 ? 0.52 * lineFade : 0;
                    if (figure.faint && (figure.faint.indexOf(edge[0]) !== -1 || figure.faint.indexOf(edge[1]) !== -1)) {
                        strength *= 0.5;
                    }
                    lineAlphas[lineSlot * 2] = strength;
                    lineAlphas[lineSlot * 2 + 1] = strength;
                    positions[tipSlot * 3] = bx;
                    positions[tipSlot * 3 + 1] = by;
                    positions[tipSlot * 3 + 2] = bz;
                    alphas[tipSlot] = drawn > 0 && drawn < 1 ? Math.sin(Math.PI * drawn) : 0;
                }
                const labelAlpha = smoothWindow(t, figure.labelIn[0], figure.labelIn[1],
                    figure.labelOut[0], figure.labelOut[1]);
                figure.sprite.material.opacity = labelAlpha * weight * 0.92;
                figure.sprite.visible = labelAlpha > 0.003;
            });

            /* The data packet: rides the rover until the arm lifts it off,
             * is carried across, rides the quadruped, then leaves as a
             * shooting star. */
            let packetAlpha = 0;
            const comet = parts.comet;
            comet.visible = false;
            if (t >= CHART_TIMES.packetIn && t < CHART_TIMES.grip) {
                roverPacket(t, chartPacket);
                packetAlpha = clamp01((t - CHART_TIMES.packetIn) / 0.8);
            } else if (t >= CHART_TIMES.grip && t < CHART_TIMES.release) {
                solveChartArm(t, chartScratch);
                chartPacket.copy(chartGrip);
                packetAlpha = 1;
            } else if (t >= CHART_TIMES.release && t < CHART_TIMES.launch) {
                dogPacket(t, chartPacket);
                packetAlpha = 1;
            } else if (t >= CHART_TIMES.launch && t < CHART_TIMES.launchEnd) {
                const life = (t - CHART_TIMES.launch) / (CHART_TIMES.launchEnd - CHART_TIMES.launch);
                dogPacket(CHART_TIMES.launch, chartLaunch);
                chartPacket.copy(chartLaunch).addScaledVector(CHART_LAUNCH_DIR, 4.2 * life * life);
                packetAlpha = 1 - clamp01((life - 0.55) / 0.45);
                comet.visible = true;
                parts.cometMaterial.uniforms.uLife.value = life;
                parts.cometMaterial.uniforms.uOpacity.value = weight;
                comet.scale.set(1.5, 0.07, 1);
                comet.rotation.z = Math.atan2(CHART_LAUNCH_DIR.y, CHART_LAUNCH_DIR.x);
                comet.position.copy(chartPacket).addScaledVector(CHART_LAUNCH_DIR, -0.72);
            }
            const packetSlot = parts.packetSlot;
            const pulse = 0.85 + 0.15 * Math.sin(time * 3.1);
            positions[packetSlot * 3] = chartPacket.x;
            positions[packetSlot * 3 + 1] = chartPacket.y;
            positions[packetSlot * 3 + 2] = chartPacket.z + 0.05;
            alphas[packetSlot] = packetAlpha * pulse;

            parts.pointGeometry.attributes.position.needsUpdate = true;
            parts.pointGeometry.attributes.aAlpha.needsUpdate = true;
            parts.lineGeometry.attributes.position.needsUpdate = true;
            parts.lineGeometry.attributes.aAlpha.needsUpdate = true;
        }

        /* Fit the chart into the free sky: right of the headline and above
         * the skill pills on desktop (or above the headline when that strip
         * is too narrow), and across the portrait stage on phones. */
        const chartNdc = new THREE.Vector3();
        const chartRayDirection = new THREE.Vector3();
        function screenToChartPlane(x, y, target) {
            chartNdc.set((x / viewportWidth) * 2 - 1, -(y / viewportHeight) * 2 + 1, 0.5).unproject(camera);
            chartRayDirection.copy(chartNdc).sub(camera.position).normalize();
            const distance = (CHART_PLANE_Z - camera.position.z) / chartRayDirection.z;
            return target.copy(camera.position).addScaledVector(chartRayDirection, distance);
        }
        const chartCornerA = new THREE.Vector3();
        const chartCornerB = new THREE.Vector3();
        const chartCenter = new THREE.Vector3();
        function measureHeroRects() {
            const scrollY = window.scrollY || window.pageYOffset || 0;
            const result = { headline: null, pillsTop: null };
            if (headline) {
                const range = document.createRange();
                range.selectNodeContents(headline);
                const rect = range.getBoundingClientRect();
                if (rect.width > 0) {
                    result.headline = { left: rect.left, right: rect.right, top: rect.top + scrollY };
                }
            }
            const pills = document.querySelector('#home .flex.flex-wrap');
            if (pills) {
                const rect = pills.getBoundingClientRect();
                if (rect.height > 0) result.pillsTop = rect.top + scrollY;
            }
            return result;
        }
        function placeConstellations() {
            const chart = spaceRefs.chart;
            if (!chart || !viewportWidth) return;
            camera.updateMatrixWorld(true);
            const hero = measureHeroRects();
            const chartWidth = CHART_BOUNDS.maxX - CHART_BOUNDS.minX;
            const chartHeight = CHART_BOUNDS.maxY - CHART_BOUNDS.minY;
            const boxes = [];
            const headlineTop = hero.headline ? hero.headline.top : viewportHeight * 0.38;
            if (mobileLayout) {
                /* The whole portrait stage between the HUD and the ID sheet. */
                const stage = measureStageBox();
                boxes.push({ left: viewportWidth * 0.04, right: viewportWidth * 0.96, top: stage.top + 6, bottom: stage.bottom - 10 });
            } else {
                const headlineRight = hero.headline ? hero.headline.right : viewportWidth * 0.5;
                const pillsTop = hero.pillsTop || viewportHeight * 0.62;
                boxes.push({
                    left: Math.max(headlineRight + 56, viewportWidth * 0.5),
                    right: viewportWidth - 40,
                    top: Math.max(72, viewportHeight * 0.1),
                    bottom: Math.min(viewportHeight * 0.74, pillsTop - 22)
                });
                boxes.push({
                    left: hero.headline ? hero.headline.left : viewportWidth * 0.3,
                    right: viewportWidth - 40,
                    top: 56,
                    bottom: headlineTop - 26
                });
            }
            let best = null;
            boxes.forEach(box => {
                if (box.right - box.left < 40 || box.bottom - box.top < 40) return;
                const middleY = (box.top + box.bottom) / 2;
                const middleX = (box.left + box.right) / 2;
                screenToChartPlane(box.left, middleY, chartCornerA);
                screenToChartPlane(box.right, middleY, chartCornerB);
                const worldWidth = chartCornerB.x - chartCornerA.x;
                screenToChartPlane(middleX, box.top, chartCornerA);
                screenToChartPlane(middleX, box.bottom, chartCornerB);
                const worldHeight = chartCornerA.y - chartCornerB.y;
                const pixelsPerWorld = (box.right - box.left) / worldWidth;
                const maxPixels = mobileLayout ? viewportWidth * 0.92 : 640;
                const scale = Math.min(worldWidth / chartWidth, worldHeight / chartHeight,
                    maxPixels / pixelsPerWorld / chartWidth);
                if (!best || scale > best.scale) best = { scale, middleX, middleY };
            });
            if (!best) {
                chart.visible = false;
                return;
            }
            chart.visible = true;
            screenToChartPlane(best.middleX, best.middleY, chartCenter);
            const centerX = (CHART_BOUNDS.minX + CHART_BOUNDS.maxX) / 2;
            const centerY = (CHART_BOUNDS.minY + CHART_BOUNDS.maxY) / 2;
            chart.scale.setScalar(best.scale);
            chart.position.set(
                chartCenter.x - spaceGroup.position.x - centerX * best.scale,
                chartCenter.y - spaceGroup.position.y - centerY * best.scale,
                CHART_PLANE_Z - spaceGroup.position.z
            );
        }

        /* Each theme's scene is built lazily: the active one synchronously,
         * the hidden one on idle so first paint stays cheap. */
        let labBuilt = false;
        let spaceBuilt = false;
        let disposed = false;
        /* Set once applyLayout() has run; layout state below is in its TDZ
         * while the initial theme is being built. */
        let layoutReady = false;

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
            if (layoutReady) placeConstellations();
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
        let layoutDirty = false;
        const cameraBase = new THREE.Vector3();
        const cameraTarget = new THREE.Vector3();
        const pointerTarget = new THREE.Vector2();
        const pointerCurrent = new THREE.Vector2();
        const pointerNdc = new THREE.Vector2(99, 99);
        let pointerActive = false;

        /* Lab-local points bounding the set: bench corner, monitor and the
         * docked AMR on one side; holo panels, docked quadruped and scanner
         * head on the other. The AMR's approach lane and the quadruped's
         * exit run off-stage on purpose. */
        const labExtentPoints = [
            [-1.93, 1.09, -1.62], [-1.6, 1.95, -2.2], [AMR_DOCK_X - 0.55, 0.5, AMR_LANE_Z],
            [3.22, 1.95, 0.8], [DOG_DOCK.x + 0.75, 1.1, DOG_DOCK.z - 0.25], [SCAN_POINT.x, SCAN_HEAD_Y + 0.1, SCAN_POINT.z]
        ].map(point => new THREE.Vector3(point[0], point[1], point[2]));
        const extentProbe = new THREE.Vector3();
        const headline = document.querySelector('#home h1');

        function measureLabExtent() {
            labGroup.updateMatrixWorld(true);
            let left = Infinity;
            let right = -Infinity;
            labExtentPoints.forEach(point => {
                extentProbe.copy(point).applyMatrix4(labGroup.matrixWorld).project(camera);
                const x = (extentProbe.x + 1) * 0.5 * viewportWidth;
                left = Math.min(left, x);
                right = Math.max(right, x);
            });
            return { left, right };
        }

        function measureHeadlineRight() {
            if (!headline) return 0;
            const range = document.createRange();
            range.selectNodeContents(headline);
            const rect = range.getBoundingClientRect();
            return rect.width > 0 ? rect.right : 0;
        }

        /* Desktop: the lab is a fixed backdrop, so on laptop-width screens
         * the default framing put the monitor, hologram and gripper right
         * behind the headline. Slide the set into the strip right of the
         * headline, shrink it (to 78 % at most) when that strip is narrow,
         * and only when it still doesn't fit let it run off the right edge
         * (up to a quarter) before overlapping the text. */
        function fitLabBesideHeadline(baseScale) {
            const freeLeft = measureHeadlineRight() + 32;
            const freeRight = viewportWidth - 24;
            camera.updateMatrixWorld(true);
            let extent = measureLabExtent();
            if (extent.left >= freeLeft && extent.right <= freeRight) return;

            const fit = Math.max(0.78, Math.min(1, (freeRight - freeLeft) / (extent.right - extent.left)));
            labGroup.scale.setScalar(baseScale * fit);
            extent = measureLabExtent();
            const width = extent.right - extent.left;
            const lowest = freeLeft;
            const highest = freeRight - width;
            const targetLeft = lowest <= highest
                ? Math.min(Math.max(extent.left, lowest), highest)
                : Math.min(lowest, freeRight - width * 0.75);
            /* A pure x shift moves each projected point linearly, so a
             * measured pixels-per-unit converges in a step or two. */
            for (let pass = 0; pass < 2; pass += 1) {
                labGroup.position.x += 1;
                const shifted = measureLabExtent().left;
                labGroup.position.x -= 1;
                const pixelsPerUnit = shifted - extent.left;
                if (!(pixelsPerUnit > 0)) return;
                labGroup.position.x += (targetLeft - extent.left) / pixelsPerUnit;
                extent = measureLabExtent();
                if (Math.abs(extent.left - targetLeft) < 1) return;
            }
        }

        /* Phones: the canvas is a portrait "live monitor" at the top of the
         * page instead of a full-screen backdrop. The free band runs from
         * the HUD strip down to where the ID sheet overlaps the stage. */
        const stageHud = document.querySelector('#home .m-hud');
        const stageSheet = document.querySelector('#home .hero-copy');
        function measureStageBox() {
            const canvasTop = canvas.getBoundingClientRect().top;
            let top = viewportHeight * 0.2;
            let bottom = viewportHeight * 0.86;
            if (stageHud) {
                const rect = stageHud.getBoundingClientRect();
                if (rect.height > 0) top = rect.bottom - canvasTop + 10;
            }
            if (stageSheet) {
                const rect = stageSheet.getBoundingClientRect();
                if (rect.height > 0) bottom = Math.min(viewportHeight, rect.top - canvasTop) - 6;
            }
            if (bottom - top < 120) {
                top = viewportHeight * 0.2;
                bottom = viewportHeight * 0.86;
            }
            return { left: 8, right: viewportWidth - 8, top, bottom };
        }

        /* The working core of the cell for the portrait stage: bench and
         * monitor, docked AMR, the arm at full height, the scanner head and
         * the docked quadruped. The hologram panels may crop at the edge. */
        const labStagePoints = [
            [-1.93, 1.0, -1.62], [-1.6, 1.95, -2.2],
            /* The AMR turns on the spot at the dock: its whole footprint. */
            [AMR_DOCK_X - 0.72, 0, AMR_LANE_Z + 0.62], [AMR_DOCK_X - 0.72, 0.95, AMR_LANE_Z],
            [ARM_BASE.x, 2.45, ARM_BASE.z], [SCAN_POINT.x, SCAN_HEAD_Y + 0.1, SCAN_POINT.z],
            /* The quadruped turns at its dock too; head and near feet. */
            [DOG_DOCK.x + 0.98, 1.3, DOG_DOCK.z - 0.2], [DOG_DOCK.x + 0.55, 0, DOG_DOCK.z + 0.7]
        ].map(point => new THREE.Vector3(point[0], point[1], point[2]));
        function measureLabBox(points) {
            labGroup.updateMatrixWorld(true);
            const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
            points.forEach(point => {
                extentProbe.copy(point).applyMatrix4(labGroup.matrixWorld).project(camera);
                const x = (extentProbe.x + 1) * 0.5 * viewportWidth;
                const y = (1 - extentProbe.y) * 0.5 * viewportHeight;
                box.left = Math.min(box.left, x);
                box.right = Math.max(box.right, x);
                box.top = Math.min(box.top, y);
                box.bottom = Math.max(box.bottom, y);
            });
            return box;
        }
        /* Horizontal framing window of the pan camera: 3.2 lab units at the
         * depth of the AMR lane / dog dock. Height still fits the whole set. */
        const stageWindowPoints = [
            new THREE.Vector3(-1.6, 0, AMR_LANE_Z), new THREE.Vector3(1.6, 0, AMR_LANE_Z)
        ];
        function fitLabToStage() {
            const stage = measureStageBox();
            camera.updateMatrixWorld(true);
            labGroup.position.x = 0;
            for (let pass = 0; pass < 3; pass += 1) {
                let box = measureLabBox(labStagePoints);
                const frame = measureLabBox(stageWindowPoints);
                const fit = Math.min(
                    (stage.right - stage.left) / (frame.right - frame.left),
                    (stage.bottom - stage.top) / (box.bottom - box.top)
                );
                labGroup.scale.multiplyScalar(Math.max(0.5, Math.min(2, fit)));
                box = measureLabBox(labStagePoints);
                /* Projected points move ~linearly with a group shift, so a
                 * measured pixels-per-unit centres the set in one step. */
                labGroup.position.y += 1;
                const perY = measureLabBox(labStagePoints).top - box.top;
                labGroup.position.y -= 1;
                if (perY < 0) {
                    labGroup.position.y += ((stage.top + stage.bottom) / 2 - (box.top + box.bottom) / 2) / perY;
                }
            }
            /* x is driven per frame by the pan camera (stageFocusAt). */
            labGroup.position.x = -stageFocusAt(sceneTime) * labGroup.scale.x;
        }

        function applyLayout() {
            /* Size from the canvas's CSS box (the full-screen backdrop on
             * desktop, the stage at the top of the page on phones) rather
             * than the window, so URL-bar show/hide doesn't stretch it. */
            const rect = canvas.getBoundingClientRect();
            viewportWidth = Math.max(1, Math.round(rect.width) || window.innerWidth);
            viewportHeight = Math.max(1, Math.round(rect.height) || window.innerHeight);
            mobileLayout = mobileQuery.matches;
            if (mobileLayout || !finePointerQuery.matches) {
                pointerActive = false;
                pointerTarget.set(0, 0);
            }

            camera.aspect = viewportWidth / viewportHeight;
            /* Phones look down on the cell a little more steeply, which
             * gives the wide set some depth in a portrait frame. */
            camera.fov = mobileLayout ? 36 : 34;
            cameraBase.set(0, mobileLayout ? 5.2 : 3.75, mobileLayout ? 14 : 15);
            cameraTarget.set(0, mobileLayout ? 0.4 : 0.55, 0);
            camera.position.copy(cameraBase);
            camera.lookAt(cameraTarget);
            camera.updateProjectionMatrix();

            if (mobileLayout) {
                labGroup.position.set(-0.3, -1.2, 0);
                labGroup.scale.setScalar(1);
                fitLabToStage();
                spaceGroup.position.set(0, 0.2, -1.6);
                spaceGroup.scale.setScalar(0.92);
            } else {
                labGroup.position.set(3.3, -1.7, -0.3);
                labGroup.scale.setScalar(1.12);
                fitLabBesideHeadline(1.12);
                spaceGroup.position.set(3.05, 0.05, -0.9);
                spaceGroup.scale.setScalar(1);
            }

            renderer.setPixelRatio(
                Math.min(window.devicePixelRatio || 1, mobileLayout ? 1.25 : 1.75)
            );
            uPixelRatio.value = renderer.getPixelRatio();
            renderer.setSize(viewportWidth, viewportHeight, false);
            layoutReady = true;
            placeConstellations();
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

        const DOG_STRIDE = 0.5;
        const SCAN_IDLE = 0x2dd4bf;
        const SCAN_BLINK = 0xe6fffb;
        const SCAN_PASS = 0x22c55e;
        const SCAN_FAIL = 0xef4444;

        function updateLaboratory(time) {
            if (!labBuilt) return;

            /* Arm: IK pose from the keyframe track. */
            evaluateArmPose(time);
            labRefs.armYaw.rotation.y = armPose.yaw;
            labRefs.shoulder.rotation.z = armPose.shoulder;
            labRefs.elbow.rotation.z = armPose.elbow;
            labRefs.wrist.rotation.z = armPose.wrist;
            labRefs.wristRoll.rotation.y = armPose.roll;
            const fingerOffset = armPose.jaw + FINGER_PAD + FINGER_THICKNESS / 2;
            labRefs.fingerLeft.position.x = -fingerOffset;
            labRefs.fingerRight.position.x = fingerOffset;

            /* AMR: wheels roll with the distance driven; turning on the spot
             * spins the two sides in opposite directions. */
            evaluateAmr(time);
            labRefs.amr.position.set(amrState.x, 0, AMR_LANE_Z);
            labRefs.amr.rotation.y = amrState.heading;
            labRefs.amrWheels.forEach(wheel => {
                const track = wheel.position.z;
                wheel.rotation.z = -(amrState.odometer + amrState.turn * track) / AMR_WHEEL_RADIUS;
            });
            labRefs.amrSweep.rotation.y = time * 1.7;
            labRefs.amrLidar.rotation.y = time * 5.0;

            /* Quadruped: a trot gait driven by distance travelled, blended
             * with the idle breathing when it stands still. */
            evaluateDog(time, dogState);
            evaluateDog(time - 0.1, dogPrevious);
            const dogSpeed = Math.max(0, dogState.odometer - dogPrevious.odometer) / 0.1;
            const gait = clamp01(dogSpeed / 0.6);
            const gaitPhase = dogState.odometer / DOG_STRIDE * Math.PI * 2;
            labRefs.quadruped.position.set(dogState.x, 0, dogState.z);
            labRefs.quadruped.rotation.y = dogState.heading;
            labRefs.quadrupedBody.position.y = DOG_BODY_Y +
                Math.sin(time * 1.1) * 0.006 * (1 - gait) +
                Math.abs(Math.sin(gaitPhase)) * 0.025 * gait;
            labRefs.quadrupedBody.rotation.x = Math.sin(time * 0.55) * 0.004 * (1 - gait) +
                Math.sin(gaitPhase) * 0.025 * gait;
            labRefs.quadrupedLegs.forEach((leg, index) => {
                const idle = Math.sin(time * 0.8 + leg.phase + index * 0.35);
                const step = gaitPhase + leg.phase;
                /* Diagonal pairs share a phase (trot); the knee folds while
                 * the foot swings forward. */
                leg.hip.rotation.z = leg.hipBase + idle * 0.03 * (1 - gait) + Math.sin(step) * 0.32 * gait;
                leg.knee.rotation.z = leg.kneeBase - idle * 0.024 * (1 - gait) -
                    Math.max(0, Math.cos(step)) * 0.5 * gait;
            });
            let headYaw = (Math.sin(time * 0.32) * 0.38 + Math.sin(time * 0.17 + 2.0) * 0.18) * (1 - gait);
            if (uPointerStrength.value > 0.05 && gait < 0.05) {
                const dx = pointerLabLocal.x - dogState.x;
                const dz = pointerLabLocal.z - dogState.z;
                let track = Math.atan2(-dz, dx) - dogState.heading;
                track = Math.atan2(Math.sin(track), Math.cos(track));
                track = Math.max(-0.7, Math.min(0.7, track));
                headYaw += (track - headYaw) * 0.55 * uPointerStrength.value;
            }
            labRefs.quadrupedHead.rotation.y += (headYaw - labRefs.quadrupedHead.rotation.y) * 0.08;
            labRefs.quadrupedHead.rotation.z = Math.sin(time * 0.9) * 0.03;

            /* Vision station: the scan line sweeps the held parcel, then the
             * lamp shows the verdict (green = to the quadruped, red = reject). */
            let lampColor = SCAN_IDLE;
            let scanning = false;
            let scanY = SCAN_POINT.y;
            PARCELS.forEach((parcel, index) => {
                const u = slotTime(time, index);
                if (u >= TIMING.scanStart && u < TIMING.scanEnd) {
                    const progress = (u - TIMING.scanStart) / (TIMING.scanEnd - TIMING.scanStart);
                    scanning = true;
                    scanY = SCAN_POINT.y + 0.11 * Math.cos(progress * Math.PI * 2);
                    lampColor = Math.floor(u * 8) % 2 ? SCAN_BLINK : SCAN_IDLE;
                } else if (u >= TIMING.scanEnd && u < TIMING.verdictEnd) {
                    lampColor = parcel.pass ? SCAN_PASS : SCAN_FAIL;
                }
            });
            labRefs.scanLine.visible = scanning;
            labRefs.scanLine.position.y = scanY;
            labRefs.scanLamp.color.setHex(lampColor);

            PARCELS.forEach((parcel, index) => placeParcel(labRefs.parcels[index], parcel, index, time));

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
            updateConstellations(time, themeMix);
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
            if (mobileLayout && labGroup.visible) {
                /* Camera x sits at 0, so centring lab x = f means group x = -f * scale. */
                labGroup.position.x = -stageFocusAt(time) * labGroup.scale.x;
            }
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

        /* On phones the canvas is a stage at the top of the page; stop
         * rendering once it has scrolled out of view. The desktop backdrop
         * is fixed and therefore always on screen. */
        let canvasOnScreen = true;
        const stageObserver = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(entries => {
                canvasOnScreen = entries[entries.length - 1].isIntersecting;
                if (canvasOnScreen) startAnimation();
                else stopAnimation();
            })
            : null;
        if (stageObserver) stageObserver.observe(canvas);

        function startAnimation() {
            if (animationFrame !== null || document.hidden || motionQuery.matches || !canvasOnScreen) return;
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
                if (!layoutDirty && nextWidth === viewportWidth && nextHeight === viewportHeight &&
                    mobileQuery.matches === mobileLayout) {
                    return;
                }
                layoutDirty = false;
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
            const textures = new Set();
            scene.traverse(object => {
                if (object.isLight && object.shadow) object.shadow.dispose();
                if (object.geometry) geometries.add(object.geometry);
                if (object.material) {
                    const objectMaterials = Array.isArray(object.material)
                        ? object.material
                        : [object.material];
                    objectMaterials.forEach(material => {
                        materials.add(material);
                        if (material.map) textures.add(material.map);
                    });
                }
            });
            geometries.forEach(geometry => geometry.dispose());
            materials.forEach(material => material.dispose());
            textures.forEach(texture => texture.dispose());
            if (environmentTarget) {
                environmentTarget.dispose();
                environmentTarget = null;
                scene.environment = null;
            }
            renderer.dispose();
            if (headlineObserver) headlineObserver.disconnect();
            if (stageObserver) stageObserver.disconnect();
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

        /* The desktop framing depends on the headline's width, which changes
         * with the language switch and when web fonts finish swapping in. */
        function requestRelayout() {
            if (disposed) return;
            layoutDirty = true;
            handleResize();
        }
        const headlineObserver = headline && typeof MutationObserver === 'function'
            ? new MutationObserver(requestRelayout)
            : null;
        if (headlineObserver) {
            headlineObserver.observe(headline, { childList: true, characterData: true, subtree: true });
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(requestRelayout, () => {});
        }

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
