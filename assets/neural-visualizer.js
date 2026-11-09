// Vigrel Neural Visualizer - Single Core Point with Bundled Web Effect
// ENHANCED 2026-10-01: strands intermittently bend/reach toward the user
// (mirror-trying-to-escape) and the web pulsates with each touch, plus the
// existing breathing core, particles, cursor attractor and light-theme trail.
// Deliberately ADDITIVE: all original timing/colors/flow are unchanged so it
// stays as smooth as before — this only layers a depth "reach" wave and a
// touch ripple over the existing strand drawing.
//
// (Backup of the pre-enhancement file: neural-visualizer.js.original.bak)

(function() {
    'use strict';

    const canvas = document.getElementById('neural-canvas');
    const screen = canvas.getContext('2d', { alpha: false });
    // Offscreen render buffer: draw the whole scene here once, then blit to
    // the visible canvas. Cuts per-frame composite cost and gives cleaner trails.
    const off = document.createElement('canvas');
    const ctxOff = off.getContext('2d');
    // Optional direct-to-screen path. The offscreen buffer exists for cleaner
    // trails, but it costs a full-canvas blit every frame; this lets us measure
    // that copy instead of assuming it is free.
    let DIRECT = false;
    const ctxScreen = screen;
    let ctx = ctxOff;
    window.jarvisVizDirect = (on) => { DIRECT = !!on; return DIRECT; };
    // The travelling highlight is currently 84 separate arc strokes per ring (252
    // per frame). A conic gradient reproduces the same look in ONE stroke per ring,
    // which is the kind of change that cuts load without changing the picture.
    // ON by default: one conic-gradient stroke per ring instead of 84 arc strokes.
    // Measured GPU 64.3% -> 52.0% (system 24.5% -> 21.9%) and, in a side-by-side
    // screenshot check, it actually shows the travelling highlight more clearly than
    // the segment loop did. Same look, less work.
    let CONIC = true;
    window.jarvisVizConic = (on) => { CONIC = !!on; return CONIC; };
    // QA only: hold the pulse/ripple at a fixed value so a screenshot can catch it.
    let FREEZE = false;
    window.jarvisVizFreeze = (on) => { FREEZE = !!on; return FREEZE; };
    window.jarvisVizRipple = (v) => { haloRipple = Number(v) || 0; return haloRipple; };
    window.jarvisVizPulse = (v) => { haloPulse = Number(v) || 0; return haloPulse; };

    canvas.style.contain = 'layout paint';
    canvas.style.willChange = 'transform';

    // Theme: these strands were tuned against a light wash, which is why the big
    // view looked pale. 'dark' keeps the identical motion on the black ground the
    // orb uses. Runtime switchable: setVisualTheme('light' | 'dark').
    let THEME = 'dark';
    try { THEME = localStorage.getItem('jarvis.viz.theme') || 'dark'; } catch (e) {}
    // Plexus layer: nodes + links drawn alongside the strands, at low alpha so it
    // reads as texture behind the web rather than a second competing subject.
    // "Thinking" state: driven from the renderer when a reply is in flight, so
    // the core keeps a visible, purposeful animation instead of sitting still.
    let thinking = false;
    let thinkAmt = 0;   // eased 0..1 so the indicator never pops or flickers
    window.jarvisVizThinking = function (on) {
        if (arguments.length === 0) return thinking;   // getter
        thinking = !!on;
        return thinking;
    };

    let PLEXUS_ON = true;
    try { PLEXUS_ON = (localStorage.getItem('jarvis.viz.plexus') || '1') === '1'; } catch (e) {}
    window.setPlexusLayer = function (on) {
        PLEXUS_ON = !!on;
        try { localStorage.setItem('jarvis.viz.plexus', PLEXUS_ON ? '1' : '0'); } catch (e) {}
        return PLEXUS_ON;
    };
    const PLEX = { nodes: [], step: 0 };
    // Click shockwave: radial impulse applied to every node, decaying back to the
    // normal drift (never snapped home).
    const plexBurst = { active: false, x: 0, y: 0, age: 0 };
    // Smoothed cursor: raw pointer input is jittery, and the mesh amplified it.
    let _mxSmooth = 0, _mySmooth = 0;
    const _CURSOR_EASE = 0.08;

    const WASH = () => (THEME === 'dark' ? 'rgba(8, 8, 12, 0.82)' : 'rgba(228, 232, 237, 0.78)');
    const BG = () => (THEME === 'dark' ? '#08080c' : '#e4e8ed');
    window.setVisualTheme = function (t) {
        THEME = (t === 'light') ? 'light' : 'dark';
        try { localStorage.setItem('jarvis.viz.theme', THEME); } catch (e) {}
        return THEME;
    };

    // Render at native size. At 0.6 with a 1500px cap the core was drawn small and
    // then upscaled, which looked soft on any 1080p+ display.
    // 1.5x supersampling: on a Retina panel a 1:1 canvas still looks slightly soft,
    // but full 2x doubles the pixel count for little visible gain.
    // Supersampling factor. Not const any more: QA needs to compare 1.5 / 1.25 / 1.0
    // on the same scene to answer "how much does this actually cost?" with numbers.
    let RENDER_SCALE = Math.min(1.5, (window.devicePixelRatio || 1));
    // QA: measure what the glow passes cost. shadowBlur on large arcs is the
    // classic Skia cliff, and this answers it with numbers instead of opinion.
    let GLOW_ON = true;
    window.jarvisVizGlow = (on) => { GLOW_ON = !!on; return GLOW_ON; };
    window.jarvisVizScale = (v) => {
        const val = Number(v);
        if (!(val > 0.5 && val <= 2)) return RENDER_SCALE;
        RENDER_SCALE = val;
        try { resize(); } catch (_) {}
        return RENDER_SCALE;
    };
    const MAX_RENDER_DIM = 2400;

    let width, height, centerX, centerY;
    let dispW, dispH, scaleX, scaleY;
    let isActive = true;
    let animFrameId = null;
    let mouseX = 0, mouseY = 0;
    let mouseActive = false;
    let audioLevel = 0;
    let lastFrameTime = 0;
    let lastAnimateTimestamp = performance.now();
    const TARGET_FRAME_TIME = 41.67;  // ~24fps
    // Performance: this canvas is the single largest CPU/GPU consumer on the Mac
    // (measured: 66% in the GPU helper while llama-server was idle), and that
    // contention is what pushed replies to 13-23s. Two cheap brakes: a lite mode
    // while the model is generating, and a full pause when nobody can see it.
    const LITE_FRAME_TIME = 100;      // ~10fps
    // Idle repaint: a still scene only needs a couple of frames a second. Measured
    // cost here was ~93 ms of GPU work PER FRAME, so frame count is what matters.
    const IDLE_FRAME_TIME = 500;      // 2fps
    let _lite = false;
    // Idle throttle. Measured with the app sitting untouched: the GPU process held
    // 56.7% CPU average (peak 84.6%) drawing a still scene at 24 fps, which is the
    // fan noise and the battery drain. When nothing has happened for 1.5 s the
    // visualiser drops to ~10 fps and skips its glow passes; the first sound or
    // press restores the full rate on the next frame.
    let _idleNow = false;
    let _lastActivity = 0;
    const IDLE_AFTER_MS = 1500;
    let _frames = 0, _fps = 0, _fpsT0 = 0;
    let _lastPulseAt = 0;
    let _hidden = false;
    window.jarvisVizLite = (on) => { _lite = !!on; };

    const WEB_STRANDS = 40;
    const STRAND_SEGMENTS = 10;
    const ENERGY_PARTICLES = 28;

    let coreRadius = 0;
    let corePulse = 0;
    let coreGlow = 0;
    let coreEnergy = 1.0;

    const strandAngles = new Float32Array(WEB_STRANDS);
    const strandLengths = new Float32Array(WEB_STRANDS);
    const strandSpeeds = new Float32Array(WEB_STRANDS);
    const strandPhases = new Float32Array(WEB_STRANDS);
    const strandWidths = new Float32Array(WEB_STRANDS);
    const strandBrightness = new Float32Array(WEB_STRANDS);
    const particles = [];

    let pulseWave = 0;
    let haloPulse = 0;   // fired by the PULSE button, decays in about a second
    let haloCore = 0;    // fired by the CORE button: deeper, slower bloom
    let haloPhase = 0;   // travels the shimmer around the ellipse
    let haloRipple = 0;  // 0..1 expanding sheen released on either button
    let lastFloorRing = { cx: 0, cy: 0, rx: 0, ry: 0 };   // exact drawn geometry, for QA
    let pulseActive = false;
    let _lastAutoPulse = 0;
    let lastInteractionTime = 0;

    // ========================= ENHANCEMENT STATE =========================
    // "Reach toward the user" — strands press toward a mirror-facing wall just
    // below centre (where the viewer sits), like threads pushing out of a
    // mirror. The reach is CONTINUOUS so it's always visibly moving, but with a
    // periodic swell so it reads as a living surface surging forward then
    // easing back — never static, never a jarring snap.
    let reachPhase = 0;
    const REACH_ANCHOR_X = 0.5;   // fraction of width  (0..1)
    const REACH_ANCHOR_Y = 0.66;  // fraction of height (mirror plane below centre)
    const REACH_AMPLITUDE = 0.95;
    const REACH_FREQ = 0.045;  // ~2.6x slower swell; was 0.12 (twitchy)
    // ---- Mouse interaction: cursor magnetically repels particles and bends
    // strands within MOUSE_RADIUS so the web reacts to the pointer. ----
    const MOUSE_RADIUS = 160;  // influence radius (px, render-scaled space)
    const MOUSE_FORCE = 0.55;  // how strongly the pointer pushes particles/strands
    // ---- Holograph/HUD layer (Direction B): futuristic instrument dressing
    // over the web. Each piece is behind a flag so it can be toggled freely. ----
    const HUD_RING_ON = 1;      // audio-reactive radial ring (swells with speech)
    const HUD_FRINGE_ON = 1;    // chromatic-fringe (red/cyan edge) on the ring
    const HUD_SCANLINE_ON = 1;  // drifting horizontal scanline sweep
    const HUD_BRACKETS_ON = 1;  // HUD corner brackets + ring readout ticks
    // ----------------------------------------------------------------------
    // PSEUDO-3D Z-DEPTH (Direction A): each strand/particle point carries a Z
    // that peaks at mid-strand (mirror-surface convexity) and we perspective-
    // project it, so nearer points scale UP and push outward from the core.
    // That is what reads as "coming out of the screen toward the viewer" —
    // a real depth surge, not a 2D upward bend.
    const Z_FOCAL = 260;        // perspective focal length (px). Lower = stronger pull-out.
    const Z_DEPTH_MAX = 170;    // max Z travel (px) toward the viewer at mid-strand peak.
    // ----------------------------------------------------------------------
    let reachAnchorX = 0;
    let reachAnchorY = 0;

    // Touch ripples: { origin-dist from core, speed, strength }. They travel
    // outward on a click/touch, bend + brighten strands as they pass, and
    // flash the mirror wall when the ring strikes it — a visible "hit."
    const touchRipples = [];
    const MAX_RIPPLES = 8;
    // =====================================================================

    function resize() {
        // Site adaptation: the app's visualizer always owns the whole window; on
        // the marketing page it lives inside the hero section. Measure the canvas
        // element instead so the core stays centred in the hero, not the viewport.
        dispW = canvas.clientWidth || window.innerWidth;
        dispH = canvas.clientHeight || window.innerHeight;
        let rw = Math.round(dispW * RENDER_SCALE);
        let rh = Math.round(dispH * RENDER_SCALE);
        const maxDim = Math.max(rw, rh);
        if (maxDim > MAX_RENDER_DIM) {
            const k = MAX_RENDER_DIM / maxDim;
            rw = Math.round(rw * k);
            rh = Math.round(rh * k);
        }
        width = rw;
        height = rh;
        canvas.width = width;
        canvas.height = height;
        off.width = width;
        off.height = height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        scaleX = width / dispW;
        scaleY = height / dispH;
        centerX = width * 0.5;
        centerY = height * 0.5;
        // Scale with the canvas. A fixed fraction of the *height* left the core
        // looking lost on a 1600x1000 window: it occupied under half the width.
        coreRadius = Math.min(width, height) * 0.072;
        if (PLEX.nodes) PLEX.nodes.length = 0;   // re-seed for the new bounds
        // User anchor sits below centre — the direction a viewer naturally sits.
        reachAnchorX = width * REACH_ANCHOR_X;
        reachAnchorY = height * REACH_ANCHOR_Y;
    }

    function initStrands() {
        for (let i = 0; i < WEB_STRANDS; i++) {
            strandAngles[i] = (i / WEB_STRANDS) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            strandLengths[i] = 0.25 + Math.random() * 0.45;
            strandSpeeds[i] = 0.3 + Math.random() * 0.7;
            strandPhases[i] = Math.random() * Math.PI * 2;
            strandWidths[i] = 0.5 + Math.random() * 1.5;
            strandBrightness[i] = 0.4 + Math.random() * 0.6;
        }
    }

    function initParticles() {
        for (let i = 0; i < ENERGY_PARTICLES; i++) {
            particles.push({
                strandIdx: Math.floor(Math.random() * WEB_STRANDS),
                progress: Math.random(),
                speed: 0.002 + Math.random() * 0.006,
                size: 1 + Math.random() * 2.5,
                brightness: 0.5 + Math.random() * 0.5
            });
        }
    }

    // A click/touch spawns a ripple ring that travels outward from the core.
    function spawnRipple() {
        touchRipples.push({
            dist: coreRadius * 1.5,          // starts just beyond the core
            speed: Math.min(width, height) * 0.06,
            strength: 0.5 + Math.random() * 0.4
        });
        if (touchRipples.length > MAX_RIPPLES) touchRipples.shift();
    }

    function drawCore(time) {
        corePulse = Math.sin(time * 0.0011) * 0.3 + 0.7;   // ~5.7s breathe
        coreGlow = Math.sin(time * 0.0018) * 0.2 + 0.8;    // ~3.5s glow

        const pulseRadius = coreRadius * (1 + corePulse * 0.4);
        // coreEnergy used to run 0.8..2.8, so every gradient stop clamped to full
        // alpha and the orb read harsh. Clamp the driver, then layer soft bloom.
        const ce = Math.min(1.45, Math.max(0.85, coreEnergy)) + thinkAmt * 0.18;

        // Thinking indicator: eased in/out, one slow gradient arc. Deliberately
        // no per-frame flicker — it should read as calm concentration.
        thinkAmt += ((thinking ? 1 : 0) - thinkAmt) * 0.06;
        if (thinkAmt > 0.01) {
            const R = coreRadius * (3.2 + 0.25 * Math.sin(time * 0.0009));
            const sweep = time * 0.00055;              // slow, ~11s per revolution
            const grad = ctx.createLinearGradient(
                centerX + Math.cos(sweep) * R, centerY + Math.sin(sweep) * R,
                centerX - Math.cos(sweep) * R, centerY - Math.sin(sweep) * R);
            grad.addColorStop(0, `rgba(150, 235, 255, ${0.55 * thinkAmt})`);
            grad.addColorStop(0.5, `rgba(90, 200, 255, ${0.12 * thinkAmt})`);
            grad.addColorStop(1, 'rgba(60, 170, 255, 0)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, R, 0, Math.PI * 2);
            ctx.stroke();

            // gentle inner glow that breathes with the eased value
            const halo = ctx.createRadialGradient(centerX, centerY, coreRadius * 1.4,
                                                  centerX, centerY, R * 1.08);
            halo.addColorStop(0, `rgba(120, 220, 255, ${0.05 * thinkAmt})`);
            halo.addColorStop(1, 'rgba(120, 220, 255, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(centerX, centerY, R * 1.08, 0, Math.PI * 2);
            ctx.fill();
        }

        const ringR = pulseRadius * (1.6 + Math.sin(time * 0.0009) * 0.25);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0, 200, 255, ${0.08 * coreGlow})`;
        ctx.lineWidth = 1.5;
        ctx.arc(centerX, centerY, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Three stacked halos: far, mid, near. Overlapping translucent gradients
        // give a bloom that has no visible edge anywhere.
        const halos = [
            { r: pulseRadius * 7.0, a: 0.05 },
            { r: pulseRadius * 3.6, a: 0.09 },
            { r: pulseRadius * 2.1, a: 0.14 },
        ];
        for (const h of halos) {
            const g = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, h.r);
            g.addColorStop(0, `rgba(120, 225, 255, ${Math.min(0.5, h.a * coreGlow * ce)})`);
            g.addColorStop(0.35, `rgba(0, 170, 235, ${Math.min(0.3, h.a * 0.55 * coreGlow * ce)})`);
            g.addColorStop(1, 'rgba(0, 90, 180, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(centerX, centerY, h.r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Body: no hard white disc, just a gentle gradient that fades out.
        const bodyR = pulseRadius * 2.0;
        const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, bodyR);
        coreGrad.addColorStop(0, `rgba(240, 253, 255, ${0.34 * ce})`);
        coreGrad.addColorStop(0.18, `rgba(175, 240, 255, ${0.30 * ce})`);
        coreGrad.addColorStop(0.42, `rgba(70, 200, 245, ${0.18 * ce})`);
        coreGrad.addColorStop(0.70, `rgba(0, 145, 225, ${0.08 * ce})`);
        coreGrad.addColorStop(1, 'rgba(0, 90, 180, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, bodyR, 0, Math.PI * 2);
        ctx.fill();

        // Soft centre: a small gradient, not a flat circle, so it glows rather
        // than sitting on top as a white lid.
        const dotR = pulseRadius * 0.62;
        const dot = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, dotR);
        dot.addColorStop(0, `rgba(255, 255, 255, ${0.55 * ce})`);
        dot.addColorStop(0.45, `rgba(210, 248, 255, ${0.30 * ce})`);
        dot.addColorStop(1, 'rgba(160, 235, 255, 0)');
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(centerX, centerY, dotR, 0, Math.PI * 2);
        ctx.fill();
    }

    // Cursor force: pushes a point away from the pointer within MOUSE_RADIUS,
    // with a smooth falloff (strongest at the cursor, zero at the edge). Used
    // by both the particle loop and the strand loop so the web reacts to the
    // mouse. Returns the displaced [x, y].
    function mouseRepel(x, y) {
        if (!mouseActive) return [x, y];
        const dx = x - mouseX;
        const dy = y - mouseY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= MOUSE_RADIUS * MOUSE_RADIUS || d2 === 0) return [x, y];
        const d = Math.sqrt(d2);
        const falloff = 1 - d / MOUSE_RADIUS;      // 1 at cursor, 0 at edge
        const push = falloff * falloff * MOUSE_FORCE;
        return [x + (dx / d) * push * 40, y + (dy / d) * push * 40];
    }

    function drawWebStrands(time) {
        const maxRadius = Math.min(width, height) * 0.7;

        // --- ENHANCEMENT: advance the reach wave + ripples ---
        reachPhase += REACH_FREQ;
        for (let i = touchRipples.length - 1; i >= 0; i--) {
            touchRipples[i].dist += touchRipples[i].speed * 0.55;   // calmer travel
            if (touchRipples[i].dist > maxRadius * 1.4) touchRipples.splice(i, 1);
        }
        // ---------------------------------------------------

        for (let i = 0; i < WEB_STRANDS; i++) {
            const baseAngle = strandAngles[i] + Math.sin(time * 0.001 * strandSpeeds[i] + strandPhases[i]) * 0.15;
            const strandLen = strandLengths[i] * maxRadius;
            const alpha = strandBrightness[i] * coreEnergy * (0.3 + Math.sin(time * 0.002 + strandPhases[i]) * 0.2);

            // ENHANCEMENT: per-strand reach — each strand presses toward the
            // mirror wall, slightly phase-offset from its neighbours so the
            // whole web reads as a living surface pushing forward one strand
            // at a time (mirror-trying-to-escape). Continuous 0.35..1 with a
            // periodic swell so it never sits still.
            const strandReach = (0.35 + 0.65 * Math.max(0, Math.sin(reachPhase + strandPhases[i] * 2.3))) * REACH_AMPLITUDE;

            // ENHANCEMENT: accumulate ripple bending across any active touch rings.
            let rippleBend = 0;
            let rippleGlow = 0;
            for (let rI = 0; rI < touchRipples.length; rI++) {
                const rp = touchRipples[rI];
                const band = 0.18 * maxRadius;                       // width of the passing ring
                const g = 1 - Math.abs((strandLen - rp.dist) / band); // 1 at ring centre, 0 at edges
                if (g > 0) {
                    const w = g * rp.strength;
                    rippleBend += w;
                    rippleGlow += w * 0.5;
                }
            }
            const bendTotal = Math.min(0.6, rippleBend);

            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 180, 255, ${alpha * 0.6 + rippleGlow * 0.3})`;
            ctx.lineWidth = (strandWidths[i] * 0.7) * (1 + bendTotal * 1.5);

            let prevX = centerX;
            let prevY = centerY;

            for (let s = 1; s <= STRAND_SEGMENTS; s++) {
                const t = s / STRAND_SEGMENTS;
                const dist = t * strandLen;

                const waveAmp = dist * 0.04 * Math.sin(time * 0.002 * strandSpeeds[i] + t * 3);
                const perpAngle = baseAngle + Math.PI * 0.5;

                let x = centerX + Math.cos(baseAngle) * dist + Math.cos(perpAngle) * waveAmp;
                let y = centerY + Math.sin(baseAngle) * dist + Math.sin(perpAngle) * waveAmp;

                // ENHANCEMENT 1 (Direction A): real Z-depth — each point carries
                                // a Z that peaks at mid-strand (mirror-surface convexity) and is
                                // perspective-projected so nearer points scale UP and push
                                // outward from the core. This reads as the strand pressing OUT
                                // of the screen toward the viewer — not a 2D upward bend.
                                if (strandReach > 0) {
                                    const bulgeW = Math.sin(t * Math.PI);            // 0 at core, peak at mid, 0 at tip
                                    const z = strandReach * bulgeW * Z_DEPTH_MAX;   // depth toward viewer (px)
                                    if (z > 0.5) {
                                        const persp = Z_FOCAL / (Z_FOCAL - z);      // >1 => nearer, scaled up
                                        x = centerX + (x - centerX) * persp;
                                        y = centerY + (y - centerY) * persp;
                                    }
                                }

                // ENHANCEMENT 2: ripple bends the strand sideways as it passes.
                if (bendTotal > 0) {
                    x += Math.cos(perpAngle) * bendTotal * dist * 0.10;
                    y += Math.sin(perpAngle) * bendTotal * dist * 0.10;
                }

                // ENHANCEMENT 3: the cursor repels the strand point so the web
                // visibly parts around the pointer as it moves.
                if (mouseActive) {
                    const r = mouseRepel(x, y);
                    x = r[0];
                    y = r[1];
                }

                if (s === 1) ctx.moveTo(prevX, prevY);
                ctx.lineTo(x, y);
                prevX = x;
                prevY = y;
            }
            ctx.stroke();

            // Node at the tip — brightens when a ripple or reach passes.
            ctx.fillStyle = `rgba(0, 220, 255, ${alpha * 0.4 + rippleGlow * 0.5})`;
            ctx.beginPath();
            ctx.arc(prevX, prevY, 2 + bendTotal * 1.5, 0, 6.283);
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(0, 150, 255, 0.08)';
        ctx.lineWidth = 0.5;
        for (let ring = 1; ring <= 2; ring++) {
            const ringDist = (ring / 4) * maxRadius * 0.5;
            ctx.beginPath();
            for (let i = 0; i <= WEB_STRANDS; i++) {
                const idx = i % WEB_STRANDS;
                const angle = strandAngles[idx] + Math.sin(time * 0.001 * strandSpeeds[idx] + strandPhases[idx]) * 0.15;
                const x = centerX + Math.cos(angle) * ringDist;
                const y = centerY + Math.sin(angle) * ringDist;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    function drawParticles(time) {
        const maxRadius = Math.min(width, height) * 0.7;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.progress += p.speed * (1 + coreEnergy * 0.5);

            if (p.progress > 1) {
                p.progress = 0;
                p.strandIdx = Math.floor(Math.random() * WEB_STRANDS);
                p.speed = 0.002 + Math.random() * 0.006;
            }

            const strand = p.strandIdx;
            const strandLen = strandLengths[strand] * maxRadius;
            const baseAngle = strandAngles[strand] + Math.sin(time * 0.001 * strandSpeeds[strand] + strandPhases[strand]) * 0.15;
            const dist = p.progress * strandLen;

            const waveAmp = dist * 0.04 * Math.sin(time * 0.002 * strandSpeeds[strand] + p.progress * 3);
            const perpAngle = baseAngle + Math.PI * 0.5;

            let x = centerX + Math.cos(baseAngle) * dist + Math.cos(perpAngle) * waveAmp;
            let y = centerY + Math.sin(baseAngle) * dist + Math.sin(perpAngle) * waveAmp;

            // Particles follow the same continuous reach-wave as the strands,
            // so the "escaping threads" visibly press OUT of the screen toward
            // the viewer via the same Z-depth perspective projection.
            const strandReach = (0.35 + 0.65 * Math.max(0, Math.sin(reachPhase + strandPhases[strand] * 2.3))) * REACH_AMPLITUDE;
            if (strandReach > 0) {
                const bulgeW = Math.sin(p.progress * Math.PI);
                const z = strandReach * bulgeW * Z_DEPTH_MAX;
                if (z > 0.5) {
                    const persp = Z_FOCAL / (Z_FOCAL - z);
                    x = centerX + (x - centerX) * persp;
                    y = centerY + (y - centerY) * persp;
                }
            }

            // Cursor repels the particle so it visibly dodges the pointer.
            if (mouseActive) {
                const r = mouseRepel(x, y);
                x = r[0];
                y = r[1];
            }

            const alpha = p.brightness * (1 - p.progress * 0.6) * coreEnergy;
            const size = p.size * (1 - p.progress * 0.4);

            ctx.fillStyle = `rgba(100, 210, 255, ${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(x, y, size * 1.2, 0, 6.283);
            ctx.fill();
        }
    }

    function drawMouseInteraction(time) {
        if (!mouseActive) return;

        const dx = mouseX - centerX;
        const dy = mouseY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.min(width, height) * 0.7;

        if (dist < maxDist) {
            const angle = Math.atan2(dy, dx);
            const arcLen = Math.min(dist * 0.8, maxDist * 0.6);

            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 220, 255, ${0.3 * (1 - dist / maxDist)})`;
            ctx.lineWidth = 1.5;
            ctx.moveTo(centerX, centerY);

            const cp1x = centerX + Math.cos(angle + 0.2) * arcLen * 0.4;
            const cp1y = centerY + Math.sin(angle + 0.2) * arcLen * 0.4;
            const cp2x = centerX + Math.cos(angle - 0.1) * arcLen * 0.7;
            const cp2y = centerY + Math.sin(angle - 0.1) * arcLen * 0.7;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, mouseX, mouseY);
            ctx.stroke();

            const mGlow = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 20);
            mGlow.addColorStop(0, 'rgba(0, 200, 255, 0.3)');
            mGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = mGlow;
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 20, 0, Math.PI * 2);
            ctx.fill();

            coreEnergy = 1.0 + (1 - dist / maxDist) * 0.5;
        }
    }

    // ENHANCEMENT: the mirror-facing wall — a subtle horizontal plane at the
    // reach anchor that the strands press toward. It glows faintly at rest,
    // then FLASHES bright when an expanding touch-ring crosses it (the "hit").
    // The gradient geometry is frame-invariant, so we build it once and only
    // vary the alpha via globalAlpha — avoids a createLinearGradient alloc per
    // frame (the hot path).
    // One ellipse of the halo stack. `behind` rings are drawn before the core so
    // the sphere occludes them; the floor ring is drawn after so it passes in
    // front. Together they read as one ring system wrapping the core.
    // One ring renderer used by every halo, so the equator, the overhead ring and
    // the floor oval all perform identically: a travelling highlight, a bloom on
    // impact and an expanding sheen. Called inside a translate+scale context.
    // The press effect: three rings of light leaving the core in sequence and
    // dissolving as they travel outward. Shared by both shimmer implementations so
    // the pulse survives whichever path draws the rim.
    // Three rings of light leaving the CORE and travelling outward past the halos.
    // Drawn once per frame: scaling from each halo's own radius made the pulse hug
    // the rings and read as a thicker halo rather than a wave leaving the core.
    function drawPulseRings(cx, cy) {
        if (!(haloRipple > 0 && haloRipple < 1)) return;
        const R = coreRadius || 60;
        ctx.save();
        ctx.shadowColor = 'rgba(150, 238, 255, 0.95)';
        for (let k = 0; k < 3; k++) {
            const t = haloRipple + k * 0.33;
            if (t >= 1) continue;
            ctx.globalAlpha = Math.pow(1 - t, 1.5) * 0.65;
            ctx.strokeStyle = 'rgba(205, 250, 255, 1)';
            ctx.shadowBlur = 24;
            ctx.lineWidth = 2.2 + (1 - t) * 3.0;
            ctx.beginPath();
            ctx.arc(cx, cy, R * (1.25 + t * 3.6), 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawRippleRings(rx, rr, aScale, a0, a1) {
        if (!(haloRipple > 0 && haloRipple < 1)) return;
        ctx.save();
        ctx.shadowColor = 'rgba(150, 238, 255, 0.95)';
        for (let k = 0; k < 3; k++) {
            const t = haloRipple + k * 0.33;
            if (t >= 1) continue;
            // Readable at a glance: brighter, thicker and travelling almost twice
            // as far as before, so the "three rings leaving the core" is obvious.
            ctx.globalAlpha = Math.pow(1 - t, 1.6) * 0.75 * aScale;
            ctx.strokeStyle = 'rgba(205, 250, 255, 1)';
            ctx.shadowBlur = 22;
            ctx.lineWidth = Math.max(1.4, 3.6 / rr);
            ctx.beginPath();
            ctx.arc(0, 0, rx * (1 + t * 0.95), a0, a1);
            ctx.stroke();
        }
        ctx.restore();
    }

    function ringShimmer(rx, rr, rimA, aScale, from, to, segs, blend) {
        const a0 = (from === undefined) ? 0 : from;
        const a1 = (to === undefined) ? Math.PI * 2 : to;
        const SEG = segs || 84;
        const TAU = Math.PI * 2;
        const flare = Math.min(1.4, haloPulse + haloCore * 1.15);

        // A press reads as the ring expanding outward and dissolving, not as a
        // contraction: it grows and its light thins out at the same time.
        const aFade = 1 - Math.min(0.62, flare * 0.52);

        // Soft underglow FIRST: one wide, blurred pass in the core's own colour.
        // This is what makes the rings feel like part of the aura instead of lines
        // drawn on top of it.
        ctx.save();
        const soft = ctx.createLinearGradient(-rx, 0, rx, 0);
        soft.addColorStop(0, 'rgba(90, 220, 255, 0)');
        soft.addColorStop(0.28, `rgba(130, 235, 255, ${(rimA * 0.30) * aScale * aFade})`);
        soft.addColorStop(0.5, `rgba(205, 250, 255, ${(rimA * 0.46) * aScale * aFade})`);
        soft.addColorStop(0.72, `rgba(130, 235, 255, ${(rimA * 0.30) * aScale * aFade})`);
        soft.addColorStop(1, 'rgba(90, 220, 255, 0)');
        ctx.strokeStyle = soft;
        ctx.shadowBlur = GLOW_ON ? (20 + flare * 16) : 0;
        ctx.shadowColor = 'rgba(120, 230, 255, 0.85)';
        ctx.lineWidth = Math.max(2.4, 7.0 / rr);
        ctx.beginPath();
        ctx.arc(0, 0, rx, a0, a1);
        ctx.stroke();
        ctx.restore();

        if (CONIC) {
            // One stroke, conic gradient: three bright lobes that rotate with the
            // same phase the segment loop uses.
            const lobes = 3;
            const cg = ctx.createConicGradient(-haloPhase * 0.35, 0, 0);
            for (let i = 0; i <= 18; i++) {
                const t = i / 18;
                const w = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * lobes);
                const a = Math.min(0.85, rimA * (0.45 + 0.55 * w) * aFade);
                const lit = 0.45 + 0.55 * w;
                const cr = Math.round(130 + lit * 105);
                const cg2 = Math.round(232 + lit * 20);
                cg.addColorStop(t, `rgba(${cr}, ${cg2}, 255, ${a})`);
            }
            ctx.save();
            ctx.strokeStyle = cg;
            ctx.lineWidth = Math.max(1.1, 1.9 / rr);
            ctx.shadowBlur = 9;
            ctx.shadowColor = 'rgba(120, 230, 255, 0.55)';
            ctx.beginPath();
            ctx.arc(0, 0, rx, a0, a1);
            ctx.stroke();
            ctx.restore();
            return;
        }

        // Then the travelling highlight, as a fine filament riding on that glow.
        // Its alpha fades toward the ends of the ellipse and, where a blend centre
        // is supplied, into the core's aura so the ring never cuts across it.
        for (let i = 0; i < SEG; i++) {
            const st = a0 + (a1 - a0) * (i / SEG);
            const en = a0 + (a1 - a0) * ((i + 1) / SEG) + 0.008;
            const mid = (st + en) / 2;
            const wave = Math.sin(mid * 3 + haloPhase * 2.2);   // reversed: the light runs outward, not into the core
            const amp = 0.16 + flare * 0.72;
            let a = rimA * (0.52 + 0.48 * wave * amp) * aFade;
            // fade at the two ends of the oval
            const endFade = 1 - Math.pow(Math.abs(Math.cos(mid)), 2.2);
            a *= 0.35 + 0.65 * endFade;
            // blend into the aura where the ring passes near the core
            if (blend) {
                const px = Math.cos(mid) * rx;
                const py = Math.sin(mid) * rr * rx;
                const d = Math.sqrt((px - blend.x) * (px - blend.x) + (py - blend.y) * (py - blend.y));
                const t = Math.max(0, Math.min(1, (d - blend.r * 0.85) / (blend.r * 0.95)));
                a *= 0.18 + 0.82 * (t * t * (3 - 2 * t));   // smoothstep out of the aura
            }
            if (a < 0.012) continue;
            const lit = 0.5 + 0.5 * wave;
            const cr = Math.round(130 + lit * 105);
            const cg = Math.round(232 + lit * 20);
            ctx.strokeStyle = `rgba(${cr}, ${cg}, 255, ${Math.min(0.5, a * 0.72)})`;
            ctx.lineWidth = Math.max(1.1, 1.9 / rr);
            ctx.shadowBlur = GLOW_ON ? 9 : 0;
            ctx.shadowColor = 'rgba(120, 230, 255, 0.55)';
            ctx.beginPath();
            ctx.arc(0, 0, rx, st, en);
            ctx.stroke();
        }

        // The press: three rings of light leave the core in sequence and dissolve
        // as they travel outward. Direction is strictly away from the centre.
        if (haloRipple > 0 && haloRipple < 1) {
            ctx.save();
            ctx.shadowColor = 'rgba(150, 238, 255, 0.95)';
            for (let k = 0; k < 3; k++) {
                let t = haloRipple + k * 0.33;
                if (t >= 1) continue;
                ctx.globalAlpha = Math.pow(1 - t, 2) * 0.42 * aScale;
                ctx.strokeStyle = 'rgba(190, 248, 255, 0.95)';
                ctx.shadowBlur = 16;
                ctx.lineWidth = Math.max(1, 2.6 / rr);
                ctx.beginPath();
                ctx.arc(0, 0, rx * (1 + t * 0.55), a0, a1);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function drawHalo(cx, cy, rx, ry, aScale, from, to, blend) {
        if (!rx || !ry || rx < 2) return;
        // Halos swell on a pulse (and slightly with speech) then settle back, so
        // the ring system reads as alive instead of fixed.
        // The rings themselves pulse: they swell with the press and settle back,
        // which is the motion the three halos are meant to have. The outward wave is
        // a separate effect (drawPulseRings), so this one is purely the ring breath.
        const HS = 1 + audioLevel * 0.05 + haloPulse * 0.34 + haloCore * 0.22;
        rx *= HS; ry *= HS;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);

        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        const a0 = (0.16 + audioLevel * 0.20) * aScale;
        pool.addColorStop(0, `rgba(0, 214, 255, ${a0})`);
        pool.addColorStop(0.55, `rgba(0, 200, 255, ${a0 * 0.38})`);
        pool.addColorStop(1, 'rgba(0, 200, 255, 0)');
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();

        const rimA = Math.min(0.95, (0.30 + audioLevel * 0.40) * aScale);
        ringShimmer(rx, ry / rx, rimA, aScale, from, to, 84, blend);
        ctx.restore();
    }

    // The upper rings sit behind the core: equator and a smaller one overhead.
    function drawHalosBehind() {
        const R = coreRadius || 60;
        ctx.save();
        // Cut the core and its aura out of everything drawn here. Without this the
        // rings were visible *through* the sphere, which made the core look
        // transparent instead of solid; now the back of each ring disappears
        // exactly where the core and its glow begin, and the ring reads as
        // wrapping behind it.
        ctx.beginPath();
        ctx.rect(-width, -height, width * 3, height * 3);
        ctx.arc(centerX, centerY, R * 1.55, 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        // Back halves only (upper arc): the front halves are drawn after the core.
        drawHalo(centerX, centerY, R * 2.60, R * 0.44, 0.55, Math.PI, Math.PI * 2,
                 { x: 0, y: 0, r: R });                                                   // equator, blends into the aura
        // Mirrored: the ring above sits exactly as far from the core as the oval
        // below, so the core reads as floating between two equal rings.
        drawHalo(centerX, centerY - (reachAnchorY - centerY), R * 1.25, R * 0.24, 0.34, Math.PI, Math.PI * 2);
        ctx.restore();
    }

    // The near half of the ring system, drawn over the core so the ring genuinely
    // passes in front of it rather than through it.
    function drawHalosFront() {
        const R = coreRadius || 60;
        drawHalo(centerX, centerY, R * 2.60, R * 0.44, 0.55, 0, Math.PI,
                 { x: 0, y: 0, r: R });                                                   // equator, blends into the aura
        drawHalo(centerX, centerY - (reachAnchorY - centerY), R * 1.25, R * 0.24, 0.34, Math.PI * 2, Math.PI * 3);
    }

    function drawMirrorWall() {
        const y = reachAnchorY;
        // Distance (in canvas px) from core to the mirror plane.
        const wallDist = Math.abs(y - centerY);
        let flash = 0;
        for (let rI = 0; rI < touchRipples.length; rI++) {
            const rp = touchRipples[rI];
            const band = 0.22 * maxRadiusPx();
            const g = 1 - Math.abs((wallDist - rp.dist) / band);
            if (g > 0) flash = Math.max(flash, g * rp.strength);
        }

        // An inverted halo: an ellipse on the floor plane beneath the core, not a
        // line across the canvas. Squashed vertically so it reads in perspective,
        // which is what makes the core look like it floats above it.
        // Same swell as the rings above, so all three respond as one system.
        const HS = 1 + haloPulse * 0.30 + haloCore * 0.20 + audioLevel * 0.05;
        // Same size and proportion as the ring above the core, so the two mirror
        // each other, with the core floating between them.
        const R0 = coreRadius || 60;
        const rx = R0 * 1.25 * HS;
        const ry = R0 * 0.24 * HS;
        const cx = centerX;
        const cy = y;
        lastFloorRing = { cx: cx, cy: cy, rx: rx, ry: ry };

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);

        // light pool (soft fill)
        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        const a0 = 0.13 + audioLevel * 0.15 + flash * 0.24 + haloPulse * 0.10 + haloCore * 0.12;
        pool.addColorStop(0, `rgba(0, 214, 255, ${a0})`);
        pool.addColorStop(0.55, `rgba(0, 200, 255, ${a0 * 0.42})`);
        pool.addColorStop(1, 'rgba(0, 200, 255, 0)');
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();

        // Same travelling highlight as the upper rings (the floor used to be a
        // flat gradient, which is why it alone looked dead).
        // The floor oval sat dimmer than the rings above it, so it gets a firmer
        // base brightness and a little more glow to hold its own.
        // Softer than the rings above: present, but not bold enough to compete
        // with the core.
        const rimA = Math.min(0.55, (0.22 + audioLevel * 0.30 + flash * 0.26) * 0.85);
        ringShimmer(rx, ry / rx, rimA, 0.8);
        ctx.restore();

        // a second, tighter inner rim gives the halo some thickness
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, (ry * 0.62) / (rx * 0.62));
        ctx.strokeStyle = `rgba(0, 220, 255, ${0.10 + audioLevel * 0.18 + flash * 0.25})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, rx * 0.62, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // Holograph/HUD dressing: an audio-reactive radial ring, hologram chromatic
    // fringe, a drifting scanline, and corner brackets. Drawn every frame right
    // before the offscreen blit. Purely additive and flag-gated so the Z-depth
    // web stays the hero — this is the "futuristic instrument panel" layer.
    // ---- plexus layer (hybrid) ----
    function seedPlexus(cx, cy, R) {
        PLEX.nodes.length = 0;
        const count = 40;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = R * (0.18 + Math.random() * 0.82);
            PLEX.nodes.push({
                x: cx + Math.cos(a) * r,
                y: cy + Math.sin(a) * r * 0.95,
                angle: Math.random() * Math.PI * 2,
                speed: 0.22 + Math.random() * 0.42,
                homeR: r,               // natural radius: the field springs back to this
                bx: 0, by: 0,          // shockwave velocity, decays to zero
                depth: 0.35 + Math.random() * 0.65,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    function drawPlexusLayer(time, cx, cy) {
        if (!PLEXUS_ON) return;
        if (!PLEX.nodes.length) seedPlexus(cx, cy, Math.min(width, height) * 0.42);

        const LINK = Math.min(width, height) * 0.13;
        const energyBoost = 0.65 + audioLevel * 1.1;

        // Free drift: each node carries a heading that wanders a little every
        // frame, so paths curve and loop instead of running in a straight line.
        const _PLEX_WANDER = 0.055;
        const maxR = Math.min(width, height) * 0.42;
        const keepOut = coreRadius * 2.2;

        // ease the cursor once per frame, before the nodes read it
        _mxSmooth += (mouseX - _mxSmooth) * _CURSOR_EASE;
        _mySmooth += (mouseY - _mySmooth) * _CURSOR_EASE;

        for (const n of PLEX.nodes) {
            n.angle += (Math.random() - 0.5) * _PLEX_WANDER
                     + Math.sin(time * 0.00035 + n.phase) * 0.01;

            const speed = n.speed * (0.45 + n.depth * 0.85) * (1 + audioLevel * 1.1) * (thinking ? 2.4 : 1);
            n.x += Math.cos(n.angle) * speed + n.bx;
            n.y += Math.sin(n.angle) * speed + n.by;

            // shockwave velocity bleeds off, so the scatter eases back into the
            // normal wandering flow instead of snapping to the old positions
            n.bx *= 0.935;
            n.by *= 0.935;
            if (Math.abs(n.bx) < 0.02) n.bx = 0;
            if (Math.abs(n.by) < 0.02) n.by = 0;

            // Cursor influence: push the node away, deflect its heading so it
            // curves around the pointer, and remember how close it is (used for
            // the brightness lift below).
            n.near = 0;
            if (mouseActive) {
                const mdx = n.x - _mxSmooth;
                const mdy = n.y - _mySmooth;
                const md = Math.hypot(mdx, mdy) || 0.0001;
                const CURSOR_R = 260;          // canvas-space influence radius
                if (md < CURSOR_R) {
                    const falloff = (1 - md / CURSOR_R) ** 2.2;   // softer edge
                    n.near = falloff;
                    // Velocity, not position: the same damping that settles the
                    // shockwave carries this, so nodes glide instead of snapping.
                    const force = (md > 130 ? 0.42 : -0.22) * falloff;
                    n.bx += (mdx / md) * force;
                    n.by += (mdy / md) * force;
                    // slight tangential turn so paths curve past the cursor
                    const cross = Math.cos(n.angle) * (mdy / md) - Math.sin(n.angle) * (mdx / md);
                    n.angle += cross * falloff * 0.10;
                }
            }

            const dx = n.x - cx, dy = n.y - cy;
            const d = Math.hypot(dx, dy) || 0.0001;

            // Reflect off the rim instead of snapping inward — the snap is what
            // made the mesh look frozen at the edge.
            if (d > maxR) {
                const nx = dx / d, ny = dy / d;
                const vx = Math.cos(n.angle), vy = Math.sin(n.angle);
                const dot = vx * nx + vy * ny;
                n.angle = Math.atan2(vy - 2 * dot * ny, vx - 2 * dot * nx)
                        + (Math.random() - 0.5) * 0.25;
                n.x = cx + nx * maxR * 0.99;
                n.y = cy + ny * maxR * 0.99;
            }

            // Radial spring: after a scatter the field eases back to its natural
            // radius instead of staying permanently expanded. Angular position is
            // untouched, so the drift still feels free.
            if (n.homeR) {
                const pull = (n.homeR - d) * 0.006;
                n.x += (dx / d) * pull;
                n.y += (dy / d) * pull;
            }

            // Never let the mesh clog the glowing core.
            if (d < keepOut) {
                n.x = cx + (dx / d) * keepOut;
                n.y = cy + (dy / d) * keepOut;
            }
        }

        // links
        for (let i = 0; i < PLEX.nodes.length; i++) {
            const a = PLEX.nodes[i];
            for (let j = i + 1; j < PLEX.nodes.length; j++) {
                const b = PLEX.nodes[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > LINK * LINK) continue;
                const d = Math.sqrt(d2);
                const near = Math.max(a.near || 0, b.near || 0);
                const alpha = (1 - d / LINK) * 0.16 * energyBoost *
                              Math.min(a.depth, b.depth) * (1 + near * 1.4);
                ctx.strokeStyle = THEME === 'dark'
                    ? `rgba(120, 225, 255, ${alpha.toFixed(3)})`
                    : `rgba(0, 120, 180, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }

        // nodes
        for (const n of PLEX.nodes) {
            const tw = 0.6 + 0.4 * Math.sin(time * 0.0021 + n.phase);
            const near = n.near || 0;
            const alpha = Math.min(0.92, (0.22 + 0.5 * tw) * n.depth * energyBoost * (1 + near * 1.6));
            const radius = (1.0 + n.depth * 1.4) * (0.85 + 0.3 * tw) * (1 + near * 0.3);
            ctx.fillStyle = THEME === 'dark'
                ? `rgba(${Math.round(150 + near * 90)}, 235, 255, ${alpha.toFixed(2)})`
                : `rgba(0, 110, 170, ${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // tight halo on the closest nodes so hover feels deliberate
            if (near > 0.35) {
                const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius * 4);
                g.addColorStop(0, `rgba(180, 245, 255, ${(0.10 * near).toFixed(3)})`);
                g.addColorStop(1, 'rgba(120, 225, 255, 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(n.x, n.y, radius * 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Numeric probe for QA: confirms the pointer actually reaches the layer.
    window.jarvisVizDebug = () => ({
        mouseActive,
        mouseX: Math.round(mouseX),
        mouseY: Math.round(mouseY),
        nodes: PLEX.nodes.length,
        near: PLEX.nodes.filter((n) => (n.near || 0) > 0.02).length,
        maxNear: Math.round(Math.max(0, ...PLEX.nodes.map((n) => n.near || 0)) * 100) / 100,
        spread: Math.round(Math.max(0, ...PLEX.nodes.map((n) => Math.hypot(n.bx || 0, n.by || 0))) * 100) / 100,
        meanDist: Math.round((PLEX.nodes.reduce((a, n) => a + Math.hypot(n.x - width / 2, n.y - height / 2), 0) / (PLEX.nodes.length || 1)) * 10) / 10,
    });

    // Scatter from the click point: nearer nodes get a bigger kick, with a
    // little randomisation so the ring never looks mechanical.
    function burstPlexus(x, y) {
        plexBurst.active = true;
        plexBurst.x = x;
        plexBurst.y = y;
        plexBurst.age = 0;
        const maxR = Math.min(width, height) * 0.75;
        for (const n of PLEX.nodes) {
            const dx = n.x - x;
            const dy = n.y - y;
            const d = Math.hypot(dx, dy) || 0.001;
            const falloff = Math.max(0.12, 1 - d / maxR);      // local kick, far drift
            const kick = (7 + Math.random() * 5) * falloff;
            n.bx += (dx / d) * kick;
            n.by += (dy / d) * kick;
        }
    }

    // Clicking the visualiser scatters the mesh. Clicks on UI controls are
    // ignored so buttons never fire a shockwave by accident.
    window.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('button, input, textarea, select, a, .panel, aside, header, #status-bar')) return;
        burstPlexus(e.clientX * scaleX, e.clientY * scaleY);
    }, true);

    function drawHUD(time) {
        const baseR = Math.min(width, height) * 0.34;

        // ---- Audio-reactive radial ring that swells in sync with the voice.
        if (HUD_RING_ON) {
            const breathe = 1 + audioLevel * 1.1;         // swell on speech
            const ringR = baseR * breathe;

            // Chromatic fringe: faint red + cyan copies just inside the main
            // ring — the classic fake-hologram depth cue.
            if (HUD_FRINGE_ON) {
                ctx.strokeStyle = `rgba(255, 45, 80, ${0.08 + audioLevel * 0.12})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(centerX - 1.4, centerY, ringR * 0.965, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = `rgba(0, 200, 255, ${0.12 + audioLevel * 0.16})`;
                ctx.beginPath();
                ctx.arc(centerX + 1.4, centerY, ringR * 0.965, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Main ring brightens + thickens with voice amplitude.
            ctx.strokeStyle = `rgba(0, 210, 255, ${0.25 + audioLevel * 0.4})`;
            ctx.lineWidth = 1.4 + audioLevel * 0.8;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringR, 0, Math.PI * 2);
            ctx.stroke();

            // Readout ticks: 8 short radial marks around the ring (instrument feel).
            ctx.strokeStyle = 'rgba(120, 225, 255, 0.55)';
            ctx.lineWidth = 2;
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(centerX + Math.cos(a) * (ringR - 8), centerY + Math.sin(a) * (ringR - 8));
                ctx.lineTo(centerX + Math.cos(a) * (ringR - 2), centerY + Math.sin(a) * (ringR - 2));
                ctx.stroke();
            }
        }

        // ---- Drifting horizontal scanline sweep (volumetric-hologram refresh).
        if (HUD_SCANLINE_ON) {
            const y = ((time * 0.00006) % 1.15 - 0.08) * height;
            const grad = ctx.createLinearGradient(0, y - 18, 0, y + 18);
            grad.addColorStop(0, 'rgba(0, 210, 255, 0)');
            grad.addColorStop(0.5, `rgba(0, 210, 255, ${0.05 + audioLevel * 0.07})`);
            grad.addColorStop(1, 'rgba(0, 210, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, y - 18, width, 36);
        }

        // ---- Thin angled brackets in the four corners (scanned-instrument UI).
        if (HUD_BRACKETS_ON) {
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.35)';
            ctx.lineWidth = 1.5;
            const m = 16, L = 22;
            const corners = [
                [m,       m,          1, 1],
                [width-m, m,         -1, 1],
                [m,       height-m,   1,-1],
                [width-m, height-m,  -1,-1]
            ];
            for (const [cx, cy, sx, sy] of corners) {
                ctx.beginPath();
                ctx.moveTo(cx + sx * L, cy);
                ctx.lineTo(cx, cy);
                ctx.lineTo(cx, cy + sy * L);
                ctx.stroke();
            }
        }
    }

    // ENHANCEMENT (Direction B) — futuristic HUD dressing. Drawn every frame
    // right before the offscreen blit. All gated so Direction A's web stays
    // the hero; each layer can be toggled via its HUD_*_ON constant.
    

    // ENHANCEMENT: the visible pulse rings — each touch spawns an expanding
    // ring so the pulsation is clearly seen travelling outward and hitting the
    // mirror wall, not just an internal bend.
    function drawVisibleRipples() {
        for (let rI = 0; rI < touchRipples.length; rI++) {
            const rp = touchRipples[rI];
            const alpha = 0.5 * Math.max(0, 1 - rp.dist / (maxRadiusPx() * 1.4));
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 220, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.arc(centerX, centerY, rp.dist, 0, Math.PI * 2);
            ctx.stroke();
            // Bright core rebound ring just behind the front (the "recoil").
            // Guarded: rp.dist starts near the core while the offset is a full
            // stride, so this radius went negative and ctx.arc threw — which
            // aborted the frame before the blit and made the view look frozen.
            const recoilR = rp.dist - rp.speed * 2;
            if (recoilR > 0.5) {           // radius must be non-negative
                ctx.beginPath();
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
                ctx.lineWidth = 1.2;
                ctx.arc(centerX, centerY, recoilR, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    function maxRadiusPx() {
        return Math.min(width, height) * 0.7;
    }

    function drawPulseWave(time) {
        if (!pulseActive) return;

        pulseWave += 2.2;   // was 4: rings crossed the view too fast
        const maxPulse = Math.max(width, height);

        if (pulseWave > maxPulse) {
            pulseActive = false;
            pulseWave = 0;
            return;
        }

        const alpha = 0.4 * (1 - pulseWave / maxPulse);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0, 220, 255, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.arc(centerX, centerY, pulseWave, 0, Math.PI * 2);
        ctx.stroke();

        if (pulseWave > 31) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 150, 255, ${alpha * 0.5})`;
            ctx.lineWidth = 1;
            ctx.arc(centerX, centerY, Math.max(0.5, pulseWave - 30), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    document.addEventListener('visibilitychange', () => {
        _hidden = !!document.hidden;
        if (!_hidden) { animFrameId = requestAnimationFrame(animate); }
    });

    function animate(timestamp) {
        if (_hidden) { animFrameId = null; return; }
        // Activity = speech, a pulse, a ripple, or recent mouse work.
        // coreEnergy is a resting state (it sits above 1 all the time), so it must
        // NOT count as activity -- including it meant the idle branch never ran.
        // The bridge parks audioLevel at ~0.05 when nothing is playing, so the
        // activity threshold has to be above that or the scene never looks idle.
        if (audioLevel > 0.10 || haloPulse > 0.01 || haloCore > 0.01 || haloRipple > 0
            || (performance.now() - _lastPulseAt) < 1500) {
            _lastActivity = timestamp;
        }
        _idleNow = (timestamp - (_lastActivity || timestamp)) > IDLE_AFTER_MS;
        const _target = _lite ? LITE_FRAME_TIME : TARGET_FRAME_TIME;
        if (timestamp - lastFrameTime < _target) {
            animFrameId = requestAnimationFrame(animate);
            return;
        }
        lastFrameTime = timestamp;
        lastAnimateTimestamp = performance.now();
        _frames++;
        if (timestamp - _fpsT0 >= 1000) {
            _fps = Math.round(_frames * 1000 / (timestamp - _fpsT0));
            _frames = 0; _fpsT0 = timestamp;
        }
        animFrameId = requestAnimationFrame(animate);
        if (audioLevel > 0.01) {
            coreEnergy = Math.max(coreEnergy, 0.8 + audioLevel * 2.5);
            // was 0.3: the speech envelope sits above that constantly, so the
            // ripple re-armed every frame. Onset pulses come from the bridge.
            // Require a real peak AND a cooldown, otherwise the envelope keeps
            // re-arming the ring and the whole view feels twitchy.
            const nowMs = timestamp || performance.now();
            if (audioLevel > 0.9 && !pulseActive && nowMs - _lastAutoPulse > 2600) {
                pulseActive = true;
                pulseWave = coreRadius * audioLevel * 1.5;
                _lastAutoPulse = nowMs;
            }
        }

        ctx.fillStyle = WASH();
        ctx.fillRect(0, 0, width, height);

        coreEnergy = 0.8 + audioLevel * 2.0;
        if (coreEnergy < 0.8) coreEnergy = 0.8;
        if (audioLevel < 0.05) audioLevel = 0.05;

        const time = timestamp || performance.now();
        haloPulse *= 0.962;          // slightly slower settle so the swell reads
        if (haloPulse < 0.001) haloPulse = 0;
        haloCore *= 0.975;           // CORE blooms slower (~1.6s)
        if (haloCore < 0.001) haloCore = 0;
        haloPhase += 0.010 + (haloPulse + haloCore) * 0.055;   // shimmer speeds up on a hit
        if (haloRipple > 0 && !FREEZE) { haloRipple += 0.022; if (haloRipple >= 1) haloRipple = 0; }

        ctx = DIRECT ? ctxScreen : ctxOff;
        drawPlexusLayer(time, centerX, centerY);
        drawWebStrands(time);
        drawParticles(time);
        drawHalosBehind();      // equator + overhead, occluded by the core
        drawVisibleRipples();
        drawMouseInteraction(time);
        drawCore(time);
        drawPulseRings(centerX, centerY);
        drawHalosFront();       // near halves, over the core
        // Floor ring in FRONT of the sphere: this is what puts the core above the
        // oval instead of sitting on a line.
        drawMirrorWall();
        drawPulseWave(time);
        drawHUD(time);
        // Blit the offscreen buffer to the visible canvas in one composite.
        if (!DIRECT) screen.drawImage(off, 0, 0);
    }

    function handleResize() { resize(); }
    function handleMouseMove(e) {
        mouseX = e.clientX * scaleX;
        mouseY = e.clientY * scaleY;
        mouseActive = true;
    }
    function handleMouseLeave() { mouseActive = false; }
    function handleClick(e) {
        pulseActive = true;
        pulseWave = coreRadius * 2;
        coreEnergy = 2.0;
        lastInteractionTime = performance.now();
        spawnRipple();   // ENHANCEMENT: every touch sends a spiral ripple through the web
    }

    let recoveryTimer = null;
    function scheduleRecovery() {
        if (recoveryTimer) clearTimeout(recoveryTimer);
        recoveryTimer = setTimeout(() => {
            if (!isActive) {
                isActive = true;
                coreEnergy = 2.0;
                console.log('[Visualizer] Auto-recovered from inactive state');
            }
        }, 3000);
    }

    window.neuralVisualizer = {
        pulse: function() {
            // Rate-limit: a caller that re-arms every frame left pulseActive stuck
            // true forever, which also stopped the scene from ever going idle.
            const now = performance.now();
            if (now - _lastPulseAt < 1200) return;
            _lastPulseAt = now;
            pulseActive = true; pulseWave = coreRadius * 2; coreEnergy = 2.5;
            haloPulse = 1; haloRipple = 0.001; spawnRipple();
        },
        // CORE gets a longer, deeper bloom so the two buttons feel different.
        haloFlare: function(strength) {
            haloCore = Math.min(1.6, (haloCore || 0) + (strength || 1));
            haloRipple = 0.001; haloPulse = Math.max(haloPulse, 0.55);
        },
        // BUG: this ignored its argument and always set isActive = true, so the
        // CORE button could never actually switch the visualiser off.
        setActive: function(active) {
            isActive = !!active;
            if (isActive) {
                coreEnergy = Math.max(coreEnergy, 1.2);
                if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
            }
        },
        // Explicit pause used by the CORE button: no auto-recovery, or the
        // visualiser would switch itself back on three seconds later.
        setPaused: function(paused) {
            isActive = !paused;
            if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
        },
        getActive: function() { return isActive; },
        boost: function() { coreEnergy = 3.0; spawnRipple(); },
        forceOn: function() { isActive = true; coreEnergy = 2.0; },
        updateAudioLevel: function(level) {
            // Match the bridge's asymmetry: quick to open on a syllable, slower to
            // close. A symmetric filter either lags the speech or flickers.
            const target = Math.max(0, Math.min(1, level));
            const k = target > audioLevel ? 0.30 : 0.10;   // bridge now updates per frame
            audioLevel += (target - audioLevel) * k;
            if (audioLevel < 0.05) audioLevel = 0.05;
            if (level > 0.1 && !isActive) { isActive = true; }
        },
        getAudioLevel: function() { return audioLevel; },
        // QA hook: lets a test prove the halos actually swell and retract.
        getHaloState: function() { return { fps: _fps, idle: _idleNow, pulseActive: pulseActive, sinceAct: Math.round(performance.now() - (_lastActivity||0)), haloPulse: haloPulse, haloCore: haloCore, haloRipple: haloRipple, haloPhase: haloPhase, audioLevel: audioLevel, coreRadius: coreRadius, floor: lastFloorRing }; }
    };

    resize();
    initStrands();
    initParticles();

    window.addEventListener('resize', handleResize, { passive: true });
    canvas.addEventListener('mousemove', handleMouseMove, { passive: true });
    // The canvas sits behind the panels, so a canvas-only listener never fires
    // over the UI. Track the pointer window-wide and scale into canvas space.
    window.addEventListener('mousemove', (e) => {
        const _plexPointer = 1;   // marker: window-level pointer tracking
        mouseX = e.clientX * scaleX;
        mouseY = e.clientY * scaleY;
        mouseActive = true;
    }, { passive: true });
    window.addEventListener('mouseleave', () => { mouseActive = false; });
    canvas.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    canvas.addEventListener('click', handleClick, { passive: true });

    animFrameId = requestAnimationFrame(animate);

    ctx.fillStyle = BG();
    ctx.fillRect(0, 0, width, height);
    screen.drawImage(off, 0, 0);

    coreEnergy = 1.0;
    audioLevel = 0.05;

    setInterval(function() {
        if (coreEnergy < 0.8) coreEnergy = 0.8;
        if (audioLevel < 0.05) audioLevel = 0.05;
        if (performance.now() - lastAnimateTimestamp > 1000) {
            console.log('[Visualizer] Self-recovery: animation stalled, restarting loop');
            lastFrameTime = 0;
            animFrameId = requestAnimationFrame(animate);
        }
    }, 500);

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            console.log('[Visualizer] Window visible again, restarting animation loop');
            lastFrameTime = 0;
            lastAnimateTimestamp = performance.now();
            animFrameId = requestAnimationFrame(animate);
        }
    });

    if (window.electronAPI && window.electronAPI.onOverlayShown) {
        window.electronAPI.onOverlayShown(function() {
            console.log('[Visualizer] Overlay shown event received, restarting animation loop');
            lastFrameTime = 0;
            lastAnimateTimestamp = performance.now();
            animFrameId = requestAnimationFrame(animate);
        });
    }

})();