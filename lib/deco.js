import "./proto.js";
import { AIR, ASC_SPEED, DESC_SPEED, GasMix, SEALEVEL_PRESSURE, SEAWATER_ENV } from "./dc.js";

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

    /**
     * Creates a test DecoModel at pA and gas mix given
     * 
     * Considers current deco model state. Returns is a new instance deco model
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {GasMix} mix GasMix
     * @returns {DecoModel}
     */
    test(pA, mix)
    {
        const state = this.state();
        const deco  = new this.constructor();
        deco.restore(state);
        deco.addChange(pA, 1, mix);
        return deco;
    }
}

/**
 * PADI Table depths as absolute pressures in bar (sea level / salt water)
 * 
 * (10,12,14,16,18,20,22,25,30,35,40,42)
 * 
 * @type {float[]}
 */
const DIVE_BARS  = [
    2.02343, 2.22552, 2.42760, 2.62969, 2.83177, 3.03386,
    3.23595, 3.53907, 4.04429, 4.54951, 5.05472, 5.25681
];
/**
 * Depths NDL, in minutes
 * 
 * @type {int[]}
 */
const DIVE_NDL   = [219, 147, 98, 72, 56, 45, 37, 29, 20, 14, 9, 8];
/**
 * Surface interval, in minutes, to total desaturation
 * 
 * PADI's table give us 360 min to go from Z group to A
 * 
 * @type int
 */
const MAX_SI     = 360;
/**
 * How much saturation percent we lose in sealevel pressure, by minute?
 * 
 * @type float
 */
const DESAT_RATE = 1 / MAX_SI;

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
     * 
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
        function calc(i, j, x)
        {
            return Math.interpolate(
                DIVE_BARS.at(i), DIVE_NDL.at(i), DIVE_BARS.at(j), DIVE_NDL.at(j), x
            );
        }
        
        if (absBar < DIVE_BARS[0]) { // Depth < 10m
            return calc(0, 1, absBar);
        }
        for (let j = 1; j < DIVE_BARS.length; j++) {
            let i = j - 1;
            if (absBar >= DIVE_BARS[i] && absBar <= DIVE_BARS[j]) { // If we found boundary...
                return calc(i, j, absBar);
            }
        }
        // Depth > 42m
        return calc(-2, -1, absBar);
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
        this.#cache  = {};
        const airBar = mix.ead(absBar);

        this.#data.last = absBar;
        if (absBar > this.#sp) { // In depth
            this.#data.ndl  = DsatDecoModel.ndl(airBar);
            // On Gas
            this.#data.satur += dTime / (this.#data.ndl * 60);
        }
        else {
            this.#data.ndl = Infinity;
        }
        // Off Gas
        this.#applyDesat(dTime, airBar);
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
            const ndl = this.#data.ndl; // NDL for current pressure
            if (!isFinite(ndl)) {
                return Infinity;
            }

            const rnt = (ndl * this.#data.satur);
            const ndt = ndl - rnt;
            return ndt.round().intVal();
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
            // Max SI considers sealevel. So, lets apply altitude factor. Less SP, desat faster
            const spF = this.#sp / SEALEVEL_PRESSURE;
            return (this.#data.satur * MAX_SI * spF).round().intVal();
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
        this.#reset();
        this.#data.satur = satur;
        this.addChange(this.#sp, si * 60, AIR);
    }

    /**
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {GasMix} mix GasMix
     * @returns {DecoModel}
     */
    test(pA, mix)
    {
        const dd    = (pA - this.#data.last - this.#sp) * 10;
        const dt    = (dd / (dd >= 0 ? DESC_SPEED : -ASC_SPEED)) * 60;
        const state = this.state();
        const deco  = new DsatDecoModel(this.#sp);
        deco.restore(state);
        deco.addChange(pA, dt, mix);
        return deco;
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
        this.#data  = Object.clone(state);
        this.#cache = {};
    }

    /**
     * Applies a desaturation at current state
     * 
     * Could be used to do a SI (using surface pressure as absBar) or
     * a off gas at depth
     * 
     * @param {number} dTime Time, in seconds
     * @param {number} airBar EAD in bar
     */
    #applyDesat(dTime, airBar)
    {
        // Original rate is at sea level using AIR...
        const rate  = DESAT_RATE * (SEALEVEL_PRESSURE / airBar);
        const desat = (dTime / 60) * rate;
        this.#data.satur = Math.max(this.#data.satur - desat, 0);
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
        this.#cache = {};
        this.#data  = {
            last: this.#sp, satur: 0, ndl: Infinity
        };
    }
}
