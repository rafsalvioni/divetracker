import "./proto.js";
import { AIR, ASC_SPEED, DAYMIN, DESC_SPEED, GasMix, SEALEVEL_PRESSURE, SEAWATER_ENV } from "./dc.js";

/**
 * Simple cache manager
 * 
 * @param {object} cache Cache stor
 * @param {string} key Cache key
 * @param {Function} f Function to call
 * @returns mixed
 */
function cacheData(cache, key, f)
{
    if (!(key in cache)) {
        cache[key] = f();
    }
    return cache[key];
}

/**
 * Base class for Dive body effects
 * 
 */
class PhysioEffect
{
    /**
     * Add a depth/pressure change
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix) { throw 'addChange() not implemented';}
    
    /**
     * Adds time to last depth/pressure
     * 
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addTime(dTime, mix) { throw 'addChange() not implemented'; }

    /**
     * Time to reach effect limit, in minutes
     * 
     * @returns number
     */
    timeLeft() { return Infinity; }
    
    /**
     * Minimum SI to reset effect, in minutes
     * 
     * @returns number
     */
    resetAfter() { return 0; }
    
    /**
     * Applies a surface interval
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si) {}
    
    /**
     * Saves deco state
     * 
     * @returns object
     */
    state() { return {}; }
    
    /**
     * Restores a saved state
     * 
     * @param {object} state Saved state
     */
    restore(state) {}

    /**
     * Creates clone effect at pA and gas mix given
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {GasMix} mix GasMix
     * @returns {PhysioEffect}
     */
    test(pA, mix)
    {
        const effect = this.clone();
        effect.addChange(pA, 1, mix);
        return effect;
    }

    /**
     * Clones current effect
     * 
     * @returns {PhysioEffect}
     */
    clone() { throw 'clone() not implemented'; }
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
 * Gas saturation effect
 * 
 * Deco Model using PADI Air Table (DSAT)
 */
class DsatDecoModel extends PhysioEffect
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
     * @param {number} airBar EAD pressure, in bar
     * @returns int
     */
    static #ndl(airBar)
    {
        function calc(i, j, x)
        {
            return Math.interpolate(
                DIVE_BARS.at(i), DIVE_NDL.at(i), DIVE_BARS.at(j), DIVE_NDL.at(j), x
            );
        }
        
        if (airBar < DIVE_BARS[0]) { // Depth < 10m
            return calc(0, 1, airBar);
        }
        for (let j = 1; j < DIVE_BARS.length; j++) {
            let i = j - 1;
            if (airBar >= DIVE_BARS[i] && airBar <= DIVE_BARS[j]) { // If we found boundary...
                return calc(i, j, airBar);
            }
        }
        // Depth > 42m
        return calc(-2, -1, airBar);
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
     * Uses saturation percent
     * 
     * @param {string} hint 
     * @returns mixed
     */
    [Symbol.toPrimitive](hint)
    {
        switch (hint) {
            case 'string':
                return String(this.#data.satur);
            default:
                return this.#data.satur;
        }
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

        this.#data.absBar = absBar;
        if (absBar > this.#sp) { // In depth
            this.#data.ndl  = DsatDecoModel.#ndl(airBar);
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
        this.addChange(this.#data.absBar, dTime, mix);
    }

    /**
     * Returns current deco stops
     * 
     * @returns {stop[]}
     */
    stops()
    {
        const ndt = this.timeLeft();
        const bar = SEAWATER_ENV.pressureAt(5); // Stop depth in bar

        let sec      = 0;
        let required = false;

        switch (true) {
            case bar > this.#data.absBar: // Stop below current depth. Do nothing...
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
    timeLeft()
    {
        return cacheData(this.#cache, 'tl', (() => {
            const ndl = this.#data.ndl; // NDL for current pressure
            if (!isFinite(ndl)) {
                return Infinity;
            }

            const rnt = (ndl * this.#data.satur);
            const ndt = ndl - rnt;
            return ndt.round().intVal();
        }).bind(this));
    }
    
    /**
     * Desaturation time, in minutes
     * 
     * @returns number
     */
    resetAfter()
    {
        return cacheData(this.#cache, 'reset', (() => {
            // Max SI considers sealevel. So, lets apply altitude factor. Less SP, desat faster
            const spF = this.#sp / SEALEVEL_PRESSURE;
            return (this.#data.satur * MAX_SI * spF).round().intVal();
        }).bind(this));
    }
    
    /**
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
     * @returns {PhysioEffect}
     */
    test(pA, mix)
    {
        const dd   = (pA - this.#data.absBar - this.#sp) * 10;
        const dt   = (dd / (dd >= 0 ? DESC_SPEED : -ASC_SPEED)) * 60;
        const deco = this.clone();
        deco.addChange(pA, dt, mix);
        return deco;
    }

    /**
     * 
     * @returns object
     */
    state()
    {
        return Object.clone(this.#data);
    }
    
    /**
     * 
     * @param {object} state Saved state
     */
    restore(state)
    {
        this.#data  = Object.clone(state);
        this.#cache = {};
    }

    /**
     * 
     * @returns {DsatDecoModel}
     */
    clone()
    {
        const clone = new DsatDecoModel(this.#sp);
        clone.restore(this.state());
        return clone;
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
     * Reset state
     */
    #reset()
    {
        this.#cache = {};
        this.#data  = {
            absBar: this.#sp, satur: 0, ndl: Infinity
        };
    }
}

/**
 * Represents a CNS effect
 */
class CNS extends PhysioEffect
{
    #sp;
    #data;
    #cache = {};

    /**
     * Returns NOOA rate to given pO2
     * 
     * @param {number} pO2 pO2 in bar
     * @returns number
     */
    static #rate(pO2)
    {
        const mbar = pO2 * 1000;
        switch (true) {
            case mbar <= 500:
                return 0;
            case mbar <= 1500:
                return Math.exp(-11.7853 + 0.00193873 * mbar);
            default:
                return Math.exp(-23.6349 + 0.00980829 * mbar);    
        }
    }

    /**
     * 
     * @param {number} sp Surface pressure, in bar
     */
    constructor(sp)
    {
        super();
        this.#sp = sp;
        this.#reset();
    }

    /**
     * Uses CNS percent
     * 
     * @param {string} hint 
     * @returns mixed
     */
    [Symbol.toPrimitive](hint)
    {
        switch (hint) {
            case 'string':
                return String(this.#data.val);
            default:
                return this.#data.val;
        }
    }
    
    /**
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix)
    {
        const pO2 = mix.pO2(absBar);
        if (absBar > this.#sp) {
            const rate = CNS.#rate(pO2);
            this.#data.val += dTime * rate;
        }
        else {
            const si = dTime / 60;
            const f  = Math.pow(2, si / 90.0);
            this.#data.val = Math.max(0, this.#data.val / f);
        }
        this.#data.absBar = absBar;
        this.#data.pO2    = pO2;
        this.#cache       = {};
    }
    
    /**
     * 
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addTime(dTime, mix)
    {
        this.addChange(this.#data.absBar, dTime, mix);
    }

    /**
     * Time to reach CNS 100%, in minutes
     * 
     * @returns number
     */
    timeLeft()
    {
        return cacheData(this.#cache, 'tl', (() => {
            const rate = CNS.#rate(this.#data.pO2);
            const cns  = 1.0 - this.#data.val;
            return parseInt((cns / rate) / 60);
        }).bind(this));
    }
    
    /**
     * Minimum SI to reset CNS, in minutes
     * 
     * @returns number
     */
    resetAfter()
    {
        return cacheData(this.#cache, 'reset', (() => {
            const f = Math.log(.5) / Math.log(.004 / this.#data.val);
            return Math.ceil(90 / f).intVal();
        }).bind(this));
    }
    
    /**
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        this.addChange(this.#sp, si * 60, AIR);
    }
    
    /**
     * 
     * @returns object
     */
    state()
    {
        return Object.clone(this.#data);
    }
    
    /**
     * 
     * @param {object} state Saved state
     */
    restore(state)
    {
        this.#data  = Object.clone(state);
        this.#cache = {};
    }

    /**
     * 
     * @returns {CNS}
     */
    clone()
    {
        const clone = new CNS(this.#sp);
        clone.restore(this.state());
        return clone;
    }

    /**
     * Reset state
     */
    #reset()
    {
        this.#data = {
            pO2: AIR.pO2(this.#sp), absBar: this.#sp, val: 0
        };
        this.#cache = {};
    }
}

/**
 * Max OTU in a dive day
 * 
 */
const MAX_OTU = 300;
/**
 * Represents OTU Effect
 */
class OTU extends PhysioEffect
{
    #sp;
    #data;
    #cache = {};

    /**
     * Calculates OTU
     * 
     * @see https://github.com/subsurface/subsurface/blob/345f0570a5d6333927a388fabac8e9784e6c45bb/core/divelist.c#L156
     * @param {number} pO2i 
     * @param {number} pO2f 
     * @param {number} dt DT in seconds
     * @returns number
     */
    static #calcOtu(pO2i, pO2f, dt)
    {
        dt /= 60;
        if (pO2f == pO2i) {
            if (pO2f <= .5) {
                return 0;
            }
            return dt * Math.pow(.5 / (pO2f - .5), -5.0 / 6.0);
        }
        if (Math.max(pO2f, pO2i) <= .5) {
            return 0;
        }
        if (pO2i <= .5) { // For descent segment with po2i <= 500 mbar ..
            dt  *= (pO2f - .5) / (pO2f - pO2i); // .. only consider part with PO2 > 500 mbar
            pO2i = .501; // Mostly important for the dive planner with long segments
        }
        else if (pO2f <= .5) { // For ascent segment with po2f <= 500 mbar ..
            dt  *= (pO2i - .5) / (pO2i - pO2f);
            pO2f = .501; // .. only consider part with PO2 > 500 mbar
        }
        function fO2(pO2)
        {
            return Math.pow((pO2 - .5) / .5, 11.0 / 6.0);
        }
        const fO2i = fO2(pO2i);
        const fO2f = fO2(pO2f);
        return ((3.0 / 11.0 * dt) / (pO2f - pO2i)) * (fO2f - fO2i);
    }
    
    /**
     * 
     * @param {number} sp Surface pressure, in bar
     */
    constructor(sp)
    {
        super();
        this.#sp = sp;
        this.#reset();
    }

    /**
     * Uses OTU value
     * 
     * @param {string} hint 
     * @returns mixed
     */
    [Symbol.toPrimitive](hint)
    {
        switch (hint) {
            case 'string':
                return String(this.#data.val);
            default:
                return this.#data.val;
        }
    }
    
    /**
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addChange(absBar, dTime, mix)
    {
        const pO2 = mix.pO2(absBar);
        if (absBar > this.#sp) {
            const otu = OTU.#calcOtu(this.#data.pO2, pO2, dTime);
            this.#data.val += otu;
        }
        else {
            const si = dTime / 60;
            const f  = 1 - (si / DAYMIN);
            this.#data.val = Math.max(0, this.#data.val * f);
        }
        this.#data.absBar = absBar;
        this.#data.pO2    = pO2;
        this.#cache       = {};
    }
    
    /**
     * 
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     */
    addTime(dTime, mix)
    {
        this.addChange(this.#data.absBar, dTime, mix);
    }

    /**
     * Time to reach 300 OTU, in minutes
     * 
     * @returns number
     */
    timeLeft()
    {
        return cacheData(this.#cache, 'tl', (() => {
            if (this.#data.pO2 < .5) {
                return Infinity;
            }
            const maxTime = MAX_OTU / OTU.#calcOtu(this.#data.pO2, this.#data.pO2, 1);
            const otuLeft = MAX_OTU - this.#data.val;
            return (((otuLeft * maxTime) / MAX_OTU) / 60).intVal();
        }).bind(this));
    }
    
    /**
     * Minimum SI to reset OTU, in minutes
     * 
     * @returns number
     */
    resetAfter()
    {
        return cacheData(this.#cache, 'reset', (() => {
            return ((this.#data.val * DAYMIN) / MAX_OTU).round().intVal();
        }).bind(this));
    }
    
    /**
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        this.addChange(this.#sp, si * 60, AIR);
    }
    
    /**
     * 
     * @returns object
     */
    state()
    {
        return Object.clone(this.#data);
    }
    
    /**
     * 
     * @param {object} state Saved state
     */
    restore(state)
    {
        this.#data  = Object.clone(state);
        this.#cache = {};
    }

    /**
     * 
     * @returns {OTU}
     */
    clone()
    {
        const clone = new OTU(this.#sp);
        clone.restore(this.state());
        return clone;
    }

    /**
     * Reset state
     */
    #reset()
    {
        this.#data  = {
            pO2: AIR.pO2(this.#sp), absBar: this.#sp, val: 0
        };
        this.#cache = {};
    }
}

/**
 * Represents phisiological effects at diver body
 * 
 */
export class BodyState
{
    #effects = {};
    #sp;

    /**
     * 
     * @param {number} sp Surface pressure, in bar
     */
    constructor(sp)
    {
        this.#effects = {
            deco: new DsatDecoModel(sp),
            cns:  new CNS(sp),
            otu:  new OTU(sp)
        };
        this.#sp = sp;
    }

    /**
     * @type {DsatDecoModel}
     */
    get decoModel()
    {
        return this.#effects.deco;
    }

    /**
     * @type {CNS}
     */
    get cns()
    {
        return this.#effects.cns;
    }

    /**
     * @type {OTU}
     */
    get otu()
    {
        return this.#effects.otu;
    }

    /**
     * Add a depth/pressure change
     * 
     * @param {number} absBar Current absolute pressure, in bar
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     * @returns {this}
     */
    addChange(absBar, dTime, mix)
    {
        for (let e in this.#effects) {
            this.#effects[e].addChange(absBar, dTime, mix);
        }
        return this;
    }
    
    /**
     * Adds time to last depth/pressure
     * 
     * @param {number} dTime Time between pressures, in seconds
     * @param {GasMix} mix Gas mix used
     * @returns {this}
     */
    addTime(dTime, mix)
    {
        for (let e in this.#effects) {
            this.#effects[e].addTime(dTime, mix);
        }
        return this;
    }

    /**
     * Applies a surface interval
     * 
     * @param {number} si Surface interval, in minutes
     * @returns {this}
     */
    applySI(si)
    {
        for (let e in this.#effects) {
            this.#effects[e].applySI(si);
        }
        return this;
    }

    /**
     * Returns left time, in minutes, to reach nearest effect
     * 
     * @returns {time, name}
     */
    nearestEffect()
    {
        let time; let name;
        for (let e in this.#effects) {
            const eTime = this.#effects[e].timeLeft();
            if (time === undefined || eTime < time) {
                time = eTime;
                name = e;
            }
        }
        return {time, name};
    }

    /**
     * Time, in minutes, to reset body conditions
     * 
     * @returns number
     */
    resetAfter()
    {
        let time;
        for (let e in this.#effects) {
            const eTime = this.#effects[e].resetAfter();
            if (time === undefined || eTime > time) {
                time = eTime;
            }
        }
        return time;
    }
    
    /**
     * Saves body state
     * 
     * @returns object
     */
    state()
    {
        const state = {};
        for (let e in this.#effects) {
            state[e] = this.#effects[e].state();
        }
        return state;
    }
    
    /**
     * Restores a saved state
     * 
     * @param {object} state Saved state
     * @returns {this}
     */
    restore(state)
    {
        for (let e in this.#effects) {
            this.#effects[e].restore(state[e]);
        }
        return this;
    }

    /**
     * Returns a body state clone with pA and mix applied
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {GasMix} mix Gas mix
     * @returns {BodyState}
     */
    test(pA, mix)
    {
        const clone = this.clone();
        for (let e in this.#effects) {
            clone.#effects[e] = clone.#effects[e].test(pA, mix);
        }
        return clone;
    }

    /**
     * Clones current body state
     * 
     * @returns {BodyState}
     */
    clone()
    {
        const clone = new BodyState(this.#sp);
        clone.restore(this.state());
        return clone;
    }
}
