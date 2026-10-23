// tokyo-driver1 v2 — shared constants. Plain globals, no modules.
window.CFG = {
    TITLE: 'tokyo-driver1',
    GRAVITY: -30,                       // ~3x real, keeps the car planted (same as the old game)
    CYCLE: { day: 60, night: 60 },      // seconds; dawn and dusk blend inside these
    MPH: 2.237,                         // units/s -> mph

    // Gearbox ported from the old game: each gear caps speed at a fraction of the car's max
    // and scales engine force.
    GEARS: [
        { name: 'R', speedFrac: 0.2,  force: 0.5 },
        { name: '1', speedFrac: 0.5,  force: 2.0 },
        { name: '2', speedFrac: 0.65, force: 1.6 },
        { name: '3', speedFrac: 0.8,  force: 1.3 },
        { name: '4', speedFrac: 0.9,  force: 1.0 },
        { name: '5', speedFrac: 0.95, force: 0.8 },
        { name: '6', speedFrac: 1.0,  force: 0.65 }
    ],

    // Used until carmodels.js (the ported 32-car table) is loaded.
    DEFAULT_CAR: { id: 'starter', name: 'Starter', price: 0, maxSpeed: 80, acceleration: 12, handling: 0.1, color: 0x4466ff, bodyColor: 0x4466ff }
};
