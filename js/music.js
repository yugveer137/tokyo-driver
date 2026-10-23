// tokyo-driver1 v2 — MUSIC. A few original rap tracks the game makes on the fly with WebAudio
// (kick, snare, hats, 808 bass, a synth line). Instrumental only: the lyrics are kept in the
// song list for reference but are not spoken (the user wanted no talking).
// No audio files, nothing downloaded. Music.play(id) / Music.stop(); Music.songs lists them.
window.Music = (function () {
    const M = { songs: [], current: null, playing: false };
    let ctx, master, noiseBuf, timer, nextStep, step, bar, song, voice, speakTimers = [];
    const _ = null;

    M.songs = [
        {
            id: 'tokyo', title: 'Tokyo Night Drive', bpm: 92, root: 41.2,
            kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: [15], roll: [],
            bass: [0, _, _, _, _, _, _, 0, _, _, 3, _, _, _, 5, _],
            lead: [_, _, 12, _, _, _, 15, _, _, _, _, 19, _, _, 15, _],
            lyrics: [
                'Rolling out of Tokyo, neon on the glass',
                'Exit one behind me, watch the city pass',
                'Gear up, gear up, hear the engine sing',
                'Coins in my pocket, chasing everything',
                'Left lane, right lane, every light goes green',
                'Cleanest ride that you have ever seen',
                'Sky turns gold and then it fades to black',
                'Tokyo driver, never looking back'
            ]
        },
        {
            id: 'i80', title: 'I-80 Anthem', bpm: 98, root: 49,
            kick: [0, 3, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], ohat: [], roll: [13, 14, 15],
            bass: [0, _, _, 0, _, _, _, _, -2, _, _, -2, _, _, 3, _],
            lead: [7, _, _, _, 10, _, _, _, 12, _, _, _, 10, _, _, _],
            lyrics: [
                'I-80 all night, seven cities on the line',
                'Frisco to the Bay, Sacramento in the shine',
                'Reno lights are flashing, Vegas in my view',
                'New York on the sign, yeah, I am coming through',
                'Take the exit slow, take the on-ramp fast',
                'U-turn under the freeway, bring it right back',
                'Ta-da at a hundred, horn goes loud',
                'Tokyo driver one, rolling through the crowd'
            ]
        },
        {
            id: 'tow', title: 'Tow Truck Blues', bpm: 84, root: 55,
            kick: [0, 6, 10], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13], ohat: [7], roll: [14, 15],
            bass: [0, _, _, _, _, _, -5, _, _, _, -2, _, _, _, _, _],
            lead: [_, _, 3, _, _, _, 7, _, _, 10, _, _, _, 7, _, _],
            lyrics: [
                'Tire blew out on the shoulder, yeah',
                'Limping to the workshop, slow and clear',
                'Door comes down and the sparks fly bright',
                'Four fresh tires, now I am feeling right',
                'Call the tow truck, four hundred on the dial',
                'He hooks me up and we fly for a mile',
                'Workshop fixing, Tokyo style',
                'Back on the freeway with a brand new smile'
            ]
        },
        {
            id: 'drift', title: 'Drift Mode', bpm: 104, root: 73.4,
            kick: [0, 4, 8, 12, 14], snare: [4, 12], hat: [2, 6, 10, 14], ohat: [15], roll: [],
            bass: [0, _, 0, _, 3, _, 3, _, 5, _, 5, _, 3, _, 0, _],
            lead: [12, _, _, 15, _, _, 17, _, _, _, 15, _, _, _, _, _],
            lyrics: [
                'Hold the space bar, let the back end slide',
                'Smoke in the mirrors on the Tokyo side',
                'Boost button pressed, ten seconds of fire',
                'Crystal sphere spinning, taking me higher',
                'Cruise control on and the lane lock tight',
                'Train on the left rolling through the night',
                'Coins keep stacking and the garage keeps growing',
                'Thirty-two cars and I am still going'
            ]
        }
    ];

    function ensureCtx() {
        if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
        const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
        ctx = new Ctx();
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
        master = ctx.createGain(); master.gain.value = 0.7;
        master.connect(comp); comp.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const noise = (t, type, freq, q, gain, len) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
        src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + len + 0.05);
    };
    function kick(t) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
    }
    function snare(t) {
        noise(t, 'bandpass', 1700, 0.9, 0.7, 0.18);
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 190;
        g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
    }
    const hat = (t, open) => noise(t, 'highpass', 7500, 0.7, open ? 0.22 : 0.18, open ? 0.3 : 0.05);
    function bass(t, semis) {
        const f = song.root * Math.pow(2, semis / 12);
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
        o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        o2.type = 'triangle'; o2.frequency.value = f * 2;
        const ws = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.5); } ws.curve = c;
        g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        g2.gain.value = 0.25;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(ws); ws.connect(master);
        o.start(t); o2.start(t); o.stop(t + 0.55); o2.stop(t + 0.55);
    }
    function lead(t, semis) {
        const f = song.root * 4 * Math.pow(2, semis / 12);
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 1400;
        g.gain.setValueAtTime(0.11, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
    }
    function playStep(i, t) {
        if (song.kick.indexOf(i) !== -1) kick(t);
        if (song.snare.indexOf(i) !== -1) snare(t);
        if (song.hat.indexOf(i) !== -1) hat(t, false);
        if (song.ohat.indexOf(i) !== -1) hat(t, true);
        if (song.roll.indexOf(i) !== -1) { hat(t, false); hat(t + 60 / song.bpm / 8, false); }
        if (song.bass[i] !== null) bass(t, song.bass[i]);
        if (song.lead[i] !== null) lead(t, song.lead[i]);
    }

    // ---- the rapper: the browser's speech voice, one line per bar after a two-bar intro ----
    function pickVoice() {
        if (!window.speechSynthesis) return null;
        const vs = speechSynthesis.getVoices();
        const want = ['Daniel', 'Fred', 'Rishi', 'Aaron', 'Alex', 'Google US English', 'Microsoft David'];
        for (const w of want) { const v = vs.find(x => x.name.indexOf(w) !== -1); if (v) return v; }
        return vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
    }
    function speakLine(text, delayMs) {
        if (!window.speechSynthesis) return;
        const id = setTimeout(() => {
            const u = new SpeechSynthesisUtterance(text);
            if (!voice) voice = pickVoice();
            if (voice) u.voice = voice;
            u.rate = Math.max(1.0, Math.min(1.5, song.bpm / 76)); u.pitch = 0.75; u.volume = 1;
            speechSynthesis.speak(u);
        }, Math.max(0, delayMs));
        speakTimers.push(id);
    }

    function schedule() {
        if (!M.playing) return;
        const stepLen = 60 / song.bpm / 4;
        while (nextStep < ctx.currentTime + 0.25) {
            playStep(step, nextStep);
            step = (step + 1) % 16; if (step === 0) bar++;
            nextStep += stepLen;
        }
    }

    M.play = function (id) {
        ensureCtx(); if (!ctx) { UI.toast('No audio in this browser'); return; }
        M.stop(true);
        song = M.songs.find(s => s.id === id) || M.songs[0];
        M.current = song; M.playing = true;
        step = 0; bar = 0; nextStep = ctx.currentTime + 0.1;
        timer = setInterval(schedule, 50); schedule();
        if (window.UI) UI.toast('♪ ' + song.title, 2500);
    };
    M.stop = function (quiet) {
        clearInterval(timer); timer = null;
        speakTimers.forEach(clearTimeout); speakTimers = [];
        if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {}
        const was = M.playing; M.playing = false;
        if (was && !quiet && window.UI) UI.toast('Music off');
    };
    M.next = function () { const i = M.songs.indexOf(M.current); M.play(M.songs[(i + 1) % M.songs.length].id); };
    M.init = function () { if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); }; };
    return M;
})();
