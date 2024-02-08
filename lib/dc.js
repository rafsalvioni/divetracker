import { AppConfig as conf, saveConfig } from '../bin/config.js';
import { DecoModel, DsatDecoModel } from './deco.js';
import { GeoPoint, Track } from './geo.js';
import { GpsProvider as gps } from './position.js';
import './proto.js';

/**
 * Desat Storage key
 */
const DESAT_STORAGE = '__lastDive__';

/**
 * Max ascent speed in m/min
 * 
 */
export const ASC_SPEED = 14;
/**
 * Max descent speed in m/min
 * 
 */
export const DESC_SPEED = 18;

/**
 * Minutes in a day
 */
export const DAYMIN = 1440;
/**
 * Time, in minutes, in surface to considers dive finished
 */
const END_TIME = 3;

/**
 * Mininum pO2 allowed
 */
export const MIN_PO2  = .18;
/**
 * Maximun pO2 allowed
 */
export const MAX_PO2  = conf.dc.maxPpo2 ?? 1.4;
/**
 * O2 percent in Air
 */
export const AIR_O2   = .21;
/**
 * N2 percent in Air
 */
export const AIR_N2   = .79;

/**
 * Pressure at sea level, in bar
 */
export const SEALEVEL_PRESSURE = 1.013;

/**
 * Surface RMV, in l/min
 * 
 * @type int
 */
const RMV = conf.dc.rmv ?? 15;

/**
 * Group of CNS relative functions
 */
const CNS = {
    /**
     * Returns NOOA rate to given pO2
     * 
     * @param {number} pO2 pO2 in bar
     * @returns number
     */
    rate(pO2)
    {
        pO2 *= 1000;
        return pO2 <= 1500 ?
            Math.exp(-11.7853 + 0.00193873 * pO2) :
            Math.exp(-23.6349 + 0.00980829 * pO2);
    },

    /**
     * Reduce a CNS using SI given
     * 
     * @see https://github.com/subsurface/subsurface/blob/345f0570a5d6333927a388fabac8e9784e6c45bb/core/divelist.c#L307
     * @param {number} cns CNS
     * @param {number} si SI in minutes
     * @returns number
     */
    reduce(cns, si)
    {
        /* CNS reduced with 90min halftime during surface interval */
        let f = Math.pow(2, si / 90.0);
        return Math.max(0, cns / f);
    },

    /**
     * Calculates CNS usign pO2 and exposure time given
     * 
     * @see https://github.com/subsurface/subsurface/blob/345f0570a5d6333927a388fabac8e9784e6c45bb/core/divelist.c#L183
     * @param {number} pO2 pO2 in bar
     * @param {number} time Time in seconds
     * @returns number
     */
    calc(pO2, time)
    {
        if (pO2 <= .5) {
            return 0;
        }
        let rate = CNS.rate(pO2);
        return time * rate;
    },

    /**
     * Returns NOOA max exposure time, in minutes, to pO2 given
     * 
     * @param {number} pO2 pO2 in bar
     * @returns int
     */
    maxTime(pO2)
    {
        return CNS.timeLeft(pO2, 0);
    },

    /**
     * Returns time left, in minutes, to reach 100% of exposure
     * 
     * If negative, CNS was exceeded
     * 
     * @param {number} pO2 pO2 in bar
     * @param {number} cns Current CNS percent, in decimal
     * @returns int
     */
    timeLeft(pO2, cns)
    {
        let rate = CNS.rate(pO2);
        cns      = 1.0 - cns;
        return parseInt((cns / rate) / 60);
    },

    /**
     * Returns the min SI, in minutes, to reset CNS given
     * 
     * @param {number} cns CNS percent, in decimal
     * @returns int
     */
    minSI(cns)
    {
        let f = Math.log(.5) / Math.log(.004 / cns);
        return Math.ceil(90 / f).intVal();
    }
}

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
     * @returns float
     */
    tts: (d) =>
    {
        return (d / ASC_SPEED);
    }
}

/**
 * Configure dive settings
 * 
 */
export function configDive()
{
    try {
        configTanks();
        let mod = prompt('Informs max ppO2, in decimal:', conf.dc.maxPpo2); if (mod === null) return;
        mod = parseFloat(mod);
        if (mod < 1.4 || mod > 1.6) {
            throw 'Invalid ppO2';
        }
        conf.dc.maxPpo2 = mod;
        conf.dc.salt = !!confirm('Are you going to dive in SALT water?');
        let rmv = prompt('Informs your RMV, in l/min:', conf.dc.rmv); if (rmv === null) return;
        conf.dc.rmv = parseFloat(rmv);
        saveConfig();
    } catch (e) {
        alert(`ERROR: ${e}`);
    }
}

/**
 * Config dive's tanks
 */
function configTanks()
{
    let tanks = [];
    let hasHe = false;
    do {
        let tank = conf.dc.tanks[tanks.length];
        if (!tank) {
            tank = {vol: 11.1, bar: 200, mix: {o2: .21, he: 0}};
        }
        let vol = prompt('Informs tank\'s volume, in liters:', tank.vol); if (vol === null) break;
        vol = parseFloat(vol);
        let bar = prompt('Informs tank\'s start pressure, in bar:', tank.bar); if (bar === null) break;
        bar = parseFloat(bar);
        let o2 = prompt('Informs mix\'s O2, in percent:', tank.mix.o2 * 100); if (o2 === null) break;
        o2 = parseFloat(o2 / 100);
        if (tanks.length && o2 < tanks.at(-1).mix.o2) {
            alert('O2 percent should be greater than previous mix');
            continue;
        }
        let he = prompt('Informs mix\'s He, in percent:', tank.mix.he * 100); if (he === null) break;
        he = parseFloat(he / 100);
        hasHe = hasHe || he > 0;
        tanks.push({vol: vol, bar: bar, mix: {o2: o2, he: he}});
    } while(confirm('Add another tank?'));
    conf.dc.tanks = tanks;
    conf.dc.o2narco = hasHe && !!confirm('Are you consider O2 narcotic for (MND/END)?');
}

/**
 * Represents a Gas mix
 */
export class GasMix
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
    o2Range(env)
    {
        return {
            min: this.minDepth(env),
            max: this.maxDepth(env)
        };
    }

    /**
     * Mix's Min Operation Depth at ambient conditions
     * 
     * This is min depth to mix not be hypoxic
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns number
     */
    minDepth(env)
    {
        let bar = MIN_PO2 / this.o2;
        return Math.max(env.depthAt(bar), 0);
    }

    /**
     * Mix's Max Operation Depth at ambient conditions
     * 
     * This is max depth to mix not be hyperoxic
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns number
     */
    maxDepth(env)
    {
        let bar = MAX_PO2 / this.o2;
        return env.depthAt(bar);
    }

    /**
     * Mix's Max Narcotic Depth at ambient conditions
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @param {boolean} o2narco Is O2 narcotic?
     * @returns number
     */
    mnd(env, o2narco = conf.dc.o2narco)
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
     * Checks if mix can used at given pressure
     * 
     * A mix is usable when it isnt hypoxic or hyperoxic at pressure
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isUsableAt(pA)
    {
        let pO2 = this.pp(pA, 'o2');
        return !(pO2 < MIN_PO2 || pO2 > MAX_PO2);
    }

    /**
     * Returns partial pressure of this gas at absolute pressure given
     * 
     * If "gas" was given, just its parcial pressure will be returned
     * 
     * @param {number} pA Pressure (any unit)
     * @param string gas Gas portion ('o2', 'n2' or 'he')
     * @returns {{o2, n2, he}}
     */
    pp(pA, gas = null)
    {
        if (gas) {
            return (this[gas] ?? 0) * pA;
        }
        return {
            o2: this.o2 * pA,
            n2: this.n2 * pA,
            he: this.he * pA,
        }
    }

    /**
     * Returns CNS percent using this gas, in decimal, at pA and time given
     * 
     * @param {number} pA Absolute pressure (any unit)
     * @param {number} time Time, in seconds
     * @returns float
     */
    cns(pA, time)
    {
        let pO2 = this.pp(pA, 'o2');
        return CNS.calc(pO2, time);
    }
}
/**
 * Air mix
 * 
 * @type {GasMix}
 */
export const AIR = new GasMix(AIR_O2);

/**
 * Represents a Gas Tank
 * 
 */
class Tank
{
    /**
     * @type {GasMix}
     */
    mix; vol; start; end;
    #sacRate;

    /**
     * Creates a object from struct
     * 
     * @param {object} param Conf Tank
     * @returns {Tank}
     */
    static from({vol, bar, mix})
    {
        return new Tank(GasMix.from(mix), vol, bar);
    }

    /**
     * Instantiate first tank configured
     * 
     * If isnt one, returns default with AIR
     * 
     * @returns {Tank}
     */
    static first()
    {
        return Tank.get(0) ?? new Tank(AIR);
    }

    /**
     * Tanks iterator
     * 
     * @yields {Tank}
     */
    static *each()
    {
        for (let t of conf.dc.tanks) {
            yield Tank.from(t);
        }
    }

    /**
     * Creates tank by index, or "undefined" if unknown
     * 
     * @param {int} i Tank index
     * @returns {Tank}
     */
    static get(i)
    {
        if (conf.dc.tanks[i]) {
            return Tank.from(conf.dc.tanks[i]);
        }
        return undefined;
    }

    /**
     * Returns total tanks' time at given pressure
     * 
     * Only mixes usable at pressure will be considered
     * 
     * @see Tank.timeLeft
     * @param {number} pA Absolute pressure, in bar
     * @returns int
     */
    static totalTime(pA)
    {
        let sum = 0
        for (let t of Tank.each()) {
            if (t.isUsableAt(pA)) {
                sum += t.timeLeft(pA);
            }
        }
        return sum;
    }

    /**
     * 
     * @param {GasMix} mix Gas mix
     * @param {number} vol Tank's volume, in liters
     * @param {number} bar Tank's start pressure, in bar
     */
    constructor(mix, vol = 11.1, bar = 200)
    {
        this.mix      = mix;
        this.vol      = parseFloat(vol);
        this.end      = parseFloat(bar);
        this.start    = parseFloat(bar);
        this.#sacRate = (RMV / this.vol);
        //Object.freeze(this);
    }

    /**
     * Use current tank at pressure and time given
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {number} dTime Delta time, in seconds
     * @returns {this}
     */
    async use(pA, dTime)
    {
        if (dTime && this.end) {
            let sac   = this.sac(pA);
            let bar   = sac * (dTime / 60);
            this.end -= bar;
            this.end  = Math.max(this.end, 0);
        }
        return this;
    }

    /**
     * Returns SAC (bar/min rate) at pressure given
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns number
     */
    sac(pA = SEALEVEL_PRESSURE)
    {
        return this.#sacRate * pA;
    }

    /**
     * Returns tank's time left at pressure given, in minutes
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns int
     */
    timeLeft(pA)
    {
        let sac = this.sac(pA);
        return parseInt(this.end / sac);
    }

    /**
     * Checks if tank's mix is usable at pressure given
     * 
     * @see GasMix.isUsableAt
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isUsableAt(pA)
    {
        return this.mix.isUsableAt(pA);
    }

    /**
     * Current gas volume, in liters
     * 
     * @type number
     */
    get gasVolume()
    {
        return this.vol * this.end;
    }

    /**
     * Is tank empty?
     * 
     * @type boolean
     */
    get empty()
    {
        return Math.round(this.end) == 0;
    }

    /**
     * Is tank used?
     * 
     * @type boolean
     */
    get used()
    {
        return this.start > this.end;
    }
}

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
     * Water specific weight
     * 
     * @type float
     */
    #ww;

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
     * 
     * @param {number} sp Surface pressure
     * @param {boolean} salt Salt water?
     */
    constructor(sp = SEALEVEL_PRESSURE, salt = conf.dc.salt)
    {
        this.sp  = sp;
        this.alt = ((SEALEVEL_PRESSURE - this.sp) / .05).intVal();
        this.sw  = !!salt;
        this.#ww = DiveSiteEnv.waterWeight(this.sw);
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
        let d = (bar - this.sp) / this.#ww;
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
        let bar = this.#ww * d + this.sp;
        return bar;
    }
}
export const SEAWATER_ENV = new DiveSiteEnv(SEALEVEL_PRESSURE, true);

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

            this.#dive.start(Tank.first(), this.#desat);
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
     * Returns a structured object with current DC properties joined with
     * a list of possible dives
     * 
     * A dive is considered possible if NDL(-RNT), CNS time left and Gases' time
     * are > 0
     * 
     * To CNS and Gases time, ascent time will be discounted
     * 
     * Considers just start gas defined
     * 
     * @returns object
     */
    plan()
    {
        let env    = this.curSite.env;
        let mix    = Tank.first().mix;
        let desat  = this.#desat.state();
        let od     = mix.o2Range(env);
        let mod    = od.max.round().intVal();
        let noDive = desat.noDive > 0;
        let hipox  = od.min >= 1;

        let res = {
            mix: mix.id, mod: mod, pO2: MAX_PO2,
            water: env.water, sp: env.sp, cns: (desat.cns*100).intVal(),
            dives: [],
        };
        let test = false;

        switch (true) {
            case noDive:
                res.break = `You cant dive for ${desat.noDive} min`;
                break;
            case hipox:
                res.break = `First gas mix is hipoxic at surface`;
                break;
            default:
                test = true;
        }

        let depth  = 10; // environment depth
        let plan   = {};
        while (test) {
            // MOD Test
            if (depth > mod) {
                res.break = `MOD exceeded at ${depth}m`;
                break;
            }
            // NDL Check
            let asc  = DiveCalc.tts(depth).round();
            let deco = this.#desat.decoModel(env.sp);
            let pA   = env.pressureAt(depth);
            deco.addChange(pA, (depth / DESC_SPEED) * 60, mix);
            asc     += deco.stopTime(true);
            let time = deco.ndt();
            if (time <= 0) {
                res.break = `NDL <= 0 at ${depth}m`;
                break;
            }
            // CNS Test
            let pO2 = mix.pp(pA, 'o2');
            time    = Math.min(time, CNS.timeLeft(pO2, desat.cns) - asc);
            if (time <= 0) {
                res.break = `CNS >= 100% at ${depth}m`;
                break;
            }
            // Tanks Test
            time     = Math.min(time, Tank.totalTime(pA) - asc);
            if (time <= 0) {
                res.break = `Gases' time isn't enough at ${depth}m`;
                break;
            }

            plan[time] = {depth: depth++, time: time};
        }

        res.dives = Object.values(plan).slice(0, 20);
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

        let decoModel = dive.decoModel;
        let mult   = this.is();
        this.#last = {
            end:    dive.ended ? dive.endDate.getTime() : Date.now(),
            deco:   decoModel.state(),
            desat:  decoModel.desat(),
            cns:    dive.cns,
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
     * Returns a deco model using last saved state (if there is one)
     * and applying current SI
     * 
     * @type {DecoModel}
     */
    decoModel(sp = SEALEVEL_PRESSURE)
    {
        let si = this.si;
        const decoModel = new DsatDecoModel(sp);
        if (isFinite(si)) {
            decoModel.restore(this.#last.deco);
            decoModel.applySI(si);
        }
        return decoModel;
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
     * Returns remainder CNS at current SI
     * 
     * @type float
     */
    get cns()
    {
        let si = this.si;
        if (isFinite(si) && this.#last.cns > 0) {
            let cns = CNS.reduce(this.#last.cns, si);
            return cns.round(2);
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
     * Deco Model
     * 
     * @type {DecoModel}
     */
    #decoModel;
    /**
     * Depth state
     */
    #depth = {
        cur: 0, max: 0, avg: 0, speed: 0, active: 0
    }
    /**
     * Tanks used
     */
    #tanks = [];
    /**
     * @type {DecoStops}
     */
    #decoStops;
    /**
     * @type {DiveSite}
     */
    #site;
    /**
     * CNS percent
     * 
     * @type {number}
     */
    #cns = 0;

    /**
     * 
     * @param {DiveSite} site DiveSite environment
     */
    constructor(site)
    {
        super();
        this.#site = site;
        this.#decoStops = new DecoStops(this);
    }

    /**
     * Starts dive
     * 
     * @param {Tank} tank First tank
     * @param {DesatState} desatState Desat state
     * @returns self
     */
    start(tank, desatState)
    {
        if (!this.#start) {
            this.#start     = parseInt(Date.now() / 1000);
            this.#decoModel = desatState.decoModel(this.#site.env.sp);
            this.#cns       = desatState.cns;
            this.dispatchEvent(new Event('start'));
            this.changeTank(tank);
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
            this.#endTank();
            this.dispatchEvent(new Event('end'));
        }
        return this;
    }

    /**
     * Changes current gas tank
     * 
     * @param {Tank} tank Gas Tank
     * @returns self
     */
    changeTank(tank)
    {
        if (this.active) {
            if (this.#tanks.length) {
                this.#endTank();
            }
            // Add mix
            this.#tanks.push(tank);
            this.#depth.mod = tank.mix.o2Range(this.#site.env);
            this.#depth.mnd = tank.mix.mnd(this.#site.env);

            // Send event...
            this.dispatchEvent(new CustomEvent('tankbegin', {
                detail: tank
            }));
        }
        return this;
    }

    /**
     * Returns next not used Gas tank defined, or null (no more tanks)
     * 
     * @returns {GasMix}
     */
    nextTank()
    {
        let i = this.#tanks.length;
        return Tank.get(i);
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
        return mix.isUsableAt(this.pA);
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

        const durSec    = this.durSec;
        const durMin    = parseInt(durSec / 60);
        const prevDepth = this.#depth.cur;
        let dtSec     = 0;
        let dtMin     = 0;

        this.#depth.cur = Math.max(d, 0);
        this.#depth.max = Math.max(this.#depth.cur, this.#depth.max);
        const pAbs      = this.pAbs;
        const curTank   = this.curTank;

        if (this.#depth.last) {
            dtSec = (durSec - this.#depth.last.sec);
            dtMin = (durMin - this.#depth.last.min);
            const dd = this.#depth.cur - prevDepth;
            this.#depth.speed = Math.round(dd / (dtSec / 60)); // m/min
            this.#depth.avg   = Math.avgw(this.#depth.avg, this.#depth.last.sec, this.#depth.cur, dtSec);
        }
        else {
            this.#depth.avg = this.#depth.cur;
        }
        this.#depth.last = {sec: durSec, min: durMin}; // Time of last depth taken

        // Updates deco model
        this.#decoModel.addChange(pAbs, dtSec, curTank.mix);
        // Uses current tank
        curTank.use(pAbs, dtSec);
        // Updates CNS
        this.#cns += curTank.mix.cns(pAbs, dtSec);

        this.dispatchEvent(new Event('sample'));

        const inDeco = this.#decoStops.inDeco;

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
        /*this.dispatchEvent(new CustomEvent('alert', {
            detail: { // MND exceeded!
                type:   'mnd',
                active: this.#depth.cur > this.#depth.mnd
            }
        }));*/
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Ascent speed too fast!
                type:  'ascent',
                active: this.#depth.speed < -ASC_SPEED
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Descent speed too fast!
                type:  'descent',
                active: this.#depth.speed > DESC_SPEED
            }
        }));
        if (dtMin > 0) { // Dispatch by minute
            this.dispatchEvent(new CustomEvent('alert', {
                detail: { // Dive's time left < ascend time
                    type:   'time',
                    active: this.timeLeft.time <= this.ascTime
                }
            }));
        }
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
     * Dive's time left, in minutes
     * 
     * We are considering time left a min time to doesnt exceed any "secure" time
     * 
     * Returns the lowest time of:
     * - No-Deco Time
     * - CNS time to 100%
     * - Gas consume
     * 
     * If negative, one of them was exceeded
     * 
     * @type {{time, source}}
     */
    get timeLeft()
    {
        let tank  = this.curTank;
        let pA    = this.pAbs;
        let times = {
            cns: CNS.timeLeft(tank.mix.pp(pA, 'o2'), this.cns),
            ndt: this.decoModel.ndt(),
            gas: tank.timeLeft(pA)
        }
        let time  = Math.min(...Object.values(times));
        for (let s in times) {
            if (time == times[s]) {
                return {time: time, source: s.toUpperCase()};
            }
        }
        return {time: time, source: '?'};
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
     * Current Gas Tank
     * 
     * @type {Tank}
     */
    get curTank()
    {
        return this.#tanks.at(-1);
    }

    /**
     * Depth data, in meters
     * 
     * @type {{cur, avg, max}}
     */
    get depth()
    {
        return {
            cur: this.#depth.cur,
            avg: this.#depth.avg,
            max: this.#depth.max
        };
    }

    /**
     * Returns current DecoModel
     * 
     * @type {DecoModel}
     */
    get decoModel()
    {
        return this.#decoModel;
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
        t    += (this.#decoStops.stopTime / 60);
        return Math.round(t);
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

    /**
     * Returns absolute pressure at current depth, in bar
     * 
     * @type number
     */
    get pAbs()
    {
        if (this.#start) {
            return this.#site.env.pressureAt(this.#depth.cur);
        }
        return undefined;
    }

    /**
     * Returns relative pressure at current depth, in bar
     * 
     * @type number
     */
    get pRel()
    {
        if (this.#depth.cur) {
            return this.pAbs - this.#site.env.sp;
        }
        return 0;
    }

    /**
     * Returns partial pressure of given/current mix at current depth
     * 
     * If mix was given, use it. Else, current dive mix
     * 
     * @see {GasMix.pp}
     * @param {GasMix} mix Gas mix
     * @returns {{o2, n2, he}}
     */
    ppMix(mix = null)
    {
        return (mix ?? this.curTank.mix).pp(this.pAbs);
    }

    /**
     * @type float
     */
    get cns()
    {
        return this.#cns.round(2);
    }

    /**
     * Closes current tank
     */
    #endTank()
    {
        let tank = this.curTank;
        this.dispatchEvent(new CustomEvent('tankend', {
            detail: tank
        }));
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
        dive.addEventListener('end', async (e) => {
            clearInterval(me._iid);
        });
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
    async #update(dive)
    {
        this.#depth = parseInt(Math.round(dive.depth.cur));
        let decoModel = dive.decoModel;

        for (let stop of decoModel.stops()) {
            stop.depth = dive.site.env.depthAt(stop.bar).intVal();
            if (stop.depth < this.#depth) { // Just stops above
                this.#addStop(dive, stop);
            }
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
            if (!s1.init) {
                return (s2.required && !s1.required);
            }
            return false;
        }

        if (stop && canReplace(stop, s)) {
            stop.sec = s.sec;
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

export const dc = new DC();
