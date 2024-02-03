import { AppConfig as conf, saveConfig } from '../bin/config.js';
import { GeoPoint, Track } from './geo.js';
import { GpsProvider as gps } from './position.js';
import './proto.js';

/**
 * Desat Storage key
 */
const DESAT_STORAGE = '__lastDive__';

/**
 * Max secure speed in m/min
 * 
 */
const MAX_SPEED = 14;

/**
 * Minutes in a day
 */
const DAYMIN = 1440;
/**
 * Time, in minutes, in surface to considers dive finished
 */
const END_TIME = 3;

/**
 * Mininum O2 fraction to use, at sea level
 */
const MIN_FO2  = .18;
/**
 * O2 percent in Air
 */
const AIR_O2   = .21;
/**
 * N2 percent in Air
 */
const AIR_N2   = .79;

/**
 * Pressure at sea level, in bar
 */
const SEALEVEL_PRESSURE = 1.013;

/**
 * Group of uncategorized Dive calculations
 * 
 */
const DiveCalc = {
    /**
     * Calculates the time to reach surface
     * 
     * Returns time in minutes.
     * 
     * @param {number} d Depth in meters
     * @returns int
     */
    tts: (d) =>
    {
        return Math.ceil(d / MAX_SPEED);
    }
}
// *************** PADI AIR DIVE TABLE *****************
const DIVE_METERS = [ 10,  12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 42];
const SAFE_TIME   = [160, 116, 82, 63, 51, 40, 32, 25,  0,  0,  0,  0];
const DECO_GROUP  = "ABCDEFGHIJKLMNOPQRSTUVWXYZ+";
const DIVE_TIMES  = [
    [10, 20, 26, 30, 34, 37, 41, 45, 50, 54, 59, 64, 70, 75, 82, 88, 95, 104, 112, 122, 133, 145, 160, 178, 199, 219], //10
    [9, 17, 23, 26, 29, 32, 35, 38, 42, 45, 49, 53, 57, 62, 66, 71, 76, 82, 88, 94, 101, 108, 116, 125, 134, 147], //12
    [8, 15, 19, 22, 24, 27, 29, 32, 35, 37, 40, 43, 47, 50, 53, 57, 61, 64, 68, 73, 77, 82, 87, 92, 98], //14
    [7, 13, 17, 19, 21, 23, 25, 27, 29, 32, 34, 37, 39, 42, 45, 48, 50, 53, 56, 60, 63, 67, 70, 72], //16
    [6, 11, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 39, 41, 43, 46, 48, 51, 53, 55, 56], //18
    [6, 10, 13, 15, 16, 18, 20, 21, 23, 25, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 45], //20
    [5, 9, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 27, 29, 30, 32, 34, 36, 37], //22
    [4, 8, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23, 25, 26, 28, 29], //25
    [3, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20], //30
    [3, 5, 7, 8, 8, 9, 10, 11, 12, 13, 14], //35
    [0, 5, 6, 0, 7, 8, 9], //40
    [0, 4, 0, 6, 7, 8], //42
];
const DECO_SI     = [
    [180], // A
    [47, 228], // B
    [21, 69, 250], // C
    [8, 30, 78, 259], // D
    [7, 16, 38, 87, 268], // E
    [7, 15, 24, 46, 94, 275], // F
    [6, 13, 22, 31, 53, 101, 282], // G
    [5, 12, 20, 28, 37, 59, 107, 288], // H
    [5, 11, 18, 26, 34, 43, 65, 113, 294], // I
    [5, 11, 17, 24, 31, 40, 49, 71, 119, 300], // J
    [4, 10, 16, 22, 29, 37, 45, 54, 76, 124, 305], // K
    [4, 9, 15, 21, 27, 34, 42, 50, 59, 81, 129, 310], // L
    [4, 9, 14, 19, 25, 32, 39, 46, 55, 64, 85, 134, 315], // M
    [3, 8, 13, 18, 24, 30, 36, 43, 51, 59, 68, 90, 138, 319], // N
    [3, 8, 12, 17, 23, 28, 34, 41, 47, 55, 63, 72, 94, 143, 324], // O
    [3, 7, 12, 16, 21, 27, 32, 38, 45, 51, 59, 67, 76, 98, 147, 328],// P
    [3, 7, 11, 16, 20, 25, 30, 36, 42, 48, 55, 63, 71, 80, 102, 150, 331], // Q
    [3, 7, 11, 15, 19, 24, 29, 34, 40, 46, 52, 59, 67, 75, 84, 106, 154, 335], // R
    [3, 6, 10, 14, 18, 23, 27, 32, 38, 43, 49, 56, 63, 70, 78, 87, 109, 158, 339], // S
    [2, 6, 10, 13, 17, 22, 26, 31, 36, 41, 47, 53, 59, 66, 73, 82, 91, 113, 161, 342], // T
    [2, 6, 9, 13, 17, 21, 25, 29, 34, 39, 44, 50, 56, 62, 69, 77, 85, 94, 116, 164, 345], // U
    [2, 5, 9, 12, 16, 20, 24, 28, 33, 37, 42, 47, 53, 59, 65, 72, 80, 88, 97, 119, 167, 348], // V
    [2, 5, 8, 12, 15, 19, 23, 27, 31, 36, 40, 45, 50, 56, 62, 68, 75, 83, 91, 100, 122, 170, 351], // W
    [2, 5, 8, 12, 15, 18, 22, 26, 30, 34, 39, 43, 48, 53, 59, 65, 71, 78, 86, 94, 103, 125, 173, 354], // X
    [2, 5, 8, 11, 14, 18, 21, 25, 29, 33, 37, 41, 46, 51, 56, 62, 68, 74, 81, 89, 97, 106, 128, 176, 357], // Y
    [2, 5, 8, 11, 14, 17, 20, 24, 28, 31, 35, 40, 44, 49, 54, 59, 65, 71, 77, 84, 91, 100, 109, 131, 179, 360], // Z
    Array(DECO_GROUP.length).fill(DAYMIN * .5) // +
];
// *************** END PADI AIR DIVE TABLE *****************
/**
 * Group of deco calculations
 * 
 */
const DecoCalc = {
    /**
     * Returns depth index, or -1
     * 
     * @param {number} d Depth (swm - sea water meters)
     * @returns int
     */
    getDepthIndex: (d) =>
    {
        for (let i = 0; i < DIVE_METERS.length; i++) {
            if (d <= DIVE_METERS[i]) {
                return i;
            }
        }
        return -1;
    },

    /**
     * Returns a NDL in minutes
     * 
     * DOESN'T USE RNT!!!
     * 
     * @param {number} d Depth (swm - sea water meters)
     * @returns int
     */
    ndl: (d) =>
    {
        let i = DecoCalc.getDepthIndex(d);
        if (i >= 0) {
            return DIVE_TIMES[i].at(-1);
        }
        return 0;
    },

    /**
     * Returns the deco group by depth and TBT given
     * 
     * @param {number} d Depth (swm - sea water meters)
     * @param {number} tbt Total bottom time, in minutes
     * @returns string
     */
    decoGroup: (d, tbt) =>
    {
        if (tbt <= 0) {
            return null;
        }

        let di = DecoCalc.getDepthIndex(d);
        if (di >= 0) {
            const TIMES = DIVE_TIMES[di];
            for (let i = 0; i < TIMES.length; i++) {
                if (tbt <= TIMES[i]) {
                    return DECO_GROUP.charAt(i);
                }
            }
        }
        return '+';
    },

    /**
     * Checks if a dive need a safety stop
     * 
     * @param {number} d Depth (swm - sea water meters)
     * @param {string} g Current deco group
     * @returns boolean
     */
    safetyStop: (d, g) =>
    {
        let gi = DECO_GROUP.indexOf(g);
        if (gi < 0) {
            return false;
        }

        let di = DecoCalc.getDepthIndex(d);
        if (DIVE_TIMES[di] && DIVE_TIMES[di][gi]) {
            return DIVE_TIMES[di][gi] >= SAFE_TIME[di];
        }
        return true;
    },

    /**
     * Returns the deco group after a surface interval
     * 
     * If SI greater than all interval, return null (no residual)
     * 
     * @param {number} si Surface interval, in minutes
     * @param {string} g Last deco group
     * @returns string
     */
    regroup: (si, g) =>
    {
        let gi = DECO_GROUP.indexOf(g);
        if (gi < 0) {
            return g;
        }
        const INTERVAL = DECO_SI[gi];
        for (let i = 0; i < INTERVAL.length; i++) {
            if (si <= INTERVAL[i]) {
                return DECO_GROUP.charAt(INTERVAL.length - i - 1);
            }
        }
        return null;
    },

    /**
     * Returns desaturation time from given group, in minutes
     * 
     * @param {string} g 
     * @returns int
     */
    desat: (g) =>
    {
        let gi = DECO_GROUP.indexOf(g);
        if (gi >= 0) {
            return DECO_SI[gi].at(-1);
        }
        return 0;
    },

    /**
     * Returns the RNT using group and depth given
     * 
     * @param {string} g Deco group
     * @param {number} d Depth (swm - sea water meters)
     * @returns int
     */
    rnt: (g, d) =>
    {
        let gi = DECO_GROUP.indexOf(g);
        if (gi < 0) {
            return 0;
        }

        let di = DecoCalc.getDepthIndex(d);
        if (DIVE_TIMES[di] && DIVE_TIMES[di][gi]) {
            return DIVE_TIMES[di][gi];
        }
        return DAYMIN * .5;
    },

    /**
     * Converts a depth to its "Equivalent Table Depth"
     * 
     * ETD is a depth considering a dive in sea water, using air as gas mix
     * 
     * This because PADI Air Table times is basead in depths in this conditions. However,
     * we support other gases' mix, salt/fresh types and altitude dives.
     * 
     * EAD/END classic formulas working just in sea level. So, we upgrade them to accept
     * altitude dives. To choose one of them, we use gas mix to decide
     * 
     * @param {number} d Depth, in meters, at environent given
     * @param {GasMix} mix Gas mix
     * @param {DiveSiteEnv} env DiveSite environment
     * @param {boolean} o2narc To trimix, considers O2 narcotic?
     * @returns number
     */
    etd: (d, mix, env, o2narc = true) =>
    {
        switch (mix.id) {
            case 'air':
                return env.depthTo(d, SEAWATER_ENV);
            default:
                let fN  = mix.he > 0 && o2narc ? 1 - mix.he : mix.n2 / AIR_N2;
                let bar = env.pressureAt(d) * fN;
                return SEAWATER_ENV.depthAt(bar);
        }
    }
};

/**
 * Configure dive settings
 * 
 */
export function configDive()
{
    try {
        let mixes = [];
        do {
            let o2 = prompt('Informs mix\'s O2, in percent:', 21); if (o2 === null) break;
            o2 = parseFloat(o2 / 100);
            if (mixes.length && o2 < mixes.at(-1).o2) {
                alert('O2 percent should be greater than previous mix');
                continue;
            }
            let he = prompt('Informs mix\'s He, in percent:', 0); if (he === null) break;
            he = parseFloat(he / 100);
            mixes.push({o2: o2, he: he});
        } while(confirm('Add another mix?'));
        conf.dc.mixes = mixes;

        let mod = prompt('Informs max ppO2, in decimal:', conf.dc.maxPpo2); if (mod === null) return;
        mod = parseFloat(mod);
        if (mod < 1.4 || mod > 1.6) {
            throw 'Invalid ppO2';
        }
        conf.dc.maxPpo2 = mod;
        conf.dc.salt = !!confirm('Are you going to dive in SALT water?');
        saveConfig();
    } catch (e) {
        alert(`ERROR: ${e}`);
    }
}

/**
 * Represents a Gas mix
 */
class GasMix
{
    o2; he; n2; id;
    
    /**
     * Create from another object
     * 
     * @param {object} mix {o2, he}
     * @returns {GasMix}
     */
    static from({o2, he = 0})
    {
        return new GasMix(o2 ?? AIR_O2, he ?? 0);
    }

    /**
     * 
     * @param {number} o2 O2 fraction, in decimal
     * @param {number} he He fraction, in decimal
     */
    constructor(o2, he = 0)
    {
        this.o2 = parseFloat(o2);
        this.he = parseFloat(he);
        this.n2 = (1.0 - this.o2 - this.he);

        let o = parseInt(this.o2 * 100);
        let h = parseInt(this.he * 100);
        switch (true) {
            case o == 100:
                this.id = 'oxygen';
                break;
            case (o + h) == 100:
                this.id = `heliox${h}`;
                break;
            case h > 0:
                this.id = `${o}/${h}`;
                break;
            case o == 21:
                this.id = 'air';
                break;
            case o == 0:
                this.id = 'nitrogen';
                break;
            default:
                this.id = `ean${o}`;
        }

        Object.freeze(this);
    }

    /**
     * Mix's Operational range {min, max (MOD)} at ambient conditions
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns {{min, max}}
     */
    operDepthRange(env)
    {
        let bar = MIN_FO2 / this.o2;
        return {
            min: Math.min(env.depthAt(bar), 0),
            max: this.mod(env)
        };
    }

    /**
     * Mix's Max Operation Depth at ambient conditions
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns number
     */
    mod(env)
    {
        let bar = conf.dc.maxPpo2 / this.o2;
        return env.depthAt(bar);
    }

    /**
     * Mix's Max Narcotic Depth at ambient conditions
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @param {boolean} o2narco Is O2 narcotic?
     * @returns number
     */
    mnd(env, o2narco = true)
    {
        let fN  = (o2narco || !this.n2) ? (1 - this.he) : (AIR_N2 / this.n2);
        let bar = (4 / fN);
        return env.depthAt(bar);
    }

    /**
     * Are mixes equals?
     * 
     * @param {GasMix} mix Another mix
     * @returns boolean
     */
    equals(mix)
    {
        return this.id === mix.id;
    }

    /**
     * Checks if mix can used at given depth
     * 
     * @param {number} d Depth, in meters
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns boolean
     */
    canUseAt(d, env)
    {
        let od = this.operDepthRange(env);
        return d >= od.min && d <= od.max;
    }
}
/**
 * Air mix
 * 
 * @type {GasMix}
 */
export const AIR = new GasMix(AIR_O2);

/**
 * Initial Gas mix
 * 
 * @type {GasMix}
 */
export const FIRSTMIX = conf.dc.mixes.length ? GasMix.from(conf.dc.mixes[0]) : AIR;

/**
 * Represents a Dive site with environment and location
 * 
 */
class DiveSite
{
    /**
     * Site location
     * 
     * @type {GeoPoint}
     */
    pos;
    /**
     * DiveSite environment
     * 
     * @type {DiveSiteEnv}
     */
    env;

    /**
     * Creates a instance using current GPS location
     * 
     * @returns {DiveSite}
     */
    static current()
    {
        return new DiveSite(gps.last.pos);
    }

    /**
     * 
     * @param {GeoPoint} point 
     */
    constructor(point)
    {
        this.pos = point;
        let alt  = point.alt ?? 0;
        this.env = DiveSiteEnv.fromAlt(alt);
        Object.freeze(this);
    }
}

/**
 * Represents a DiveSite environment conditions
 */
class DiveSiteEnv
{
    /**
     * Surface pressure
     * 
     * @type number
     */
    sp;
    /**
     * In salt water?
     * 
     * @type boolean
     */
    sw;
    /**
     * Altitude level
     * 
     * @type int
     */
    alt;

    /**
     * Creates a instance using altitude given
     * 
     * @returns {DiveSiteEnv}
     */
    static fromAlt(alt)
    {
        let sp = (SEALEVEL_PRESSURE * Math.exp(-alt / 7800.0));
        return new DiveSiteEnv(sp);
    }

    /**
     * Returns water specific weight factor for bar/depth conversions
     * 
     * @param {boolean} sw Salt water?
     * @returns number
     */
    static waterWeight(sw)
    {
        // P=dgh => (density * 9.81) / 100000
        return sw ? .101043 : .0981;
    }

    /**
     * Constructor
     * 
     * If surface pressure is too above sea, "salt" is forced to false
     * 
     * @param {number} sp Surface pressure
     * @param {boolean} salt Salt water?
     */
    constructor(sp = SEALEVEL_PRESSURE, salt = conf.dc.salt)
    {
        this.sp  = sp;
        this.alt = (10 - this.sp * 10).intVal();
        // If in altitude, then is fresh water!
        this.sw  = this.alt > 0 ? false : salt;
        Object.freeze(this);
    }

    /**
     * Is altitude considered?
     * 
     * @type boolean
     */
    get inAlt()
    {
        return this.alt > 0;
    }

    /**
     * Water "name"
     * 
     * @type string
     */
    get water()
    {
        return this.sw ? 'salt' : 'fresh';
    }

    /**
     * Converts a depth between this environment and another
     * 
     * @param {number} d Depth, in bars, in current env
     * @param {DiveSiteEnv} env Dest env
     */
    depthTo(d, env)
    {
        let bar = this.pressureAt(d);
        return env.depthAt(bar);
    }

    /**
     * Returns the depth, in meters, corresponding given pressure
     * 
     * @param {number} bar Abolsoute pressure, in bar
     * @returns number
     */
    depthAt(bar)
    {
        let ww = DiveSiteEnv.waterWeight(this.sw);
        let d  = (bar - this.sp) / ww;
        return d;
    }

    /**
     * Returns absolute pressure, in bar, at given depth considering
     * environment
     * 
     * @param {number} d Depth, in meters
     * @returns number
     */
    pressureAt(d)
    {
        // Pt = P0 + d * g * h
        let ww = DiveSiteEnv.waterWeight(this.sw);
        let bar = ww * d + this.sp;
        return bar;
    }
}
const SEAWATER_ENV = new DiveSiteEnv(SEALEVEL_PRESSURE, true);

/**
 * Represents a Dive Computer
 * 
 */
class DC extends EventTarget
{
    /**
     * @type {Dive}
     */
    #dive;
    /**
     * @type number
     */
    #depth;
    /**
     * @type {DesatState}
     */
    #desat;
    /**
     * @type number
     */
    #active;
    /**
     * Last track's divesite
     * 
     * When isn't inDive mode, should be null
     * 
     * @type {DiveSite}
     */
    #site;

    /**
     * 
     */
    constructor()
    {
        super();
        this.#desat = new DesatState();

        var me = this;
        setInterval(() => { // Saves dives in desat periodcally
            me.#updateDesat();
        }, conf.track.calcPos * 10);
    }

    /**
     * Sets depth to DC
     * 
     * If DC is in idle state and depth >= 1, a dive will be created and started
     * 
     * If a depth was < 1 greater or equal 3 minutes, current dive will be ended.
     * 
     * @type number
     */
    set depth(d)
    {
        let inDive  = this.inDive;
        this.#depth = Math.max(d, 0);

        if (!inDive && this.#depth >= 1) {
            var me = this;
            this.dispatchEvent(new CustomEvent('alert', {
                detail: {
                    type:   'nodive',
                    active: me.#desat.noDive > 0
                }
            }));

            this.#dive = new Dive(this.curSite);
            this.#dive.addEventListener('end', async (e) => {
                me.#desat.save(e.target);
                me.#site = null;
            });
            this.dispatchEvent(new Event('dive'));

            this.#dive.start(FIRSTMIX, this.#desat.rng);
            this.#updateDesat();
            inDive = true;
        }
        if (inDive) {
            this.#dive.depth = this.#depth;
            if (this.#depth >= 1) {
                this.#active = this.#dive.durMin;
            }
            else if (this.#active && (this.#dive.durMin - this.#active) >= END_TIME) {
                this.#dive.end();
                this.#active = null;
            }
        }
    }

    /**
     * Update DC using a Track
     * 
     * @param {Track} track
     * @return self
     */
    update(track)
    {
        if (track.active) {
            let depth  = (track.first.alt - track.pos.alt);
            this.depth = depth;
            if (!this.inDive) {
                this.#site = new DiveSite(track.pos);
            }
        }
        else {
            this.#site = null;
        }
        return this;
    }

    /**
     * Returns a structured object with current DC properties joined with     * 
     * a list of possible no-deco dives
     * 
     * Considers just start gas defined
     * 
     * @returns object
     */
    plan()
    {
        let env = this.curSite.env;
        let mix = FIRSTMIX;
        let rg  = this.#desat.rng;
        let od  = mix.operDepthRange(env);
        let mod = od.max.round().intVal();

        let res = {
            rg: rg, mix: mix.id, mod: mod, pO2: mppO2,
            water: env.water, sp: env.sp,
            dives: [],
        };

        let depth = 10; // environment depth
        let plan  = {};
        let apox  = od.min > 0;
        while (!apox) {
            let ead  = DecoCalc.etd(depth, mix, env);
            let rnt  = DecoCalc.rnt(rg, ead);
            let time = DecoCalc.ndl(ead) - rnt;
            if (time <= 0 || depth > mod) {
                break;
            }
            plan[time] = {depth: depth++, ndl: time, rnt: rnt, ead: parseInt(ead)};
        }

        res.dives = Object.values(plan);
        return res;
    }

    /**
     * @type {DiveSite}
     */
    get curSite()
    {
        return this.#site ?? DiveSite.current();
    }

    /**
     * Is DC in dive mode?
     * 
     * Will be a cosidered "dive mode" a existant dive not finished
     * 
     * @type boolean
     */
    get inDive()
    {
        return !!this.#dive && this.#dive.active;
    }

    /**
     * Is DC in desaturing mode?
     * 
     * True if there isn't a active dive and desaturing state is not finished
     * 
     * @type boolean
     */
    get isDesat()
    {
        return this.#desat.is();
    }

    /**
     * Current/Last dive or null
     * 
     * @type {Dive}
     */
    get dive()
    {
        return this.#dive;
    }

    /**
     * Current depth
     * 
     * @type number
     */
    get depth()
    {
        return this.#depth;
    }

    /**
     * Desaturing state
     * 
     * @type {DesatState}
     */
    get desatState()
    {
        return this.#updateDesat().state();
    }

    /**
     * 
     * @returns {DesatState}
     */
    #updateDesat()
    {
        if (this.inDive) {
            this.#desat.save(this.#dive);
        }
        return this.#desat;
    }
}

/**
 * Auxiliar class to manage Desaturation state
 */
class DesatState
{
    /**
     * Last dive data
     */
    #last

    /**
     * Loads last dive from storage
     */
    constructor()
    {
        try {
            // Try to load last dive from Storage
            let json   = localStorage[DESAT_STORAGE];
            this.#last = JSON.parse(json);
            this.si; // Clean if applicable

            if (this.#last && this.#last.active) {
                alert("WARNING!!!!\n\nLast dive wasn't finished correctaly!! Desaturation state could be wrong!!!");
            }
        } catch (e) {
            this.#last = null;
            console.log(e);
        }
    }

    /**
     * Saves a dive as last dive
     * 
     * @param {Dive} dive 
     * @return self
     */
    save(dive)
    {
        if (!dive.started) {
            return this;
        }

        let decoState = dive.decoState;
        let mult   = this.is();
        this.#last = {
            end:    dive.ended ? dive.endDate.getTime() : Date.now(),
            group:  decoState.group,
            desat:  decoState.desat,
            noDive: 0,
            noFly:  DAYMIN * (mult ? .75 : .5), // Single dives: 12hrs - Multiple dives / days: 18hrs
            active: !dive.ended
        }

        let stop = dive.decoStops.hasMissed();
        let req  = dive.decoStops.hasRequired();
        if (stop) { // Missed required stop!
            this.#last.noDive = DAYMIN;
            this.#last.noFly  = DAYMIN;
        }
        else if (req) { // Required stop (so, NDT exceeded)
            this.#last.noDive = (DAYMIN * .25);
            this.#last.noFly  = DAYMIN;
        }

        // Saves data to next dive retrieves as residual
        localStorage.setItem(DESAT_STORAGE, JSON.stringify(this.#last));
        return this;
    }

    /**
     * Is there a last dive?
     * 
     * @returns boolean
     */
    has()
    {
        return !isFinite(this.si);
    }

    /**
     * Is desaturing?
     * 
     * @returns boolean
     */
    is()
    {
        return isFinite(this.si) && !this.#last.active;
    }

    /**
     * Current SI, in minutes
     * 
     * If SI greater than 1 day, clean state
     * 
     * Returns Infinity if no state
     * 
     * @type number
     */
    get si()
    {
        if (this.#last) {
            let dt = parseInt((Date.now() - this.#last.end) / 60000);
            if (dt <= DAYMIN) {
                return dt;
            }
            this.#remove();
        }
        return Infinity;
    }

    /**
     * Returns current deco group using current SI
     * 
     * If there isnt a dive, returns null (no group)
     * 
     * @type string
     */
    get rng()
    {
        let si = this.si;
        if (isFinite(si)) {
            return DecoCalc.regroup(si, this.#last.group);
        }
        return null;
    }

    /**
     * Returns time left to total desaturation
     * 
     * @type int
     */
    get desat()
    {
        let si = this.si;
        if (isFinite(si)) {
            return Math.max(0, this.#last.desat - si);
        }
        return 0;
    }

    /**
     * Returns current no fly time.
     * 
     * If last dive has missed stops, no-fly is 24 hours. Else, 18 hours.
     * 
     * @type int
     */
    get noFly()
    {
        let si = this.si;
        if (isFinite(si)) {
            return Math.max(0, this.#last.noFly - si);
        }
        return 0;
    }

    /**
     * Returns current No-Dive time
     * 
     * If in last dive dangerous events occured, a repetitive dive
     * must be avoided.
     * 
     * @type int
     */
    get noDive()
    {
        let si = this.si;
        if (isFinite(si) && this.#last.noDive) {
            return Math.max(0, this.#last.noDive - si);
        }
        return 0;
    }

    /**
     * Take a snapshot of current object state
     * 
     * @returns {DesatState}
     */
    state()
    {
        return Object.enumGetters(this);
    }

    /**
     * Remove from storage
     */
    #remove()
    {
        localStorage.removeItem(DESAT_STORAGE);
        this.#last = null;
    }
}

/**
 * Represents a Dive
 * 
 */
class Dive extends EventTarget
{
    /**
     * Dive start TS, in seconds
     */
    #start = 0;
    /**
     * Dive's duration (if termined) in seconds
     */
    #end;
    /**
     * Residual nitrogen group and time end [g, t]
     */
    #rng;
    /**
     * Depth state
     */
    #depth = {
        cur: 0, max: 0, avg: 0, speed: 0, active: 0
    }
    /**
     * Breathing mixes used
     */
    #mixes = [];
    /**
     * @type {DecoStops}
     */
    #decoStops;
    /**
     * @type {DiveSite}
     */
    #site;

    /**
     * 
     * @param {DiveSite} site DiveSite environment
     */
    constructor(site)
    {
        super();
        this.#decoStops = new DecoStops(this);
        this.#site = site;
    }

    /**
     * Starts dive
     * 
     * @param {GasMix} mix First tank's mix
     * @param {string} rng Residual nitrogen group
     * @returns self
     */
    start(mix, rng = null)
    {
        if (!this.#start) {
            this.#start = parseInt(Date.now() / 1000);
            this.#rng   = [rng, 0];
            this.dispatchEvent(new Event('start'));
            this.changeMix(mix);
        }
        return this;
    }

    /**
     * Ends dive
     * 
     * @returns self
     */
    end()
    {
        if (this.active) {
            this.#end = this.durSec;
            this.dispatchEvent(new Event('end'));
        }
        return this;
    }

    /**
     * Changes current gas mix
     * 
     * @param {GasMix} mix Gas mix
     * @returns self
     */
    changeMix(mix)
    {
        if (this.active) {
            let curMix = this.curMix;
            if (curMix && !mix.equals(curMix)) { // If gas change...
                // Lets to consider this change like a repetitive dive without SI
                // So, we update residual group to current group
                this.#rng = [this.decoState.group, this.durMin];
            }
            // Add mix
            this.#mixes.push(mix);
            this.#depth.mod = mix.operDepthRange(this.#site.env);
            this.#depth.mnd = mix.mnd(this.#site.env);

            // Send event...
            this.dispatchEvent(new CustomEvent('event', {
                detail: 'gaschange'
            }));
        }
        return this;
    }

    /**
     * Returns next not used Gas mix defined, or null (no more gases)
     * 
     * @returns {GasMix}
     */
    nextMix()
    {
        let i = this.#mixes.length;
        if (conf.dc.mixes[i]) {
            let mix = GasMix.from(conf.dc.mixes[i]);
            return mix;
        }
        return null;
    }

    /**
     * Checks if given mix could be used in this dive, considering current depth
     * and environment conditions
     * 
     * @param {GasMix} mix Gas mix
     * @return boolean
     */
    isMixUsable(mix)
    {
        return mix.canUseIn(this.#depth.cur, this.#site.env);
    }
    
    /**
     * Dive's ID
     * 
     * @type int
     */
    get id()
    {
        return this.#start;
    }

    /**
     * Sets dive depth
     * 
     * @param {number} d
     */
    set depth(d)
    {
        if (!this.active) {
            return;
        }

        let dur       = this.durSec;
        let prevDepth = this.#depth.cur;

        this.#depth.cur = Math.max(d, 0);
        this.#depth.max = Math.max(this.#depth.cur, this.#depth.max);

        if (this.#depth.last) {
            let dt = (dur - this.#depth.last);
            let dd = this.#depth.cur - prevDepth;
            this.#depth.speed = Math.round(dd / (dt / 60)); // m/min
            this.#depth.avg = Math.avgw(this.#depth.avg, this.#depth.last, this.#depth.cur, dt);
        }
        else {
            this.#depth.avg = this.#depth.cur;
        }
        this.#depth.last = dur; // Time of last depth taken

        let inDeco = this.#decoStops.inDeco;

        if (inDeco) {
            this.dispatchEvent(new CustomEvent('event', {
                detail: 'indeco'
            }));
        }
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Missed required deco stop!
                type:   'stop',
                active: this.#decoStops.hasMissed()
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Out of O2 usable range!
                type:   'mod',
                // Using this way because MOD was calc in changeMix
                active: this.#depth.cur < this.#depth.mod.min || this.#depth.cur > this.#depth.mod.max
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // MND exceeded!
                type:   'mnd',
                active: this.#depth.cur > this.#depth.mnd
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Ascent speed too fast!
                type:  'ascent',
                active: this.#depth.speed < -MAX_SPEED
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Descent speed too fast!
                type:  'descent',
                active: this.#depth.speed > MAX_SPEED
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // NDL exceeded
                type:   'ndt',
                active: !inDeco && !this.ascent && this.decoState.ndt < 0
            }
        }));

        // Let by last...
        this.dispatchEvent(new Event('sample'));
    }

    /**
     * Is dive started?
     * 
     * @type boolean
     */
    get started()
    {
        return !!this.#start;
    }

    /**
     * Is dive ended?
     * 
     * @type boolean
     */
    get ended()
    {
        return !!this.#end;
    }

    /**
     * Is dive active?
     * 
     * @type boolean
     */
    get active()
    {
        return this.#start && !this.#end;
    }

    /**
     * Dive's start date or null
     * 
     * @type {Date}
     */
    get startDate()
    {
        if (this.#start) {
            return new Date(this.#start * 1000);
        }
        return null;
    }

    /**
     * Dive's end date or null
     * 
     * @type {Date}
     */
    get endDate()
    {
        if (this.#end) {
            return new Date((this.#start + this.#end) * 1000);
        }
        return null;
    }

    /**
     * Dive duration in seconds
     * 
     * If active, returns current duration. If ended, dive's duration
     * 
     * @type int
     */
    get durSec()
    {
        if (this.#end) {
            return this.#end;
        }
        else if (this.mockTime) {
            return this.mockTime;
        }
        else if (this.#start) {
            return parseInt(Date.now() / 1000) - this.#start;
        }
        return 0;
    }

    /**
     * Dive duration in minutes
     * 
     * @see durSec
     * @type int
     */
    get durMin()
    {
        return parseInt(this.durSec / 60);
    }

    /**
     * Dive's DiveSite environment
     * 
     * @type {DiveSite}
     */
    get site()
    {
        return this.#site;
    }

    /**
     * Current gas mix or null
     * 
     * @type {GasMix}
     */
    get curMix()
    {
        return this.#mixes.at(-1);
    }

    /**
     * Current depth, in meters
     * 
     * @type number
     */
    get depth()
    {
        return this.#depth.cur;
    }

    /**
     * Current average depth, in meters
     * 
     * @type number
     */
    get avgDepth()
    {
        return this.#depth.avg;
    }

    /**
     * Max depth reach, in meters
     * 
     * @type number
     */
    get maxDepth()
    {
        return this.#depth.max;
    }

    /**
     * Returns the equivalent "table" depth
     * 
     * PADI table expects dives using air at sea level. So, this method
     * converts current dive's depth to this conditions
     * 
     * Todo this, is considered current gas mix, altitude and water type
     * 
     * In mixes containg helium, O2 will be considered narcotic
     * 
     * @param {boolean} avg Use avg depth?
     * @returns number
     */
    etd(avg = true)
    {
        let d = avg ? this.avgDepth : this.depth;
        return DecoCalc.etd(d, this.curMix, this.#site.env);
    }

    /**
     * Returns current Deco State
     * 
     * @type {DecoState}
     */
    get decoState()
    {
        let mixBT = this.durMin - this.#rng[1]; // Use BT of current mix
        let state = new DecoState(this.etd(), mixBT, this.#rng[0]);
        return state;
    }

    /**
     * Total ascent time, in minutes
     * 
     * Considers current depth and eventual REQUIRED deco stops
     * 
     * Uses ASC_SPEED value to calc time
     * 
     * @type int
     */
    get ascTime()
    {
        let d = this.#depth.cur;
        let t = DiveCalc.tts(d);
        t    += Math.ceil(this.#decoStops.stopTime / 60);
        return t;
    }

    /**
     * Is ascent?
     * 
     * @type boolean
     */
    get ascent()
    {
        return this.#depth.speed < 0;
    }

    /**
     * Current speed
     * 
     * If negative, is ascenting
     * 
     * @type number
     */
    get speed()
    {
        return this.#depth.speed;
    }

    /**
     * Get deco stops manager
     * 
     * @return {DecoStops}
     */
    get decoStops()
    {
        return this.#decoStops;
    }
}

/**
 * Deco Stops manager
 * 
 */
class DecoStops
{
    #stops = [];
    #depth;
    #current = -1;
    #stopDepth;

    /**
     * 
     * @param {Dive} dive
     */
    constructor(dive)
    {
        var me = this;
        this._iid = setInterval(() => { // Current stop time decreaser
            if (me.#current < 0) {
                return;
            }
            let cur  = me.#stops[me.#current];
            cur.init = true;
            if (cur.sec > 0) {
                cur.sec--;
            }
            else {
                me.#current = -1;
            }
        }, 1000); // Decreases by second

        // Updates stops in each dive sample
        dive.addEventListener('sample', (e) => {
            me.#update(e.target);
        });

        this.#stopDepth = SEAWATER_ENV.depthTo(5, dive.site.env).round(0).intVal();
    }

    /**
     * Returns current deco stop
     * 
     * A current deco stop is avaiable when dive's depth matches with a deco
     * stop registered
     * 
     * Else, is null
     * 
     * depth: stop's depth
     * sec: remain stop's seconds
     * required: is a required stop?
     * init: stop initiliazed?
     * 
     * @type object
     */
    get current()
    {
        if (this.inDeco) {
            return Object.clone(this.#stops[this.#current]);
        }
        return null;
    }

    /**
     * Returns the next stop using current dive's depth
     * 
     * @type object
     */
    get next()
    {
        let i = this.#findNext();
        if (i < 0) {
            return null;
        }
        let s = this.#stops[i];
        return Object.clone(s);
    }

    /**
     * Total time, in seconds, to complete all REQUIRED stops above
     * 
     * @type int
     */
    get stopTime()
    {
        let t = 0;
        for (let s of this.#stops) {
            if (s.required && this.#depth >= s.depth) {
                t += s.sec;
            }
        }
        return t;
    }

    /**
     * In deco?
     * 
     * @type boolean
     */
    get inDeco()
    {
        return this.#current >= 0;
    }


    /**
     * Checks if any stop was missing
     * 
     * @param {boolean} optional Considers optional stops?
     * @returns boolean
     */
    hasMissed(optional = false)
    {
        for (let s of this.#stops) {
            if (this.#depth >= s.depth || s.sec <= 0) {
                continue;
            }
            if (optional || s.required) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if there is a required stop
     * 
     * @returns boolean
     */
    hasRequired()
    {
        for (let s of this.#stops) {
            if (s.required) {
                return true;
            }
        }
        return false;
    }

    /**
     * Updates manager with dive given
     * 
     * @param {Dive} dive 
     */
    #update(dive)
    {
        this.#depth = parseInt(Math.round(dive.depth));
        let decoState = dive.decoState;

        if (!this.#stops.length && (dive.etd(false) >= 30 || decoState.hasSafetyStop)) { // Safety stop if there's not stop
            this.#addStop(dive, {depth: this.#stopDepth, sec: 3 * 60, required: false});
        }
        if (decoState.emergStop > 0) { // NDL exceeded
            this.#addStop(dive, {depth: this.#stopDepth, sec: decoState.emergStop * 60, required: true});
        }

        this.#current = this.#findCurrent();
    }

    /**
     * Adds or update a stop
     * 
     * A stop will be updated only if it not initialized
     * 
     * It saves just 1 stop by depth
     * 
     * @param {Dive} dive
     * @param {object} s 
     */
    #addStop(dive, s)
    {
        let i    = this.#findByDepth(s.depth);
        let stop = i >= 0 ? this.#stops[i] : null;
        let add  = false;

        function canReplace(s1, s2)
        {
            return !s1.init && s2.sec > s1.sec || (s2.required && !s1.required);
        }

        if (stop && canReplace(stop, s)) {
            stop.sec = Math.max(stop.sec, s.sec);
            stop.required = stop.required || s.required;
            add  = true;
        }
        if (!stop) {
            this.#stops.unshift(s);
            this.#stops.sort((a, b) => {
                if (a.depth > b.depth) {
                    return -1;
                }
                else if (a.depth < b.depth) {
                    return 1;
                }
                return 0;
            });
            add = true;
        }
        if (add) {
            dive.dispatchEvent(new CustomEvent('decoadd', {
                detail: s
            }));
        }
    }

    /**
     * Finds the index of a stop by depth, or -1
     * 
     * @param {int} d Depth
     * @returns int
     */
    #findByDepth(d)
    {
        for (let i = 0; i < this.#stops.length; i++) {
            if (this.#stops[i].depth == d) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Finds current stop index, or -1
     * 
     * @returns int
     */
    #findCurrent()
    {
        let i = this.#findByDepth(this.#depth);
        if (i >= 0 && this.#stops[i].sec > 0) {
            return i;
        }
        return -1;
    }

    /**
     * Finds the index of next stop, or -1
     * 
     * @returns int
     */
    #findNext()
    {
        for (let i = 0; i < this.#stops.length; i++) {
            if (this.#stops[i].sec > 0 && this.#stops[i].depth < this.#depth) {
                return i;
            }
        }
        return -1;
    }
}

/**
 * Auxiliar class to represent a Deco State
 */
class DecoState
{
    #ead;
    #bt;
    #rg;
    #cache  = {};

    /**
     * 
     * @param {number} ead Equiv Air Depth
     * @param {number} bt Bottom time, in minutes
     * @param {string} rg Residual group
     */
    constructor(ead, bt, rg = null)
    {
        this.#ead   = parseFloat(ead);
        this.#bt    = parseInt(bt);
        this.#rg    = rg;
        this.#cache = {};
    }

    /**
     * No-deco limit, adjusted with RNT. In minutes
     * 
     * @type {int}
     */
    get ndl()
    {
        return this.#get('ndl', () => {
            return Math.max(DecoCalc.ndl(this.#ead) - this.rnt, 0);
        });
    }

    /**
     * No-deco time: NDL - BT, in minutes
     * 
     * If negative, NDL was exceeded
     * 
     * @type {int}
     */
    get ndt()
    {
        return this.#get('ndt', () => {
            return this.ndl - this.#bt;
        });
    }

    /**
     * Bottom time, in minutes
     * 
     * @type {int}
     */
    get bt()
    {
        return this.#bt;
    }

    /**
     * Total bottom time: BT + RNT, in minutes
     * 
     * @type {int}
     */
    get tbt()
    {
        return this.#bt + this.rnt;
    }

    /**
     * Current pressure group
     * 
     * @type {string}
     */
    get group()
    {
        return this.#get('group', () => {
            return DecoCalc.decoGroup(this.#ead, this.tbt);
        });
    }

    /**
     * Is safety stop required?
     * 
     * @type {boolean}
     */
    get hasSafetyStop()
    {
        return this.#get('safe', () => {
            return this.ndt >= 0 && DecoCalc.safetyStop(this.#ead, this.group);
        });
    }

    /**
     * Minutes at 5m to do a emergency stop (NDL exceeded)
     * 
     * @type {int}
     */
    get emergStop()
    {
        return this.#get('emerg', () => {
            let ndt = this.ndt;
            if (ndt < -5) {
                return 15;
            }
            else if (ndt < 0) {
                return 8;
            }
            return 0;
        });
    }

    /**
     * Desaturation time, in minutes
     * 
     * @type {int}
     */
    get desat()
    {
        return this.#get('desat', () => {
            return DecoCalc.desat(this.group);
        });
    }

    /**
     * Residual nitrogen time, in minutes
     * 
     * @type {int}
     */
    get rnt()
    {
        return this.#get('rnt', () => {
            return DecoCalc.rnt(this.#rg, this.#ead);
        });
    }

    #get(p, f)
    {
        if (!this.#cache[p]) {
            this.#cache[p] = f.bind(this)();
        }
        return this.#cache[p];
    }
}

export const dc = new DC();
