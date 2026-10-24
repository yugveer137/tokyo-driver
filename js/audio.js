// GameAudio: procedural engine, tire screech, wind and horns (Web Audio, no samples).
// Ported from the old index.html sound system. No game dependencies; the only
// outside state is the 'td_sound' localStorage key for the on/off setting.
(function () {
    'use strict';

    let audioCtx = null;
    let soundEnabled = true;
    try { soundEnabled = (localStorage.getItem('td_sound') !== 'off'); } catch (e) {}

    let engineOsc1 = null, engineOsc2 = null, engineOsc3 = null;
    let engineGain = null, engineGain2 = null, engineGain3 = null;
    let tireScreechNoise = null, tireScreechGain = null;
    let windNoise = null, windFilter = null, windGain = null;

    let honkTimeout = null;
    let lastHornTime = -Infinity;

    let currentCar = null;

    function getEngineProfile() {
        const carData = currentCar || {};
        if (carData.isTruck || carData.isPickup) return { base: 35, rumble: 20, exhaust: 18, rumbleGain: 0.12, label: 'diesel' };
        if (carData.isDrift) return { base: 65, rumble: 35, exhaust: 32, rumbleGain: 0.06, label: 'drift' };
        if (carData.maxSpeed >= 500) return { base: 70, rumble: 40, exhaust: 35, rumbleGain: 0.04, label: 'supercar' };
        return { base: 55, rumble: 30, exhaust: 27, rumbleGain: 0.08, label: 'default' };
    }

    function makeNoiseBuffer() {
        const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    function init() {
        if (audioCtx) {
            if (soundEnabled && audioCtx.state === 'suspended') audioCtx.resume();
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
        if (!soundEnabled) audioCtx.suspend(); // honor Settings sound toggle
        else if (audioCtx.state === 'suspended') audioCtx.resume();

        const profile = getEngineProfile();

        // Main engine oscillator - sawtooth for raw engine sound
        engineOsc1 = audioCtx.createOscillator();
        engineOsc1.type = 'sawtooth';
        engineOsc1.frequency.value = profile.base;
        engineGain = audioCtx.createGain();
        engineGain.gain.value = 0.06;

        // Low rumble oscillator
        engineOsc2 = audioCtx.createOscillator();
        engineOsc2.type = 'triangle';
        engineOsc2.frequency.value = profile.rumble;
        engineGain2 = audioCtx.createGain();
        engineGain2.gain.value = profile.rumbleGain;

        // Exhaust pop/crackle - square wave for grit
        engineOsc3 = audioCtx.createOscillator();
        engineOsc3.type = 'square';
        engineOsc3.frequency.value = profile.exhaust;
        engineGain3 = audioCtx.createGain();
        engineGain3.gain.value = 0.02;

        // Distortion for realism
        const distortion = audioCtx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = (i * 2) / 256 - 1;
            curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
        }
        distortion.curve = curve;

        // Low-pass filter to tame harshness
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        filter.Q.value = 1;

        // oscillators -> gains -> distortion -> filter -> output
        engineOsc1.connect(engineGain);
        engineOsc2.connect(engineGain2);
        engineOsc3.connect(engineGain3);
        engineGain.connect(distortion);
        engineGain2.connect(distortion);
        engineGain3.connect(distortion);
        distortion.connect(filter);
        filter.connect(audioCtx.destination);

        engineOsc1.start();
        engineOsc2.start();
        engineOsc3.start();

        // Tire screech: bandpass-filtered white noise
        tireScreechNoise = audioCtx.createBufferSource();
        tireScreechNoise.buffer = makeNoiseBuffer();
        tireScreechNoise.loop = true;
        const tireScreechFilter = audioCtx.createBiquadFilter();
        tireScreechFilter.type = 'bandpass';
        tireScreechFilter.frequency.value = 3000;
        tireScreechFilter.Q.value = 2;
        tireScreechGain = audioCtx.createGain();
        tireScreechGain.gain.value = 0;
        tireScreechNoise.connect(tireScreechFilter);
        tireScreechFilter.connect(tireScreechGain);
        tireScreechGain.connect(audioCtx.destination);
        tireScreechNoise.start();

        // Wind noise: lowpass-filtered white noise
        windNoise = audioCtx.createBufferSource();
        windNoise.buffer = makeNoiseBuffer();
        windNoise.loop = true;
        windFilter = audioCtx.createBiquadFilter();
        windFilter.type = 'lowpass';
        windFilter.frequency.value = 200;
        windFilter.Q.value = 0.5;
        windGain = audioCtx.createGain();
        windGain.gain.value = 0;
        windNoise.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(audioCtx.destination);
        windNoise.start();
    }

    function setCar(carData) {
        currentCar = carData || null;
        if (!audioCtx || !engineOsc1) return;
        const profile = getEngineProfile();
        const t = audioCtx.currentTime;
        engineOsc1.frequency.setTargetAtTime(profile.base, t, 0.1);
        engineOsc2.frequency.setTargetAtTime(profile.rumble, t, 0.1);
        engineOsc3.frequency.setTargetAtTime(profile.exhaust, t, 0.1);
    }

    // state = { mph, throttle (0..1), lateralVel (m/s), drifting (bool) }
    function update(state) {
        if (!audioCtx || !engineOsc1) return;
        const now = audioCtx.currentTime;
        const speedMph = Math.max(0, state.mph || 0);
        const throttle = state.throttle || 0;

        // Mute engine sound for electric cars
        if (currentCar && currentCar.isElectric) {
            engineGain.gain.setTargetAtTime(0, now, 0.1);
            engineGain2.gain.setTargetAtTime(0, now, 0.1);
            engineGain3.gain.setTargetAtTime(0, now, 0.1);
        } else {
            const profile = getEngineProfile();

            // RPM simulation: idle at ~800 RPM, scales with speed
            const idleRPM = 800;
            const maxRPM = 8000;
            const rpm = idleRPM + (speedMph / 300) * (maxRPM - idleRPM);
            const rpmNorm = Math.min(rpm / maxRPM, 1);

            // Per-car engine frequencies
            const baseFreq = profile.base + rpmNorm * (profile.base * 3);
            engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.1);
            engineOsc2.frequency.setTargetAtTime(profile.rumble + rpmNorm * (profile.rumble * 2.6), now, 0.1);
            engineOsc3.frequency.setTargetAtTime(profile.exhaust + rpmNorm * (profile.exhaust * 2.3), now, 0.1);

            // Volume: louder when accelerating, quieter at idle
            const idleVol = 0.04;
            const maxVol = 0.12;
            const targetVol = throttle > 0 ? (idleVol + rpmNorm * (maxVol - idleVol)) : (idleVol + rpmNorm * 0.03);
            engineGain.gain.setTargetAtTime(targetVol, now, 0.15);
            engineGain2.gain.setTargetAtTime(targetVol * 1.2, now, 0.15);
            engineGain3.gain.setTargetAtTime(throttle > 0 ? targetVol * 0.4 : 0.01, now, 0.15);
        }

        // Tire screech: volume scales with lateral velocity
        const latVel = Math.abs(state.lateralVel || 0);
        const screechVol = Math.min(0.15, Math.max(0, (latVel - 3) * 0.015)) * (state.drifting ? 1.5 : 1);
        tireScreechGain.gain.setTargetAtTime(Math.min(screechVol, 0.2), now, 0.05);

        // Wind noise: volume and cutoff scale with speed
        const windFactor = Math.min(speedMph / 200, 1);
        windGain.gain.setTargetAtTime(windFactor * 0.08, now, 0.1);
        windFilter.frequency.setTargetAtTime(200 + windFactor * 2800, now, 0.1);
    }

    // Player horn: two square tones, 0.5s decay, 300ms lock
    function honk() {
        if (!audioCtx || honkTimeout) return;
        const now = audioCtx.currentTime;

        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        const gain2 = audioCtx.createGain();

        osc1.type = 'square';
        osc1.frequency.value = 480;
        osc2.type = 'square';
        osc2.frequency.value = 380;

        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        gain2.gain.setValueAtTime(0.1, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc1.connect(gain1);
        osc2.connect(gain2);
        gain1.connect(audioCtx.destination);
        gain2.connect(audioCtx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.5);
        osc2.stop(now + 0.5);

        honkTimeout = setTimeout(() => { honkTimeout = null; }, 300);
    }

    // NPC horn: sawtooth pair, 2-second cooldown
    function npcHorn() {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        if (now - lastHornTime < 2) return;
        lastHornTime = now;

        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        osc1.frequency.value = 380;
        osc2.frequency.value = 510;
        const hornGain = audioCtx.createGain();
        hornGain.gain.value = 0.08;
        hornGain.gain.setTargetAtTime(0, now + 0.3, 0.05);
        osc1.connect(hornGain);
        osc2.connect(hornGain);
        hornGain.connect(audioCtx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
    }

    function setEnabled(on) {
        soundEnabled = !!on;
        try { localStorage.setItem('td_sound', soundEnabled ? 'on' : 'off'); } catch (e) {}
        if (audioCtx) { soundEnabled ? audioCtx.resume() : audioCtx.suspend(); }
    }

    function isEnabled() { return soundEnabled; }

    // Tear everything down; init() can be called again afterwards.
    function stop() {
        if (!audioCtx) return;
        [engineOsc1, engineOsc2, engineOsc3, tireScreechNoise, windNoise].forEach(n => {
            try { n.stop(); } catch (e) {}
        });
        try { audioCtx.close(); } catch (e) {}
        audioCtx = null;
        engineOsc1 = engineOsc2 = engineOsc3 = null;
        engineGain = engineGain2 = engineGain3 = null;
        tireScreechNoise = tireScreechGain = null;
        windNoise = windFilter = windGain = null;
        if (honkTimeout) { clearTimeout(honkTimeout); honkTimeout = null; }
        lastHornTime = -Infinity;
    }

    // Workshop clank: a short metallic hit (noise burst through a ringing bandpass)
    function clank() {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const src = audioCtx.createBufferSource(); src.buffer = makeNoiseBuffer();
        const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 1200; bp.Q.value = 12;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(0.5, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        src.connect(bp); bp.connect(g); g.connect(audioCtx.destination);
        src.start(now); src.stop(now + 0.3);
    }

    // Police siren: a two-tone wail (saw wave sweeping between 600 and 1000 Hz) while on
    let sirenOsc = null, sirenGain = null, sirenLfo = null;
    function siren(on) {
        if (!audioCtx) return;
        if (on && !sirenOsc) {
            sirenOsc = audioCtx.createOscillator(); sirenOsc.type = 'sawtooth'; sirenOsc.frequency.value = 800;
            sirenLfo = audioCtx.createOscillator(); sirenLfo.type = 'triangle'; sirenLfo.frequency.value = 0.8;
            const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 200;
            sirenLfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
            const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
            sirenGain = audioCtx.createGain(); sirenGain.gain.value = 0.0;
            sirenOsc.connect(lp); lp.connect(sirenGain); sirenGain.connect(audioCtx.destination);
            sirenOsc.start(); sirenLfo.start();
            sirenGain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.3);
        } else if (!on && sirenOsc) {
            const o = sirenOsc, l = sirenLfo, g = sirenGain; sirenOsc = sirenLfo = sirenGain = null;
            g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
            setTimeout(() => { try { o.stop(); l.stop(); } catch (e) {} }, 500);
        }
    }

    window.GameAudio = { init, setCar, update, honk, npcHorn, clank, siren, setEnabled, isEnabled, stop };
})();
