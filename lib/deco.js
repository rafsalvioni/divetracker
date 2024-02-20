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

/**
 * PADI Table depths as absolute pressures in bar (sea level / salt water)
 * 
 * (10,12,14,16,18,20,22,25,30,35,40,42)
 * 
 * @type {float[]}
 */
const DIVE_BARS = [
    2.02343, 2.22552, 2.42760, 2.62969, 2.83177, 3.03386,
    3.23595, 3.53907, 4.04429, 4.54951, 5.05472, 5.25681
];
/**
 * Depths NDL, in minutes
 * 
 * @type {int[]}
 */
const DIVE_NDL  = [219, 147, 98, 72, 56, 45, 37, 29, 20, 14, 9, 8];
/**
 * Surface interval, in minutes, to total desaturation
 * 
 * @type int
 */
const MAX_SI    = 360;

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
     * Get NDL for given depth (in pressure)
     *
     * Uses interpolation to resolve depths outside table, for better resolution
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @returns int
     */
    static ndl(absBar)
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
            return interpolate(DIVE_BARS.at(i), DIVE_NDL.at(i), DIVE_BARS.at(j), DIVE_NDL.at(j), x);
        }
        
        for (let i = 1; i < DIVE_BARS.length; i++) {
            if (absBar >= DIVE_BARS[i - 1] && absBar <= DIVE_BARS[i]) { // If we found boundary...
                return calc(i - 1, i, absBar);
            }
        }
        if (absBar < DIVE_BARS[0]) { // Depth < 10m
            return calc(1, 0, absBar);
        }
        // Depth > 42m
        return calc(-2, -1, absBar);
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
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix)
    {
        if (dTime > 0) {
            const airBar = DsatDecoModel.eap(absBar, mix);

            this.#data.last   = absBar;
            this.#data.ndl    = DsatDecoModel.ndl(airBar);
            this.#data.satur += dTime / (this.#data.ndl * 60);
            this.#cache       = {};
        }
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
        const bar = SEAWATER_ENV.pressureAt(5); // Stop depth in bar

        let sec      = 0;
        let required = false;

        switch (true) {
            case bar > this.#data.last: // Stop below current depth. Do nothing...
                break;
            case ndt < -5: // NDT exceeded more than 5 min
                sec = 15 * 60;
                required = true;
                break;
            case ndt < 0: // NDT exceeded NO more than 5 min
                sec = 8 * 60;
                required = true;
                break;
            case ndt <= 20: // Safe stop
                sec = 180; // 3 min
                break;
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
            if (!this.#data.satur) {
                return Infinity;
            }

            let ndl = this.#data.ndl; // NDL for current pressure
            ndl -= (ndl * this.#data.satur); // Remove saturation for NDL
            return ndl.round().intVal();
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
            return (this.#data.satur * MAX_SI).round().intVal();
        });
    }
    
    /**
     * Applies a surface interval
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        const satur = this.#data.satur;
        const desat = this.desat();
        this.#reset();
        if (desat) {
            this.#data.satur = satur * Math.max(1 - (si / desat), 0);
        }
        this.#cache = {};
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
        this.#data = Object.clone(state);
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
            last: this.#sp, satur: 0, ndl: Infinity
        };
    }
}
