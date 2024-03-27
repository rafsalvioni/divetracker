import { AppConfig as conf, saveConfig } from '../bin/config.js';
import { BodyState } from './physio.js';
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
export const ASC_SPEED  = 10;
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
 * Mininum pO2 allowed, in bar
 */
export const MIN_PO2  = .16;
/**
 * Maximum pO2 allowed, in bar
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
 * MND to Air, in bar
 */
export const MND      = 4.044;
/**
 * pN2 at MND/Air, in bar
 */
export const MND_PN2  = AIR_N2 * MND;

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
 * Group of Dive time calculations
 * 
 */
export const TimeCalc = {
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
    },

    /**
     * Calculates ideal time to move between depths
     * 
     * Return in minutes
     * 
     * @param {number} from From depth, in meters
     * @param {number} to To depth, in meters
     * @returns number
     */
    dt(from, to)
    {
        const dd = -(from - to);
        const dt = dd / (dd >= 0 ? DESC_SPEED : -ASC_SPEED);
        return dt;
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
        let gf = prompt('Informs wanted GF Low (0-90):', conf.dc.gfLow * 100); if (gf === null) return;
        if (gf < 0 || gf > 90) {
            throw 'Invalid GF Low';
        }
        conf.dc.gfLow = parseFloat(gf) / 100;
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
    do {
        let tank = conf.dc.tanks[tanks.length];
        if (!tank) {
            tank = {vol: 11.1, start: 200, mix: {o2: .21, he: 0}};
        }
        let vol = prompt('Informs tank\'s volume, in liters:', tank.vol); if (vol === null) break;
        vol     = parseFloat(vol);
        let start = prompt('Informs tank\'s start pressure, in bar:', tank.start); if (start === null) break;
        start     = parseFloat(start);
        let o2 = prompt('Informs mix\'s O2, in percent:', tank.mix.o2 * 100); if (o2 === null) break;
        o2     = parseFloat(o2 / 100);
        if (o2 <= 0) {
            alert('O2 percent should be > 0');
            continue;
        }
        let he = prompt('Informs mix\'s He, in percent:', tank.mix.he * 100); if (he === null) break;
        he     = parseFloat(he / 100);
        tanks.push({vol: vol, start: start, mix: {o2: o2, he: he}});
    } while(confirm('Add another tank?'));
    conf.dc.tanks = tanks;
    conf.dc.o2narco = !!confirm('Are you consider O2 narcotic for MND/END?');
}

/**
 * Represents a Gas mix
 */
export class GasMix
{
    o2; he; n2; id;
    #hypoP; #hyperP; #narcoP; #fEad; #fEnd;
    
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
     * Calc and returns the better GasMix to depth/pressure given
     * 
     * @param {number} pA Depth's pressure, in bar
     * @returns {GasMix}
     */
    static bestMix(pA)
    {
        const o2  = Math.min(MAX_PO2 / pA, 1);
        let he    = 0;
        const pN2 = conf.dc.o2narco ? MND - MAX_PO2 : MND_PN2;
        const pHe = pA - pN2 - MAX_PO2;
        if (pHe > 0) {
            he = pHe / pA;
        }
        return new GasMix(o2, he);
    }

    /**
     * Returns all mixes of given tanks
     * 
     * @param  {...Tank} tanks Tank
     * @returns {GasMix[]}
     */
    static tankMixes(...tanks)
    {
        const mixes = {};
        for (const t of tanks) {
            mixes[t.mix.id] = t.mix;
        }
        return Object.values(mixes);
    }

    /**
     * 
     * @param {number} o2 O2 fraction, in decimal
     * @param {number} he He fraction, in decimal
     */
    constructor(o2, he = 0)
    {
        this.o2 = parseFloat(o2).round(2);
        this.he = parseFloat(he).round(2);
        this.n2 = (1.0 - this.o2 - this.he).round(2);

        o2 = parseInt(this.o2 * 100);
        he = parseInt(this.he * 100);
        switch (true) {
            case o2 == 0:
                throw 'Mix doenst have O2';
            case o2 == 100:
                this.id = 'oxygen';
                break;
            case (o2 + he) == 100:
                this.id = `heliox${he}`;
                break;
            case he == 0:
                this.id = o2 == 21 ? 'air' : `nitrox${o2}`;
                break;
            default:
                this.id = `trimix${o2}/${he}`;
        }

        const o2narco = !!conf.dc.o2narco;
        this.#hypoP   = MIN_PO2 / this.o2;
        this.#hyperP  = MAX_PO2 / this.o2;
        const fN      = (o2narco || !this.n2) ? (1 - this.he) : (AIR_N2 / this.n2);
        this.#narcoP  = (MND / fN);
        this.#fEad    = this.n2 / AIR_N2;
        this.#fEnd    = o2narco ? (1 - this.he) : this.#fEad;

        Object.freeze(this);
    }

    /**
     * Mix's Min Bottom Depth
     * 
     * This is min ambient pressure to mix not be hypoxic
     * 
     * Value in bar
     * 
     * @type number
     */
    get mbd()
    {
        return this.#hypoP;
    }

    /**
     * Mix's Max Operation Depth
     * 
     * This is max pressure to mix not be hyperoxic
     * 
     * Value in bar
     * 
     * @type number
     */
    get mod()
    {
        return this.#hyperP;
    }

    /**
     * Mix's Max Narcotic Depth
     * 
     * This is max pressure to mix not be narcotic
     * 
     * Value in bar
     * 
     * @type number
     */
    get mnd()
    {
        return this.#narcoP;
    }

    /**
     * Calc Equivalent Air Depth
     * 
     * For this gas mix and dive pressure, calcs the equivalent pressure which would produce
     * the same nitrogen partial pressure when breathing air
     * 
     * Returns depth in ambient pressure
     * 
     * @param {number} pA Absolute pressure (any unit)
     * @returns number
     */
    ead(pA)
    {
        return pA * this.#fEad;
    }

    /**
     * Calc Equivalent Narcotic Depth
     * 
     * For this gas mix and dive pressure, calcs the equivalent pressure which would produce
     * the same narcotic effect when breathing air
     * 
     * Returns depth in ambient pressure
     * 
     * @param {number} pA Absolute pressure (any unit)
     * @returns number
     */
    end(pA)
    {
        return pA * this.#fEnd;
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
     * Checks if mix is hypoxic at given pressure
     * 
     * Hypoxic = MBD exceeded
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isHypoxAt(pA)
    {
        return pA < this.#hypoP;
    }

    /**
     * Checks if mix is hyperoxic at given pressure
     * 
     * Hyperoxic = MOD exceeded
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isHyperoxAt(pA)
    {
        return pA > this.#hyperP;
    }
    
    /**
     * Checks if mix is narcotic at given pressure
     * 
     * Narcotic = MND exceeded
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isNarcoAt(pA)
    {
        return pA > this.#narcoP;
    }

    /**
     * Checks if mix is breathable at given pressure
     * 
     * Mix is breathable when it isnt hypoxic or hyperoxic
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isBreathableAt(pA)
    {
        return !(this.isHypoxAt(pA) || this.isHyperoxAt(pA));
    }

    /**
     * Checks if mix is a "bottom" mix at environment given
     * 
     * Bottom mix is a mix not breathable at surface
     * 
     * @param {DiveSiteEnv} env DiveSite environment
     * @returns boolean
     */
    isBottomMix(env)
    {
        return this.isHypoxAt(env.sp)
    }

    /**
     * Returns mix's O2 partial pressure at given pressure
     * 
     * @param {number} pA Absolute pressure (any unit)
     * @returns number
     */
    pO2(pA)
    {
        return this.o2 * pA;
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
    #sac; #last = 0;

    /**
     * Creates a object from struct
     * 
     * @param {object} param Conf Tank
     * @returns {Tank}
     */
    static from({vol, start, mix})
    {
        return new Tank(GasMix.from(mix), vol, start);
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
     * @param {int} i First tank index
     * @yields {Tank}
     */
    static *each(i = 0)
    {
        const next = conf.dc.tanks.slice(i);
        for (let t of next) {
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
     * @param {number} start Tank's start pressure, in bar
     */
    constructor(mix, vol = 11.1, start = 200)
    {
        this.mix   = mix;
        this.vol   = parseFloat(vol);
        this.end   = parseFloat(start);
        this.start = parseFloat(start);
        this.#sac  = (RMV / this.vol);
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
            const aPA  = Math.avg(this.#last, pA);
            const rate = this.rateAt(aPA);
            const used = rate * (dTime / 60);
            this.end   = Math.max(this.end - used, 0);
            this.#last = pA;
        }
        return this;
    }

    /**
     * Returns bar/min rate consumption at pressure given
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns number
     */
    rateAt(pA = SEALEVEL_PRESSURE)
    {
        return this.#sac * pA;
    }

    /**
     * Returns tank's time left at pressure given, in minutes
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns int
     */
    timeLeft(pA)
    {
        const rate = this.rateAt(pA);
        return parseInt(this.end / rate);
    }

    /**
     * Checks if tank's mix is breathable at pressure given
     * 
     * @see GasMix.isBreathableAt
     * @param {number} pA Absolute pressure, in bar
     * @returns boolean
     */
    isUsableAt(pA)
    {
        return this.end && this.mix.isBreathableAt(pA);
    }
}
if (!conf.dc.tanks.length) {
    conf.dc.tanks.push(Object.clone(new Tank(AIR)));
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
export class DiveSiteEnv
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
     * @param {number} bar Pressure, in bar
     * @param {boolean} abs Was given absolute pressure?
     * @returns number
     */
    depthAt(bar, abs = true)
    {
        if (abs) {
            bar -= this.sp;
        }
        let d = bar / this.#ww;
        return d;
    }

    /**
     * Returns pressure, in bar, at given depth considering
     * environment
     * 
     * @param {number} d Depth, in meters
     * @param {boolean} abs Returns as absolute pressure? Else, relative
     * @returns number
     */
    pressureAt(d, abs = true)
    {
        // Pt = P0 + d * g * h
        let bar = this.#ww * d;
        if (abs) {
            bar += this.sp;
        }
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
     * @type {SurfaceInterval}
     */
    #si;
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
        this.#si = new SurfaceInterval();

        var me = this;
        setInterval(() => { // Saves dives in desat periodcally
            me.#updateSI();
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
    #addSample(depth, dt)
    {
        let inDive  = this.inDive;
        this.#depth = Math.max(depth, 0);

        if (!inDive && this.#depth >= 1) {
            var me = this;
            this.dispatchEvent(new CustomEvent('alert', {
                detail: {
                    type:   'nodive',
                    active: me.#si.noDive > 0
                }
            }));

            this.#dive = new Dive(this.curSite);
            this.#dive.addEventListener('end', async (e) => {
                me.#si.save(e.target);
                me.#site = null;
            });
            this.dispatchEvent(new Event('dive'));

            this.#dive.start(Tank.first(), this.#si);
            this.#updateSI();
            inDive = true;
        }
        if (inDive) {
            this.#dive.addSample(depth, dt);
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
        if (track.active && track.prev) {
            const pos = track.pos;
            if (!this.inDive) {
                this.#site = new DiveSite(pos);
            }
            const depth = (track.first.alt - pos.alt);
            const dt    = parseInt((pos.timestamp - track.prev.timestamp) / 1000);
            this.#addSample(depth, dt);
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
     * A dive is considered possible if body effects are acceptable and Gases' time
     * are > 0. Deco dives will be discarted
     * 
     * Ascent time will be discounted from BT
     * 
     * Considers all tanks defined
     * 
     * @returns object
     */
    plan()
    {
        const site   = this.curSite;
        const env    = site.env;
        const mix    = Tank.first().mix;
        const noDive = this.#si.noDive;
        const body   = this.#si.bodyState(env);

        let res = {
            mix:   mix.id,
            tanks: conf.dc.tanks.length,
            mod:   env.depthAt(mix.mod).intVal(),
            mnd:   env.depthAt(mix.mnd).intVal(),
            pO2:   MAX_PO2, rmv: RMV,
            water: env.water, sp: env.sp,
            cns:   (body.cns * 100).intVal(),
            otu:   (+body.otu).intVal(),
            satur: (body.decoModel * 100).intVal(),
            gf:    String(body.decoModel),
            dives: [],
        };
        let test = false;

        switch (true) {
            case noDive > 0:
                res.break = `You cant dive for ${noDive} min`;
                break;
            case mix.isBottomMix(env):
                res.break = `First gas mix is hypoxic at surface`;
                break;
            default:
                test = true;
        }

        let depth  = 10; // environment depth
        let plan   = {};
        while (test) {
            const dive = new Dive(site);
            try {
                this.#simulateDive(dive, depth);
                dive.end();
                if (dive.depth.cur < depth) {
                    res.break = `MOD exceeded at ${depth}m`;
                    break;
                }
                const tl   = dive.timeLeft;
                const asc  = dive.ascTime;
                const time = dive.durMin - asc;
                if (time <= 0) {
                    res.break = `${tl.source} exceeded at ${depth}m`;
                    break;
                }

                const pA = dive.pAbs;
                plan[time] = {depth, time, limiter: tl.source, asc, bestmix: GasMix.bestMix(pA).id};
            } catch (e) {
                res.break = e;
                break;
            }
            depth++;
        }

        res.dives = Object.values(plan).slice(0, 20);
        return res;
    }

    /**
     * Populate given dive using configured tanks
     * 
     * @param {Dive} dive Dive
     * @param {number} maxDepth Depth to reach
     */
    #simulateDive(dive, maxDepth)
    {
        const env = dive.site.env;

        while (true) {
            let tid  = dive.tanksUsed;
            let tank = Tank.get(tid);
            if (!tank) {
                break;
            }

            const curDepth = dive.depth.cur;
            const pA       = env.pressureAt(curDepth);
            if (!tank.isUsableAt(pA)) {
                throw `Tank#${tid} not usable at ${curDepth}m!`;
            }

            if (tid == 0 && !dive.started) { // First tank. Start dive
                dive.start(tank, this.#si);
            }
            else { // No? Just change
                dive.changeTank(tank);
            }

            const mod = Math.min(maxDepth, env.depthAt(tank.mix.mod));
            let dt = TimeCalc.dt(curDepth, mod) * 60;
            dive.addSample(mod, dt);

            if (mod < maxDepth) { // Doesnt reach maxDepth. Lets try next tank
                continue;
            }

            const tl = dive.timeLeft;
            dive.addSample(maxDepth, tl.time * 60);

            if (tl.source == 'GAS' && !!dive.nextTank()) { // Current gas ended. But, we have more... Lets try it!
                continue;
            }
            break;
        }
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
        return this.#si.is();
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
     * SI state
     * 
     * @type {SurfaceInterval}
     */
    get si()
    {
        return this.#updateSI().state();
    }

    /**
     * 
     * @returns {SurfaceInterval}
     */
    #updateSI()
    {
        if (this.inDive) {
            this.#si.save(this.#dive);
        }
        return this.#si;
    }
}

/**
 * Auxiliar class to manage Surface Interval
 */
class SurfaceInterval
{
    /**
     * Last dive data
     */
    #last
    /**
     * Mult dive flag
     */
    #mult

    /**
     * Loads last dive from storage
     */
    constructor()
    {
        try {
            // Try to load last dive from Storage
            let json   = localStorage[DESAT_STORAGE];
            this.#last = JSON.parse(json);
            this.#mult = isFinite(this.si);

            if (this.#last && this.#last.active) {
                alert("WARNING!!!!\n\nLast dive wasn't finished correctaly!! Desaturation state could be wrong!!!");
            }
        } catch (e) {
            this.#last = null;
            this.#mult = false;
            console.log(e);
        }
    }

    /**
     * Returns primitive SI
     * 
     * @param {string} hint 
     * @returns mixed
     */
    [Symbol.toPrimitive](hint)
    {
        switch (hint) {
            case 'string':
                return String(this.si);
            default:
                return this.si;
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

        const body  = dive.bodyState;
        const ended = dive.ended;

        this.#last = {
            end:    ended ? dive.endDate.getTime() : Date.now(),
            body:   body.state(),
            noDive: 0,
            noFly:  DAYMIN * (this.#mult ? .75 : .5), // Single dives: 12hrs - Multiple dives / days: 18hrs
            active: !ended
        }
        if (ended) {
            this.#mult = true;
        }

        const stops = dive.decoStops;
        const deco  = body.decoModel;
        const desat = deco.resetAfter();
        switch (true) {
            case stops.isMissed || !deco.canAscend:
                this.#last.noDive = Math.max(DAYMIN, desat);
            case !stops.noDeco:
                this.#last.noFly  = Math.max(DAYMIN, desat);
                break;
            default:
                this.#last.noFly  = Math.max(this.#last.noFly, desat);
        }

        // Saves data to next dive retrieves as residual
        localStorage.setItem(DESAT_STORAGE, JSON.stringify(this.#last));
        return this;
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
            this.#clean();
        }
        return Infinity;
    }

    /**
     * Returns current body state after applies SI
     * 
     * @type {DiveSiteEnv} DiveSite env
     */
    bodyState(env = SEAWATER_ENV)
    {
        let si = this.si;
        const body = new BodyState(env);
        if (isFinite(si)) {
            body.restore(this.#last.body);
            body.applySI(si);
        }
        return body;
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
     * @returns {SurfaceInterval}
     */
    state()
    {
        const state = Object.enumGetters(this);
        var me = this;
        state[Symbol.toPrimitive] = function() { return me.si; }
        return state;
    }

    /**
     * Remove from storage
     */
    #clean()
    {
        localStorage.removeItem(DESAT_STORAGE);
        this.#last = null;
        this.#mult = false;
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
     * Dive current duration
     */
    #dur   = 0;
    /**
     * Dive's duration (if termined) in seconds
     */
    #end;
    /**
     * Body state
     * 
     * @type {BodyState}
     */
    #bodyState;
    /**
     * Depth state
     */
    #depth = {
        cur: 0, max: 0, avg: 0, speed: 0
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
     * 
     * @param {DiveSite} site Dive Site
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
     * @param {SurfaceInterval} si Surface Interval instance
     * @returns self
     */
    start(tank, si)
    {
        if (!this.#start) {
            this.#start     = parseInt(Date.now() / 1000);
            this.#bodyState = si.bodyState(this.#site.env);
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
        return mix.isBreathableAt(this.pAbs);
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
     * Add a dive sample
     * 
     * @param {number} depth
     */
    addSample(depth, dt = null)
    {
        if (!this.active) {
            return;
        }
        if (!dt) {
            dt = parseInt(Date.now() / 1000) - (this.#start + this.#dur);
        }
        dt = Math.max(0, dt).round();

        const prevDepth = this.#depth.cur;
        const avgD      = Math.avg(prevDepth, this.#depth.cur);

        this.#depth.cur = Math.max(depth, 0);
        this.#depth.max = Math.max(this.#depth.cur, this.#depth.max);

        if (this.#depth.avg) {
            const dd = this.#depth.cur - prevDepth;
            this.#depth.speed = Math.round(dd / (dt / 60)); // m/min
            this.#depth.avg   = Math.avgw(this.#depth.avg, this.#dur, avgD, dt);
        }
        else {
            this.#depth.avg = avgD;
        }
        this.#dur += dt;

        const pAbs    = this.pAbs;
        const curTank = this.curTank;
        // Updates body state
        this.#bodyState.addChange(pAbs, dt, curTank.mix);
        // Uses current tank
        curTank.use(pAbs, dt);

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
                active: this.#decoStops.isMissed
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: { // Out of O2 usable range!
                type:   'mod',
                active: !curTank.mix.isBreathableAt(pAbs)
            }
        }));
        /*this.dispatchEvent(new CustomEvent('alert', {
            detail: { // MND exceeded!
                type:   'mnd',
                active: curTank.mix.isNarcoAt(pAbs)
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
        if ((this.#dur % 60) == 0) { // Dispatch by minute
            const tl = this.timeLeft.time;
            this.dispatchEvent(new CustomEvent('alert', {
                detail: { // Dive's time left < ascend time
                    type:   'time',
                    active: tl >= 0 && tl <= this.ascTime
                }
            }));
        }
    }

    set depth(d)
    {
        this.addSample(d);
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
     * Dive's end date or "undefined"
     * 
     * @type {Date}
     */
    get endDate()
    {
        if (this.#end) {
            return new Date((this.#start + this.#end) * 1000);
        }
        return undefined;
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
        return this.#dur;
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
     * - OTU time to 300
     * - Gas consume
     * 
     * If negative, one of them was exceeded
     * 
     * @type {{time, source}}
     */
    get timeLeft()
    {
        const body = this.#bodyState.nearestEffect();
        let time   = this.curTank.timeLeft(this.pAbs);
        let source = 'gas';
        if (body.time < time) {
            time = body.time;
            switch(body.effect) {
                case 'otu':
                case 'cns':
                    source = body.effect;
                    break;
                default:
                    source = 'ndt';
            }
        }
        source = source.toUpperCase();
        return {time, source};
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
     * Number of tanks used (including current)
     * 
     * @type int
     */
    get tanksUsed()
    {
        return this.#tanks.length;
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
     * Returns current Body state
     * 
     * @type {BodyState}
     */
    get bodyState()
    {
        return this.#bodyState;
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
        let t = TimeCalc.tts(d);
        t    += (this.#decoStops.stopTime() / 60);
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
     * Deco stops manager
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
        return this.#site.env.pressureAt(this.#depth.cur);
    }

    /**
     * Returns relative pressure at current depth, in bar
     * 
     * @type number
     */
    get pRel()
    {
        return this.#site.env.pressureAt(this.#depth.cur, false);
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
 * Manager for Deco Stops
 * 
 */
class DecoStops
{
    #stops = [];
    #mixes = [];
    #i;
    #depth = 0;
    #no    = true;

    /**
     * 
     * @param {Dive} dive Dive
     */
    constructor(dive)
    {
        var me = this;
        // Current stop time decreaser
        this._sid = setInterval(() => {
            const cur = me.#current;
            if (!cur.active) { // No active? Break
                return;
            }
            if (cur.sec > 0) { // Decrease time
                cur.sec--;
            }
            else { // Finished
                me.#i++; // To next stop
            }
        }, 1000); // Decreases by second

        // Stops stack updater
        this._did = setInterval(() => {
            me.#updateStack(dive);
        }, 10000);

        // Update in each dive sample
        dive.addEventListener('sample', (e) => {
            me.#setDepth(e.target);
        });
        // Update next mixes on change tank
        dive.addEventListener('tankbegin', (e) => {
            const tanks = Array.from(Tank.each(dive.tanksUsed));
            me.#mixes   = GasMix.tankMixes(...tanks);
        });
        // Stop interval on end dive
        dive.addEventListener('end', async (e) => {
            clearInterval(me._sid);
            clearInterval(me._did);
        });
    }

    /**
     * 
     * @param {Dive} dive 
     */
    #setDepth(dive)
    {
        this.#depth = dive.depth.cur.round().intVal();
    }

    /**
     * 
     * @param {Dive} dive 
     */
    async #updateStack(dive)
    {
        const deco = dive.bodyState.decoModel;
        const cur  = this.#current;
        const n    = this.#stops.length;

        switch (true) {
            case n == 0: // No stops... Deco model with current values
            case n == this.#i: // All stops done!
            case (Math.abs(this.#depth - cur.depth) > deco.phaseM): // Missed current stop +phase meters
                break;
            default: // In deco zone... Nothing todo
                this.#no = this.#no && !!cur.optional;
                return; 
        }
        this.#stops = deco.stops(...this.#mixes); // Redo stops
        this.#i     = 0;
    }

    /**
     * Returns total left time, in seconds, to complete all stops
     * 
     * @param {boolean} optional Considers optional stops?
     * @returns number
     */
    stopTime(optional = true)
    {
        let t = 0;
        for (let i = this.#i; i < this.#stops.length; i++) {
            const stop = this.#stops[i];
            if (optional || !stop.optional) {
                t += this.#stops[i].sec;
            }
        }
        return t;
    }

    /**
     * Current stop or empty object
     * 
     * @type {stop}
     */
    get #current()
    {
        const stop = this.#stops.at(this.#i);
        if (stop) {
            stop.active = this.#depth == stop.depth;
            stop.missed = !stop.optional && this.#depth < stop.depth;
            return stop;
        }
        return {}
    }

    /**
     * Current stop cloned
     * 
     * @type {stop}
     */
    get current()
    {
        const stop = this.#current;
        return Object.clone(stop);
    }

    /**
     * Was a no-deco dive?
     * 
     * @type boolean
     */
    get noDeco()
    {
        return this.#no;
    }

    /**
     * Is current deco stop active?
     * 
     * @type boolean
     */
    get inDeco()
    {
        return !!this.#current.active;
    }

    /**
     * Is current deco stop was missed?
     * 
     * @type boolean
     */
    get isMissed()
    {
        return !!this.#current.missed;
    }

    /**
     * Is there a next stop?
     * 
     * @type boolean
     */
    get hasNext()
    {
        return !!this.#stops.at(this.#i + 1);
    }
}

export const dc = new DC();
