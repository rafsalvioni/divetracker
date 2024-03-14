import "./proto.js";
import { AIR, AIR_N2, DAYMIN, TimeCalc, DiveSiteEnv, GasMix, SEALEVEL_PRESSURE, SEAWATER_ENV } from "./dc.js";
import { AppConfig as conf } from "../bin/config.js";

/**
 * Returns ideal time to go from a pressure to another, in seconds
 * 
 * If ascent, uses ASC_SPEED. Else DESC_SPEED
 * 
 * @param {DiveSiteEnv} env DiveSite environment
 * @param {number} from From pressure, in bar
 * @param {number} to To pressure, in bar
 * @returns 
 */
function barChangeDT(env, from, to)
{
    const dFrom = env.depthAt(from);
    const dTo   = env.depthAt(to);
    return TimeCalc.dt(dFrom, dTo) * 60;
}

/**
 * Auxiliar class to interpolation
 */
class Interpolator
{
    #p1; #p2;

    /**
     * P1
     * 
     * @param {number} x 
     * @param {number} y 
     */
    p1(x, y) { this.#p1 = {x, y}; }
    /**
     * P2
     * 
     * @param {number} x 
     * @param {number} y 
     */
    p2(x, y) { this.#p2 = {x, y}; }

    /**
     * Calcs interpolation or return d
     * 
     * @param {number} x 
     * @param {number} d
     */
    calc(x, d)
    {
        if (this.#p1 && this.#p2) {
            return Math.interpolate(this.#p1.x, this.#p1.y, this.#p2.x, this.#p2.y, x);
        }
        return d;
    }
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
    addChange(absBar, dTime = null, mix = null) { throw 'addChange() not implemented';}
    
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
     * Clones current effect
     * 
     * @returns {PhysioEffect}
     */
    clone() { throw 'clone() not implemented'; }
}

/**
 * Buhlmann 16C tissues times
 */
const ZHL16C = [
    // N2HalfTime, N2AValue, N2BValue, HeHalfTime, HeAValue, HeBValue
    [  4.0, 1.2599, 0.5050,   1.51, 1.7424, 0.4245],
    [  8.0, 1.0000, 0.6514,   3.02, 1.3830, 0.5747],
    [ 12.5, 0.8618, 0.7222,   4.72, 1.1919, 0.6527],
    [ 18.5, 0.7562, 0.7825,   6.99, 1.0458, 0.7223],
    [ 27.0, 0.6200, 0.8126,  10.21, 0.9220, 0.7582],
    [ 38.3, 0.5043, 0.8434,  14.48, 0.8205, 0.7957],
    [ 54.3, 0.4410, 0.8693,  20.53, 0.7305, 0.8279],
    [ 77.0, 0.4000, 0.8910,  29.11, 0.6502, 0.8553],
    [109.0, 0.3750, 0.9092,  41.20, 0.5950, 0.8757],
    [146.0, 0.3500, 0.9222,  55.19, 0.5545, 0.8903],
    [187.0, 0.3295, 0.9319,  70.69, 0.5333, 0.8997],
    [239.0, 0.3065, 0.9403,  90.34, 0.5189, 0.9073],
    [305.0, 0.2835, 0.9477, 115.29, 0.5181, 0.9122],
    [390.0, 0.2610, 0.9544, 147.42, 0.5176, 0.9171],
    [498.0, 0.2480, 0.9602, 188.24, 0.5172, 0.9217],
    [635.0, 0.2327, 0.9653, 240.03, 0.5119, 0.9267]
];

/**
 * Water vapour
 */
const WSV = .0627;

/**
 * Represents a Buhlmann Tissue
 */
class BuhlmannTissue
{
    /**
     * Tissue times
     */
    #times;
    /**
     * N2 load
     */
    #pN2;
    /**
     * He load
     */
    #pHe;
    /**
     * Initial load
     */
    #pInit;
    
    /**
     * Calc alveolar gas parcial pressure
     * 
     * @param {number} fGas Gas fraction, in decimal
     * @param {number} absBar Absolute pressure, in bar
     * @returns number
     */
    static pAlv(fGas, absBar = SEALEVEL_PRESSURE)
    {
        return fGas * (absBar - WSV);
    }
    
    /**
     * Calcs a gas load using Schreiner Equation
     * 
     * @param {number} pAlv Alveolar pressure, in bar
     * @param {number} gasRate Gas rate, in bar/min
     * @param {number} dTimeMin Delta time, in minutes
     * @param {number} gasHt Gas half time
     * @param {number} initLoad Current load
     * @returns number
     */
    static #calcLoad(pAlv, gasRate, dTimeMin, gasHt, initLoad)
    {
        //P=Palv+R∗(t−1/k)−(Palv−Pi−R/k)∗e−k∗t
        //P = Po + (Pi - Po)(1 - e^-kt)
        const k = Math.log(2) / gasHt;
        return pAlv + gasRate * (dTimeMin - 1 / k) - (pAlv - initLoad - gasRate / k) * Math.exp(-k * dTimeMin);
    }
    
    /**
     * 
     * @param {float[6]} times Tissue times
     * @param {number} sp Surface pressure, in bar
     */
    constructor(times, sp = SEALEVEL_PRESSURE)
    {
        this.#times = times;
        this.#pN2   = BuhlmannTissue.pAlv(AIR_N2, sp);
        this.#pHe   = 0;
        this.#pInit = this.pTotal;
    }
    
    /**
     * Adds a tissue change
     * 
     * Returns load change
     * 
     * @param {{pN2, pHe}} gasRate Gas rate for N2 and He
     * @param {number} dTimeMin Delta time, in minutes
     * @param {{pN2, pHe}} pAlv Alveolar pressure for N2 and He
     * @returns number
     */
    addChange(gasRate, dTimeMin, pAlv)
    {
        const prevLoad = this.pTotal;
        
        this.#pN2 = BuhlmannTissue.#calcLoad(pAlv.pN2, gasRate.n2, dTimeMin, this.n2Ht, this.#pN2);
        this.#pHe = BuhlmannTissue.#calcLoad(pAlv.pHe, gasRate.he, dTimeMin, this.heHt, this.#pHe);
        
        return this.pTotal - prevLoad;
    }
    
    /**
     * Returns tissue's ceiling, in bar
     * 
     * Uses Buhlmann equation extended with gradient factors
     * 
     * @param {number} gf GF
     * @returns number
     */
    ceiling(gf)
    {
        const p = this.pTotal;
        return (p - this.A * gf) / (gf / this.B + 1 - gf);
    }
    
    /**
     * Returns tissue's M-Value
     * 
     * M-Value is the maximun tissue load supported
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @returns number
     */
    mValue(absBar)
    {
        return (absBar / this.B) + this.A;
    }

    /**
     * Calcs current tissue's gradient factor at given pressure
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @returns number
     */
    gf(absBar)
    {
        return (this.pTotal / this.mValue(absBar));
    }

    /**
     * Tissue's saturation percent
     * 
     * @type
     */
    get satur()
    {
        return (this.pTotal - this.#pInit) / this.mValue(SEALEVEL_PRESSURE);
    }

    /**
     * @type number
     */
    get A()
    {
        const a = Math.avgw(this.n2A, this.#pN2, this.heA, this.#pHe);
        return a;
    }
    
    /**
     * @type number
     */
    get B()
    {
        const b = Math.avgw(this.n2B, this.#pN2, this.heB, this.#pHe);
        return b;
    }
    
    /**
     * Tissue's half time
     * 
     * @type number
     */
    get HT()
    {
        const ht = Math.avgw(this.n2Ht, this.#pN2, this.heHt, this.#pHe);
        return ht;
    }
    
    /**
     * Tissue's total pressure loaded
     * 
     * @type number
     */
    get pTotal()
    {
        return this.#pN2 + this.#pHe;
    }
    
    /**
     * Current tissue state
     * 
     * @returns {{pN2, pHe}}
     */
    state()
    {
        return {pN2: this.#pN2, pHe: this.#pHe};
    }
    
    /**
     * Restores a previous state
     * 
     * @param {{pN2, pHe}} state Previous state
     * @returns {this}
     */
    restore({pN2, pHe})
    {
        this.#pN2 = pN2;
        this.#pHe = pHe;
        return this;
    }
    
    /**
     * @type number
     */
    get pN2()  {return this.#pN2;}
    /**
     * @type number
     */
    get pHe()  {return this.#pHe;}
    /**
     * @type number
     */
    get n2Ht() {return this.#times[0];}
    /**
     * @type number
     */
    get n2A()  {return this.#times[1];}
    /**
     * @type number
     */
    get n2B()  {return this.#times[2];}
    /**
     * @type number
     */
    get heHt() {return this.#times[3];}
    /**
     * @type number
     */
    get heA()  {return this.#times[4];}
    /**
     * @type number
     */
    get heB()  {return this.#times[5];}
}

/**
 * Buhlmann deco phase, in meters
 */
const DECO_PHASE = 3;

/**
 * Implements a Buhlmann 16C-GF deco model
 * 
 */
class BuhlmannDecoModel extends PhysioEffect
{
    /**
     * Tissues
     * @type {BuhlmannTissue[]}
     */
    #tissues = [];
    /**
     * Last change
     */
    #last;
    /**
     * @type {DiveSiteEnv}
     */
    #env;
    /**
     * Cache
     */
    #cache   = {};
    /**
     * GF LOW factor
     */
    #gfLow;
    /**
     * GF HIGH factor
     */
    #gfHigh;
    /**
     * Deco phase in bar
     */
    #phaseB;
    
    /**
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @param {number} gfLow GF Low factor
     * @param {number} gfHigh GF High factor
     */
    constructor(env, gfLow = .3, gfHigh = null)
    {
        super();
        for (const data of ZHL16C) {
            this.#tissues.push(new BuhlmannTissue(data, env.sp));
        }
        this.#env    = env;
        this.#last   = {bar: env.sp, mix: AIR};
        this.#gfLow  = gfLow;
        this.#gfHigh = gfHigh ?? this.#gfLow;
        this.#phaseB = env.pressureAt(DECO_PHASE, false);
    }

    /**
     * Returns saturation percent, in decimal
     * 
     * @param {string} hint 
     * @returns mixed
     */
    [Symbol.toPrimitive](hint)
    {
        switch(hint) {
            case 'string':
                return this.desc;
            default:
                return this.satur;
        }
    }

    /**
     * Saturation percent, in decimal
     * 
     * @type number
     */
    get satur()
    {
        return (() => {
            let satur = 0;
            const n = this.#tissues.length;
            for (const tissue of this.#tissues) {
                satur += tissue.satur / n;
            }
            return satur;
        }).bind(this).cache(this.#cache, 'satur');
    }
    
    /**
     * Current GF
     * 
     * @type number
     */
    get gf()
    {
        return (() => {
            let gf = -999;
            for (const tissue of this.#tissues) {
                const t_gf = tissue.gf(this.#last.bar);
                gf = Math.max(gf, t_gf);
            }
            return gf;
        }).bind(this).cache(this.#cache, `gf`);
    }

    /**
     * Can ascend? (using GF High)
     * 
     * @type boolean
     */
    get canAscend()
    {
        return this.ceiling(this.#gfHigh) <= this.#env.sp;
    }

    /**
     * GF description
     * 
     * @type string
     */
    get desc()
    {
        return `${(this.#gfLow * 100).round()}/${(this.#gfHigh * 100).round()}`;
    }

    /**
     * Current GF Low
     * 
     * @type number
     */
    get gfLow()  { return this.#gfLow; }
    /**
     * GF High
     * 
     * @type number
     */
    get gfHigh() { return this.#gfHigh; }
    /**
     * Deco phase, in meters
     * 
     * @type int
     */
    get phaseM() { return DECO_PHASE; }

    /**
     * Returns max tissue ceiling using given GF
     * 
     * @param {number} gf GF
     * @returns number
     */
    ceiling(gf = null)
    {
        gf = gf ?? this.#gfLow;
        return (() => {
            let ceiling = -999;
            for (const tissue of this.#tissues) {
                ceiling = Math.max(ceiling, tissue.ceiling(gf));
            }
            return ceiling;
        }).bind(this).cache(this.#cache, `ceil-${gf}`);
    }

    /**
     * Adds a segment change
     * 
     * Returns tissue's load sum
     * 
     * @param {number} absBar Absolute pressure, in bar
     * @param {number} dTime Delta time, in seconds
     * @param {GasMix} mix Gas mix
     * @returns number
     */
    addChange(absBar, dTime = null, mix = null)
    {
        if (!dTime) {
            dTime = barChangeDT(this.#env, this.#last.bar, absBar);
        }
        if (!mix) {
            mix = this.#last.mix;
        }

        this.#cache    = {};
        const dTimeMin = dTime / 60;
        const prevBar  = this.#last ? this.#last.bar : this.#env.sp;
        const barRate  = dTimeMin ? (absBar - prevBar) / dTimeMin : 0;
        const gasRate  = {n2: barRate * mix.n2, he: barRate * mix.he};
        const pAlv     = {
            pN2: BuhlmannTissue.pAlv(mix.n2, prevBar), pHe: BuhlmannTissue.pAlv(mix.he, prevBar)
        };
        this.#last     = {bar: absBar, mix: mix};
        if (!dTime) {
            return 0;
        }
        
        let load = 0;
        for (const tissue of this.#tissues) {
            load += tissue.addChange(gasRate, dTimeMin, pAlv);
        }
        return load;
    }

    /**
     * Adds more time to last segment
     * 
     * Returns tissue's load sum
     * 
     * @param {number} dTime Delta time, in seconds
     * @returns number
     */
    addTime(dTime)
    {
        return this.addChange(this.#last.bar, dTime, this.#last.mix);
    }

    /**
     * Current NDT
     * 
     * If deco needed, returns -1
     * 
     * @returns number
     */
    timeLeft()
    {
        return (() => {
            const clone = this.clone();
            const t     = 10;
            const inter = new Interpolator();
            let ceiling = this.ceiling(this.#gfHigh);
            let ndt     = 0;
            while (ceiling <= this.#env.sp && clone.addTime(t * 60)) {
                inter.p1(ceiling, ndt);
                ndt += t;
                if (ndt > 360) {
                    return 999;
                }
                ceiling = clone.ceiling(this.#gfHigh);
                inter.p2(ceiling, ndt);
            }
            ndt = ndt == 0 ? -1 : inter.calc(this.#env.sp, 0).round();
            return ndt;
        }).bind(this).cache(this.#cache, 'tl');
    }
    
    /**
     * Current desaturation time
     * 
     * @returns number
     */
    resetAfter()
    {
        return (() => {
            const clone = this.clone();
            const t     = 10;
            const inter = new Interpolator();
            clone.addChange(this.#env.sp, null, AIR);
            let ceiling = clone.ceiling(0);
            let desat   = 0;
            while (ceiling > this.#env.sp && clone.addTime(t * 60)) {
                inter.p1(ceiling, desat);
                desat += t;
                ceiling = clone.ceiling(0);
                inter.p2(ceiling, desat);
            }
            desat = inter.calc(this.#env.sp, 0).round();
            return desat;
        }).bind(this).cache(this.#cache, 'reset');
    }

    /**
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        this.addChange(this.#env.sp, null, AIR);
        this.addTime(si * 60);
    }
    
    /**
     * Returns deco stops needed to ascent
     * 
     * Return is a stop stack with deepest first. Each element has:
     * - bar: stop's ambient pressure, in bar
     * - depth: stop's depth, in meters
     * - sec: stop's time, in seconds
     * - optional: is stop optional? (safety stop)
     * - gf (for requireds): max gf on stop end
     * 
     * @param  {...GasMix} mixes Deco gas mixes, in order of use
     * @returns {stop[]}
     */
    stops(...mixes)
    {
        const sp = this.#env.sp;
        function ceilTo(n, b)
        {
            return Math.ceil(n / b) * b;
        }

        function gfStepAt(deco, absBar)
        {
            if (absBar <= sp) {
                return deco.gfHigh;
            }
            const lowCeil = deco.ceiling(deco.gfLow);
            if (absBar >= lowCeil) {
                return deco.gfLow;
            }
            return Math.interpolate(
                lowCeil, deco.gfLow, sp, deco.gfHigh, absBar
            )
        }
        
        const clone = this.clone();
        let gfStart = this.#gfLow;
        let ceil    = clone.ceiling(gfStart);
        let stops   = [];
        let mi      = 0;
        
        while (!clone.canAscend) {
            let stop  = ceilTo(ceil - sp, this.#phaseB) + sp; // Stop amb pressure, ceil to phase
            let next  = stop - this.#phaseB; // Next stop
            let depth = this.#env.depthAt(stop).round(); // Stop's depth
            let gfSt  = gfStepAt(this, next); // Max GF in stop
            let mix   = clone.#last.mix; // Current mix

            clone.addChange(stop); // Go to stop
            if (mixes[mi] && mixes[mi].mod >= stop && mixes[mi].mod < mix.mod) { // Is there a better mix?
                mix = mixes[mi++];
                clone.addChange(stop, null, mix); // Change mix in stop
            }

            let sec = 0;
            while (ceil > next && clone.addTime(60)) { // Lets define stop duration
                sec += 60;
                ceil = clone.ceiling(gfSt);
            }
            
            stops.push({bar: stop, depth, sec, mix, gf: gfSt});
        }

        let depth = 5;
        let bar   = this.#env.pressureAt(depth);
        ceil      = this.ceiling(gfStart * .5);
        if (!stops[0] && ceil > sp && this.#last.bar > bar) { // Safety stop
            let mix = clone.#last.mix;
            stops.push({bar, depth, sec: 180, mix, optional: true});
        }
        return stops;
    }

    /**
     * Deco model state
     * 
     * @returns object
     */
    state()
    {
        const state = {
            last: Object.clone(this.#last),
            tissues: []
        };
        for (const t of this.#tissues) {
            state.tissues.push(t.state());
        }
        return state;
    }
    
    /**
     * Restores deco model to a previous state
     * 
     * @param {object} state 
     * @returns {this}
     */
    restore(state)
    {
        this.#last = Object.clone(state.last);
        this.#last.mix = GasMix.from(this.#last.mix);
        for (var i = 0; i < this.#tissues.length; i++) {
            if (state.tissues[i] && state.tissues[i].pN2) {
                this.#tissues[i].restore(state.tissues[i]);
            }
        }
        this.#cache = {};
        return this;
    }

    /**
     * Clones deco model
     * 
     * @returns {BuhlmannDecoModel}
     */
    clone()
    {
        const clone = new BuhlmannDecoModel(this.#env, this.#gfLow, this.#gfHigh);
        clone.restore(this.state());
        return clone;
    }
}

/**
 * Represents a CNS effect
 */
class CNS extends PhysioEffect
{
    /**
     * @type {DiveSiteEnv}
     */
    #env;
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
     * @param {DiveSiteEnv} env DiveSite environment
     */
    constructor(env)
    {
        super();
        this.#env = env;
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
    addChange(absBar, dTime = null, mix = null)
    {
        if (!dTime) {
            dTime = barChangeDT(this.#env, this.#data.absBar, absBar);
        }
        if (!mix) {
            mix = this.#data.mix;
        }

        const pO2 = mix.pO2(absBar);
        if (absBar > this.#env.sp) {
            const aPO2 = Math.avg(this.#data.pO2, pO2);
            const rate = CNS.#rate(aPO2);
            this.#data.val += dTime * rate;
        }
        else {
            const si = dTime / 60;
            const f  = Math.pow(2, si / 90.0);
            this.#data.val = Math.max(0, this.#data.val / f);
        }
        this.#data.absBar = absBar;
        this.#data.pO2    = pO2;
        this.#data.mix    = mix;
        this.#cache       = {};
    }
    
    /**
     * 
     * @param {number} dTime Time between pressures, in seconds
     */
    addTime(dTime)
    {
        this.addChange(this.#data.absBar, dTime);
    }

    /**
     * Time to reach CNS 100%, in minutes
     * 
     * @returns number
     */
    timeLeft()
    {
        return (() => { 
            const rate = CNS.#rate(this.#data.pO2);
            const cns  = 1.0 - this.#data.val;
            return parseInt((cns / rate) / 60);
        }).bind(this).cache(this.#cache, 'tl');
    }
    
    /**
     * Minimum SI to reset CNS, in minutes
     * 
     * @returns number
     */
    resetAfter()
    {
        return (() => {
            const f = Math.log(.5) / Math.log(.004 / this.#data.val);
            return Math.ceil(90 / f).intVal();
        }).bind(this).cache(this.#cache, 'reset');
    }
    
    /**
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        this.addChange(this.#env.sp, null, AIR);
        this.addTime(si * 60);
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
        this.#data     = Object.clone(state);
        this.#data.mix = GasMix.from(this.#data.mix);
        this.#cache    = {};
    }

    /**
     * 
     * @returns {CNS}
     */
    clone()
    {
        const clone = new CNS(this.#env);
        clone.restore(this.state());
        return clone;
    }

    /**
     * Reset state
     */
    #reset()
    {
        this.#data = {
            pO2: AIR.pO2(this.#env.sp), absBar: this.#env.sp, mix: AIR, val: 0
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
    /**
     * @type {DiveSiteEnv}
     */
    #env;
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
     * @param {DiveSiteEnv} env DiveSite environment
     */
    constructor(env)
    {
        super();
        this.#env = env;
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
    addChange(absBar, dTime = null, mix = null)
    {
        if (!dTime) {
            dTime = barChangeDT(this.#env, this.#data.absBar, absBar);
        }
        if (!mix) {
            mix = this.#data.mix;
        }

        const pO2 = mix.pO2(absBar);
        if (absBar > this.#env.sp) {
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
        this.#data.mix    = mix;
        this.#cache       = {};
    }
    
    /**
     * 
     * @param {number} dTime Time between pressures, in seconds
     */
    addTime(dTime)
    {
        this.addChange(this.#data.absBar, dTime);
    }

    /**
     * Time to reach 300 OTU, in minutes
     * 
     * @returns number
     */
    timeLeft()
    {
        return (() => {
            if (this.#data.pO2 < .5) {
                return Infinity;
            }
            const maxTime = MAX_OTU / OTU.#calcOtu(this.#data.pO2, this.#data.pO2, 1);
            const otuLeft = MAX_OTU - this.#data.val;
            return (((otuLeft * maxTime) / MAX_OTU) / 60).intVal();
        }).bind(this).cache(this.#cache, 'tl');
    }
    
    /**
     * Minimum SI to reset OTU, in minutes
     * 
     * @returns number
     */
    resetAfter()
    {
        return (() => {
            return ((this.#data.val * DAYMIN) / MAX_OTU).round().intVal();
        }).bind(this).cache(this.#cache, 'reset');
    }
    
    /**
     * 
     * @param {number} si Surface interval, in minutes
     */
    applySI(si)
    {
        this.addChange(this.#env.sp, null, AIR);
        this.addTime(si * 60);
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
        this.#data     = Object.clone(state);
        this.#data.mix = GasMix.from(this.#data.mix);
        this.#cache    = {};
    }

    /**
     * 
     * @returns {OTU}
     */
    clone()
    {
        const clone = new OTU(this.#env);
        clone.restore(this.state());
        return clone;
    }

    /**
     * Reset state
     */
    #reset()
    {
        this.#data  = {
            pO2: AIR.pO2(this.#env.sp), absBar: this.#env.sp, mix: AIR, val: 0
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
    /**
     * @type {DiveSiteEnv}
     */
    #env;

    /**
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     */
    constructor(env = SEAWATER_ENV)
    {
        this.#effects = {
            deco: new BuhlmannDecoModel(env, conf.dc.gfLow, .9),
            cns:  new CNS(env),
            otu:  new OTU(env)
        };
        this.#env = env;
    }

    /**
     * @type {BuhlmannDecoModel}
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
    addChange(absBar, dTime = null, mix = null)
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
     * @returns {this}
     */
    addTime(dTime)
    {
        for (let e in this.#effects) {
            this.#effects[e].addTime(dTime);
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
     * Clones current body state
     * 
     * @returns {BodyState}
     */
    clone()
    {
        const clone = new BodyState(this.#env);
        clone.restore(this.state());
        return clone;
    }
}
