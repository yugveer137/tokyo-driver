// tokyo-driver1 v2 — filming the ad's shots (a developer tool, not loaded by the game).
// Load it into the running game from the console:
//     const s = document.createElement('script'); s.src = 'tools/film.js'; document.head.appendChild(s);
// then set a scene up, let it run in with  await Film.run(120)  (frames) and record with
// await Film.shoot('shot1.mp4', 5.4)  (seconds).
//
// It records the game canvas frame by frame instead of in real time: Film steps the game
// itself, a fixed 1/30 s per frame, and hands every frame to the browser's H.264 encoder with
// its own timestamp. So the clip is smooth at 30 frames a second however slowly the browser is
// drawing (a covered window draws one frame a second, and a real-time recording of that is a
// slide show), and filming does not wait for the screen at all. The encoded frames are then
// packed into a plain MP4 here, since the encoder gives bare frames and nothing in the browser
// writes the file for us.
window.Film = (function () {
    const F = { fps: 30, bitrate: 1800000, saveTo: 'http://127.0.0.1:8733/' };   // (saveTo: a small local server that writes the POSTed file into assets/ad)
    let frames = 0;                 // rendered frames since load (a frame is 1/30 s of game time)
    let shot = null;                // the shot being recorded

    // step the game a fixed 1/30 s per frame, and catch every frame drawn to the screen
    F.install = function () {
        if (F.installed) return; F.installed = true;
        THREE.Clock.prototype.getDelta = function () { frames++; return 1 / F.fps; };
        const r = game.renderer, draw = r.render.bind(r);
        r.render = function (scene, camera) {
            draw(scene, camera);
            if (shot && r.getRenderTarget() === null) grab();           // (not the mirror cameras, which draw to a texture)
        };
        // 1280x720 whatever the window and the adaptive quality say
        const setRatio = r.setPixelRatio.bind(r);
        r.setPixelRatio = function () {};
        setRatio(1280 / window.innerWidth); r.setSize(window.innerWidth, window.innerHeight);
    };
    F.frames = () => frames;
    // let the browser get on with its own work between frames (a message, not a timer: timers
    // are held back to one a second in a window that is not in view)
    const channel = new MessageChannel();
    const breathe = () => new Promise(res => { channel.port1.onmessage = res; channel.port2.postMessage(0); });
    // step the game one frame and draw it
    async function step() { game.tick(1 / F.fps); game.render(); await breathe(); }
    // run the game n frames (to get a car up to speed before a shot)
    F.run = async function (n) { F.install(); for (let i = 0; i < n; i++) await step(); };

    function grab() {
        if (shot.taken >= shot.count) return;
        const frame = new VideoFrame(game.renderer.domElement, { timestamp: Math.round(shot.taken * 1e6 / F.fps) });
        shot.encoder.encode(frame, { keyFrame: shot.taken % F.fps === 0 });   // a key frame every second
        frame.close();
        shot.taken++;
    }

    // Record the next `seconds` of game time into `name` and save it. Returns a line about it.
    F.shoot = async function (name, seconds) {
        F.install();
        const cv = game.renderer.domElement, samples = [];
        let config = null, failed = null;
        const encoder = new VideoEncoder({
            output: (chunk, meta) => {
                if (meta && meta.decoderConfig && meta.decoderConfig.description) config = new Uint8Array(meta.decoderConfig.description);
                const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
                samples.push({ data, key: chunk.type === 'key' });
            },
            error: (e) => { failed = e; }
        });
        encoder.configure({ codec: 'avc1.42E01F', width: cv.width, height: cv.height, bitrate: F.bitrate, framerate: F.fps, avc: { format: 'avc' } });
        shot = { encoder, count: Math.round(seconds * F.fps), taken: 0 };
        while (shot.taken < shot.count && !failed) await step();
        const done = shot; shot = null;
        await done.encoder.flush(); done.encoder.close();
        if (failed) throw failed;
        const file = mp4(samples, config, cv.width, cv.height, F.fps);
        const res = await fetch(F.saveTo + name, { method: 'POST', body: new Blob([file], { type: 'video/mp4' }) });
        return name + ': ' + samples.length + ' frames, ' + Math.round(file.length / 1024) + ' KB, saved ' + res.status;
    };

    // ---------- a minimal MP4 file: one H.264 video track, every frame the same length ----------
    // (boxes are a 4-byte size, a 4-letter name, then their contents; numbers are big-endian)
    function bytes() {
        const out = [];
        for (const part of arguments) {
            if (typeof part === 'string') for (let i = 0; i < part.length; i++) out.push(part.charCodeAt(i));
            else if (part instanceof Uint8Array) for (let i = 0; i < part.length; i++) out.push(part[i]);
            else out.push(...part);
        }
        return out;
    }
    const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const u16 = (n) => [(n >>> 8) & 255, n & 255];
    const zeros = (n) => new Array(n).fill(0);
    const box = (name, ...content) => { const body = bytes(...content); return bytes(u32(body.length + 8), name, body); };
    const MATRIX = bytes(u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000));   // no rotation or scaling

    function mp4(samples, avcC, width, height, fps) {
        const n = samples.length, scale = fps * 1000, each = 1000;         // media time: `each` ticks per frame
        const ms = Math.round(n * 1000 / fps);
        const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
        const ftyp = box('ftyp', 'isom', u32(0x200), 'isomiso2avc1mp41');
        const moovFor = (dataAt) => box('moov',
            box('mvhd', u32(0), u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
            box('trak',
                box('tkhd', u32(3), u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
                box('mdia',
                    box('mdhd', u32(0), u32(0), u32(0), u32(scale), u32(n * each), u16(0x55c4), u16(0)),
                    box('hdlr', u32(0), u32(0), 'vide', zeros(12), 'VideoHandler', [0]),
                    box('minf',
                        box('vmhd', u32(1), zeros(8)),
                        box('dinf', box('dref', u32(0), u32(1), box('url ', u32(1)))),
                        box('stbl',
                            box('stsd', u32(0), u32(1),
                                box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff),
                                    box('avcC', avcC))),
                            box('stts', u32(0), u32(1), u32(n), u32(each)),            // every frame lasts the same
                            box('stss', u32(0), u32(keys.length), ...keys.map(u32)),   // which frames are key frames
                            box('stsc', u32(0), u32(1), u32(1), u32(n), u32(1)),       // one chunk holds them all
                            box('stsz', u32(0), u32(0), u32(n), ...samples.map(s => u32(s.data.length))),
                            box('stco', u32(0), u32(1), u32(dataAt)))))));
        // the index goes before the picture data (so playback can start at once), which means its
        // own size decides where the data starts: build it once to measure, then for real
        const dataAt = ftyp.length + moovFor(0).length + 8;
        const moov = moovFor(dataAt);
        const total = samples.reduce((sum, s) => sum + s.data.length, 0);
        const file = new Uint8Array(dataAt + total);
        file.set(ftyp, 0); file.set(moov, ftyp.length);
        file.set(bytes(u32(total + 8), 'mdat'), ftyp.length + moov.length);
        let at = dataAt;
        samples.forEach(s => { file.set(s.data, at); at += s.data.length; });
        return file;
    }

    return F;
})();
