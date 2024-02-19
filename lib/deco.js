import "./proto.js";
import { AppConfig as conf } from "../bin/config.js";
import { AIR_N2, DAYMIN, GasMix, SEALEVEL_PRESSURE, SEAWATER_ENV } from "./dc.js";

/**
 * Base class for Deco Models
 * 
 */
export class DecoModel
{
    /**
     * Add a depth/pressure change
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix)
    {
    }
    
    /**
     * Adds time to last depth/pressure
     * 
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addTime(dTime, mix)
    {
        this.addChange(0, dTime, mix);
    }

    /**
     * Returns deco stops
     * 
     * @returns {stop[]}
     */
    stops()
    {
        return [];
    }

    /**
     * Returns time to complete current stops, in minutes
     * 
     * @param {boolean} opt Considers optional stops?
     * @returns number
     */
    stopTime(opt = false)
    {
        let time = 0;
        for (const s of this.stops()) {
            if (opt || s.required) {
                time += (s.sec / 60);
            }
        }
        return time;
    }

    /**
     * Current NDT, in minutes
     * 
     * @returns number
     */
    ndt()
    {
        return Infinity;
    }
    
    /**
     * Desaturation time, in minutes
     * 
     * @returns number
     */
    desat()
    {
        return 0;
    }
    
    /**
     * Applies a surface interval
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
    }
    
    /**
     * Saves deco state
     * 
     * @returns object
     */
    state()
    {
        return {};
    }
    
    /**
     * Restores a saved state
     * 
     * @param {object} state Saved state
     */
    restore(state)
    {
    }
}

// *************** PADI AIR DIVE TABLE *****************
// Padi depths as absolute pressures in bar (10,12,14,16,18,20,22,25,30,35,40,42)
const DIVE_BARS   = [2.02343, 2.22552, 2.42760, 2.62969, 2.83177, 3.03386, 3.23595, 3.53907, 4.04429, 4.54951, 5.05472, 5.25681];
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
    Array(DECO_GROUP.length).fill(720) // +
];

/**
 * Deco Model using PADI Air Table (DSAT)
 */
export class DsatDecoModel extends DecoModel
{
    /**
     * @type object
     */
    #data;
    /**
     * Surface pressure, in bars
     * @type number
     */
    #sp;
    /**
     * @type object
     */
    #cache = {};
    
    /**
     * Get table bar index
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @returns int
     */
    static getBarIndex(absBar)
    {
        for (let i = 0; i < DIVE_BARS.length; i++) {
            if (absBar <= DIVE_BARS[i]) {
                return i;
            }
        }
        return -1;
    }
    
    
    /**
     * Get NDL for given depth (in pressure)
     *
     * Uses interpolation to resolve depths outside table, for better resolution
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @returns int
     */
    static ndl(avgBar)
    {
        function interpolate(x1, y1, x2, y2, x)
        {
            if (x1 == x2) { // Avoid division by zero
                return y1;
            }
            let d = (x - x1) / (x2 - x1);
            let y = y1 + d * (y2 - y1);
            return y;
        }
        
        function calc(i, j, x)
        {
            return interpolate(DIVE_BARS.at(i), DIVE_TIMES.at(i).at(-1), DIVE_BARS.at(j), DIVE_TIMES.at(j).at(-1), x);
        }
        
        for (let i = 1; i < DIVE_BARS.length; i++) {
            if (avgBar >= DIVE_BARS[i - 1] && avgBar <= DIVE_BARS[i]) { // If we found boundary...
                return calc(i - 1, i, avgBar);
            }
        }
        if (avgBar < DIVE_BARS[0]) { // Depth < 10m
            return calc(1, 0, avgBar);
        }
        // Depth > 42m
        return calc(-2, -1, avgBar);
    }
    
    /**
     * Converts a depth pressure using given mix, to its equivalent using AIR
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @param {GasMix} mix Gas mix
     * @param {boolean} o2narco Is O2 narcotic?
     * @returns number
     */
    static eap(absBar, mix, o2narco = conf.dc.o2narco)
    {
        let fN = 1;
        switch (mix.id) {
            case 'air':
                break;
            default:
                fN = mix.he > 0 && o2narco ? 1 - mix.he : mix.n2 / AIR_N2;
        }
        return absBar * fN;
    }
    
    /**
     * Returns RNT to group and pressure (depth) given
     * 
     * @param {string} rg Residual group
     * @param {number} absBar Absolute pressure, in bar
     * @returns int
     */
    static rnt(rg, absBar)
    {
        let gi = DECO_GROUP.indexOf(rg);
        if (gi < 0) {
            return 0;
        }

        let di = DsatDecoModel.getBarIndex(absBar);
        if (DIVE_TIMES[di] && DIVE_TIMES[di][gi]) {
            return DIVE_TIMES[di][gi];
        }
        return DAYMIN * .5;
    }
   
    /**
     * 
     * @param {number} sp Surface pressure, in bar
     */
    constructor(sp = SEALEVEL_PRESSURE)
    {
        super();
        this.#sp = sp;
        this.#reset();
    }
    
    /**
     * Current bottom time, in minutes
     * 
     * @type number
     */
    get bt()
    {
        return (this.#data.time / 60).intVal();
    }
    
    /**
     * Current total bottom time (BT + RNT), in minutes
     * 
     * @type number
     */
    get tbt()
    {
        return this.bt + this.#data.rnt;
    }
    
    /**
     * Current average pressure, in bar
     * 
     * @type number
     */
    get avgBar()
    {
        return this.#data.bar;
    }
    
    /**
     * Current deco group
     * 
     * @return string
     */
    get group()
    {
        return this.#lazyGet('group', () => {
            const tbt    = this.tbt;
            const absBar = this.avgBar;
            
            if (tbt <= 0 || absBar <= this.#sp) {
                return this.#data.rg;
            }
    
            let di = DsatDecoModel.getBarIndex(absBar);
            if (di >= 0) {
                const TIMES = DIVE_TIMES[di];
                for (let i = 0; i < TIMES.length; i++) {
                    if (tbt <= TIMES[i]) {
                        return DECO_GROUP.charAt(i);
                    }
                }
            }
            return '+';
        });
    }
    
    /**
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix)
    {
        const airBar = DsatDecoModel.eap(absBar, mix);

        this.#data.last  = absBar;
        this.#data.bar   = Math.avgw(this.#data.bar, this.#data.time, airBar, dTime);
        this.#data.time += dTime;
            
        this.#data.rnt = DsatDecoModel.rnt(this.#data.rg, this.avgBar);
        this.#cache    = {};
    }

    /**
     * 
     * @param {number} dTime
     * @param {GasMix} mix 
     */
    addTime(dTime, mix)
    {
        this.addChange(this.#data.last, dTime, mix);
    }

    /**
     * 
     * @returns {stop[]}
     */
    stops()
    {
        const ndt = this.ndt();
        const bar = SEAWATER_ENV.pressureAt(5) - SEAWATER_ENV.sp + this.#sp; // Bar at current SP
        let sec;
        let required;

        if (bar > this.#data.last) {
            sec = 0;
            required = false;
        }
        else if (ndt < -5) {
            sec = 15 * 60;
            required = true;
        }
        else if (ndt < 0) {
            sec = 8 * 60;
            required = true;
        }
        else {
            const gi = DECO_GROUP.indexOf(this.group);
            const di = DsatDecoModel.getBarIndex(this.avgBar);
            let safe = true;
            if (DIVE_TIMES[di] && DIVE_TIMES[di][gi]) {
                safe = DIVE_TIMES[di][gi] >= SAFE_TIME[di];
            }
            if (safe) {
                sec = 180; // 3 min
                required = false;
            }
        }
        if (sec > 0) {
            return [{bar, sec, required}];
        }
        return [];
    }
    
    /**
     * Current NDT, in minutes
     * 
     * @returns number
     */
    ndt()
    {
        return this.#lazyGet('ndt', () => {
            const absBar = this.avgBar;
            if (absBar <= this.#sp) {
                return Infinity;
            }

            const ndl = DsatDecoModel.ndl(absBar).round().intVal();
            return (ndl - this.tbt);
        });
    }
    
    /**
     * Desaturation time, in minutes
     * 
     * @returns number
     */
    desat()
    {
        return this.#lazyGet('desat', () => {
            const g = this.group;
            let gi  = DECO_GROUP.indexOf(g);
            if (gi >= 0) {
                return DECO_SI[gi].at(-1);
            }
            return 0;
        });
    }
    
    /**
     * Applies a surface interval
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        function regroup(si, g)
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
        };

        const rg = regroup(si, this.group);
        this.#reset();
        this.#data.rg = rg;
        this.#cache   = {};
    }
    
    /**
     * Saves deco state
     * 
     * @returns object
     */
    state()
    {
        return Object.assign({}, this.#data);
    }
    
    /**
     * Restores a saved state
     * 
     * @param {object} state Saved state
     */
    restore(state)
    {
        this.#data = state;
    }

    /**
     * 
     * @param {string} key 
     * @param {Function} f 
     * @returns mixed
     */
    #lazyGet(key, f)
    {
        if (!(key in this.#cache)) {
            this.#cache[key] = f.bind(this)();
        }
        return this.#cache[key];
    }

    /**
     * Reset state
     */
    #reset()
    {
        this.#data = {
            bar: 0, time: 0,
            rg: null, rnt: 0,
            last: this.#sp
        };
    }
}
