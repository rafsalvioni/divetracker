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
 * Gas mixes repository
 */
const GasMixes = {};

/**
 * Represents a Gas mix
 */
export class GasMix
{
    o2; he; n2; name;
    #hypoP; #hyperP; #narcoP; #fEad; #fEnd;

    /**
     * Create or return a existant gas mix
     * 
     * @param {number} o2 O2 fraction, in decimal
     * @param {number} he He fraction, in decimal
     */
    static get(o2, he = 0)
    {
        const id = `${Math.round(o2 * 100)}/${Math.round(he * 100)}`;
        if (!GasMixes[id]) {
            new GasMix(id); // Create an put in repo
        }
        return GasMixes[id];
    }
    
    /**
     * Create from another object
     * 
     * @param {object} mix {o2, he}
     * @returns {GasMix}
     */
    static from({o2, he = 0})
    {
        return GasMix.get(o2 ?? AIR_O2, he ?? 0);
    }

    /**
     * Calc and returns the better GasMix to depth/pressure given
     * 
     * @param {number} pA Depth's pressure, in bar
     * @returns {GasMix}
     */
    static bestMix(pA)
    {
        const o2  = Math.min(MAX_PO2 / pA, 1).floor(2);
        let he    = 0;
        const pN2 = conf.dc.o2narco ? MND - MAX_PO2 : MND_PN2;
        const pHe = pA - pN2 - MAX_PO2;
        if (pHe > 0) {
            he = pHe / pA;
        }
        return GasMix.get(o2, he);
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
            mixes[t.mix.name] = t.mix;
        }
        return Object.values(mixes);
    }

    /**
     * USE GasMix.get!!
     * 
     * @private
     * @param {string} mix Mix string
     */
    constructor(mix)
    {
        let match;
        if (!(match = mix.match(/^(\d{1,2})(\/(\d{1,2}))?$/))) {
            throw 'Invalid mix';
        }

        const o2 = parseInt(match[1]);
        const he = parseInt(match[3] ?? 0);

        this.o2 = o2 / 100.0;
        this.he = he / 100.0
        this.n2 = (1.0 - this.o2 - this.he).round(2);

        switch (true) {
            case o2 == 0:
                throw 'Mix doenst have O2';
            case o2 == 100:
                this.name = 'oxygen';
                break;
            case (o2 + he) == 100:
                this.name = `heliox${he}`;
                break;
            case he == 0:
                this.name = o2 == 21 ? 'air' : `nitrox${o2}`;
                break;
            default:
                this.name = `trimix${mix}`;
        }

        const o2narco = !!conf.dc.o2narco;
        this.#hypoP   = MIN_PO2 / this.o2;
        this.#hyperP  = MAX_PO2 / this.o2;
        const fN      = (o2narco || !this.n2) ? (1 - this.he) : (AIR_N2 / this.n2);
        this.#narcoP  = (MND / fN);
        this.#fEad    = this.n2 / AIR_N2;
        this.#fEnd    = o2narco ? (1 - this.he) : this.#fEad;

        GasMixes[mix] = this;
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
        return this.name === mix.name;
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
export const AIR = GasMix.get(AIR_O2);

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
    #sac;

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
     * @param {int} i First tank index
     * @returns int
     */
    static totalTime(pA, i = 0)
    {
        let sum = 0
        for (let t of Tank.each(i)) {
            if (t.isUsableAt(pA)) {
                sum += t.timeLeft(pA);
            }
        }
        return sum;
    }

    /**
     * Creates a tank with optimized size and gas mix to dive at given depth (pA)
     * for given minutes
     * 
     * @param {number} pA Goal pressure, in bar
     * @param {int} durMin Planned duration, in minutes
     * @param {number} workP Tank work pressure, in bar
     * @returns {Tank}
     */
    static bestTank(pA, durMin, workP = 200)
    {
        const rmvAt  = RMV * pA;
        const liters = rmvAt * durMin;
        const vol    = Math.ceil(liters / workP);
        const mix    = GasMix.bestMix(pA);
        return new Tank(mix, vol, workP);
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
     * Consumes current tank at pressure and time given
     * 
     * @param {number} pA Absolute pressure, in bar
     * @param {number} dTime Delta time, in seconds
     * @returns {this}
     */
    consume(pA, dTime)
    {
        if (dTime && this.end) {
            const rate = this.rateAt(pA);
            const used = rate * (dTime / 60);
            this.end   = Math.max(this.end - used, 0);
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
     * Returns -1 if tank is empty
     * 
     * @param {number} pA Absolute pressure, in bar
     * @returns int
     */
    timeLeft(pA)
    {
        if (this.end) {
            const rate = this.rateAt(pA);
            return parseInt(this.end / rate);
        }
        return -1;
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

    /**
     * Clones current tank
     * 
     * @returns {Tank}
     */
    clone()
    {
        const clone = new Tank(this.mix, this.vol, this.start);
        clone.end   = this.end;
        return clone;
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
        return new DiveSite(gps.last ? gps.last.pos : new GeoPoint(0,0,0));
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
            mix:   mix.name,
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
            const asc = TimeCalc.tts(depth).round();
            try {
                const dive = new Dive(site);
                const tl   = this.#simulateDive(dive, depth);
                dive.end();
                const time = dive.durMin;
                if (time <= 0) {
                    res.break = `${tl.source} exceeded at ${depth}m!`;
                    break;
                }

                const pA = dive.pAbs;
                plan[time - asc] = {depth, time, limiter: tl.source, asc, bestmix: GasMix.bestMix(pA).name};
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

        let tank;
        while ((tank = dive.nextTank())) {
            if (!dive.isMixUsable(tank.mix)) {
                throw `Gas #${dive.tanksUsed} is unusable at ${dive.depth.cur}m!`;
            }

            if (!dive.started) {
                dive.start(tank, this.#si);
            }
            else {
                dive.changeTank(tank);
            }

            const target = Math.min(maxDepth, env.depthAt(tank.mix.mod).floor(2));
            dive.addSample(target);
            if (dive.depth.max < maxDepth) { // Doesnt reach bottom... Lets try next tank
                continue;
            }

            const tl = dive.timeLeft;
            dive.addTime(tl.time * 60);
            if (tl.source != 'RGT' || !dive.nextTank()) {
                return tl;
            }
        }
        throw `MOD exceeded at ${maxDepth}m!`;
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
            case stops.current.missed || !deco.canAscend:
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
     * Clone current Dive
     * 
     * @returns {Dive}
     */
    clone()
    {
        const clone  = new Dive(this.#site);
        clone.#start = this.#start;
        clone.#dur   = this.#dur;
        clone.#end   = this.#end;
        clone.#depth = Object.clone(this.#depth);
        clone.#bodyState = this.#bodyState.clone();

        for (const tank of this.#tanks) {
            clone.#tanks.push(tank.clone());
        }

        clone.#decoStops.update(clone);
        return clone;
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
     * @returns {Tank}
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
     * If dt not given, it will be calculated:
     * - ascent/descent: considers ASC_SPEED and DESC_SPEED
     * - same depth: current time
     * 
     * @param {number} depth Depth, in meters
     * @param {number} dt Delta time, in seconds
     * @returns {this}
     */
    addSample(depth, dt = null)
    {
        if (!this.active) {
            return this;
        }

        depth = Math.max(depth, 0);
        if (!dt) { // To ascent / descent
            dt = TimeCalc.dt(this.#depth.cur, depth) * 60;
        }
        if (!dt) { // To bottom
            dt = parseInt(Date.now() / 1000) - (this.#start + this.#dur);
        }
        dt = dt.round();
        if (dt < 1) { // Not a valid DT...
            return this;
        }

        const prevDepth = this.#depth.cur;
        const prevBar   = this.pAbs;
        this.#depth.cur = depth;
        this.#depth.max = Math.max(this.#depth.cur, this.#depth.max);
        const avgDepth  = Math.avg(prevDepth, this.#depth.cur);

        if (this.#depth.avg) {
            const dd = this.#depth.cur - prevDepth;
            this.#depth.speed = Math.round(dd / (dt / 60)); // m/min
            this.#depth.avg   = Math.avgw(this.#depth.avg, this.#dur, avgDepth, dt);
        }
        else {
            this.#depth.avg = avgDepth;
        }
        this.#dur += dt;

        const pAbs    = this.pAbs;
        const curTank = this.curTank;
        const avgBar  = Math.avg(pAbs, prevBar);
        // Updates body state
        this.#bodyState.addChange(pAbs, dt, curTank.mix);
        // Uses current tank
        curTank.consume(avgBar, dt);

        this.dispatchEvent(new Event('sample'));
        return this;
    }

    /**
     * Adds a sample using last depth with time given
     * 
     * @see addSample()
     * @param {number} dt Delta time, in seconds
     * @returns {this}
     */
    addTime(dt = null)
    {
        return this.addSample(this.#depth.cur, dt);
    }

    /**
     * Sets current depth
     * 
     * @see Dive.addSample
     * @type number
     */
    set depth(d)
    {
        this.addSample(d);
    }

    /**
     * Current alerts
     * 
     * @type {string[]}
     */
    get alerts()
    {
        const curTank = this.curTank;
        const pAbs    = this.pAbs;
        const alerts  = [];
        const stop    = this.#decoStops.current;

        if (stop.missed) {// Is there missed required deco stop?
            alerts.push('stop');
        }
        if (!curTank.mix.isBreathableAt(pAbs)) {// Is pO2 out of usable range?
            alerts.push('mod');
        }
        if (curTank.mix.isNarcoAt(pAbs)) {// Is MND exceeded?
            alerts.push('mnd');
        }
        if (this.#depth.speed < -ASC_SPEED) {// Is ascent speed too fast?
            alerts.push('ascent');
        }
        if (this.#depth.speed > DESC_SPEED) {// Is descent speed too fast?
            alerts.push('descent');
        }
        const tl = this.timeLeft;
        if (tl.source != 'NDT' && tl.time <= 3) {// Is time left too low?
            alerts.push('time');
        }
        return alerts;
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
     * - No-Deco Time (NDT) (for deco dives, will be skipped)
     * - CNS time to 100% (CNS)
     * - OTU time to 300 (OTU)
     * - Residual gas time (current tank) (RGT)
     * 
     * Ascent time (including stops) will be discounted for times above. Here, next tanks
     * will be considered
     * 
     * If negative, one of them was exceeded
     * 
     * @type {{time, source}}
     */
    get timeLeft()
    {
        /**
         * Calc body and gas TL
         * 
         * @param {Dive} dive
         * @return {{time, source}}
         */
        function gasAndBody(dive)
        {
            const body = dive.bodyState.nearestEffect();
            let time   = dive.curTank.timeLeft(dive.pAbs);
            let source = 'rgt';

            if (body.time < time) {
                time   = body.time;
                source = body.name;
                switch (source) {
                    case 'deco': source = 'ndt'; break;
                }
            }
            return {time, source};
        }

        /**
         * Check if a dive has time to ascent
         * 
         * @param {Dive} dive 
         * @returns boolean
         */
        function ascCheck(dive)
        {
            const nextTank = dive.nextTank();
            if (nextTank && nextTank.isUsableAt(dive.pAbs)) {
                dive.changeTank(nextTank);
            }
            for (const foo of Dive.#eachAscStep(dive, true)) {
                if (gasAndBody(dive).time < 0) {
                    return false;
                }
            }
            return true;
        }

        let tl    = gasAndBody(this); // Initial TL
        let found = false;
        while (!found && tl.time >= 0) { // Lets discount ascent
            const clone = this.clone();
            clone.addTime(tl.time * 60);
            if (ascCheck(clone)) { // We can ascent!
                found = true;
            }
            else { // Ascent fails... discount time
                tl.time--;
            }
            clone.end();
        }
        tl.source = tl.source.toUpperCase();
        return tl;
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
     * Current tank ID
     * 
     * @type string
     */
    get tankId()
    {
        return `#${this.#tanks.length + 1} (${this.curTank.mix.name})`;
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
     * Considers current depth and deco stops
     * 
     * Uses ASC_SPEED value to calc time
     * 
     * @param {int} future Minutes to simulate future
     * @param {boolean} optional Considers optional steps?
     * @type int
     */
    ascTime(future = 0, optional = false)
    {
        const stop = this.#decoStops.current;
        if (stop.current || future > 0) {
            const t = (this.ascSteps(future, optional).at(-1).durSec - this.#dur) / 60;
            return Math.round(t - future);
        }
        return TimeCalc.tts(this.#depth.cur);
    }

    /**
     * Calc and returns needed steps to ascent
     * 
     * Each step has:
     * - depth: Dest depth,
     * - durSec: Dive's duration in second
     * - dt: Time difference from last sample
     * - tid: Tank's ID
     * - mix: Gas mix used
     * - tl: Time Left object at sample
     * 
     * @param {int} future Minutes to simulate future
     * @param {boolean} optional Considers optional steps?
     * @returns {object[]}
     */
    ascSteps(future = 0, optional = false)
    {
        const clone = this.clone();
        const steps = [];
        var dur     = this.#dur;

        clone.addTime(future * 60);

        clone.addEventListener('sample', () => {
            const step = {
                depth:  clone.#depth.cur,
                durSec: clone.#dur,
                dt:     clone.#dur - dur,
                tid:    clone.tanksUsed - 1,
                mix:    clone.curTank.mix,
                tl:     clone.timeLeft
            }
            dur = step.durSec;

            if ((steps.length % 2) == 0) {
                step.ascent = true;
            }
            else {
                step.stop = true;
            }
            steps.push(step);
        });

        Array.from(Dive.#eachAscStep(clone, optional)); // Force all steps
        clone.end();

        return steps;
    }

    /**
     * Generator to simulate ascent steps
     * 
     * PS: dive will be modified... so, give a clone
     * 
     * @param {Dive} dive Dive
     * @param {boolean} optional Considers optional steps?
     */
    static *#eachAscStep(dive, optional = false)
    {
        let curTank = dive.curTank;
        const stops = Array.from(dive.#decoStops); // Copy current state
        for (const stop of stops) {
            if (!optional && stop.optional) {
                continue;
            }
            let nextTank = dive.nextTank();
            if (nextTank && (!curTank.mix.equals(stop.mix) || curTank.end <= 50)) {
                curTank = nextTank;
                dive.changeTank(nextTank);
            }
            dive.addSample(stop.depth).addTime(stop.sec) // ascent and stop
            yield;
        }
        dive.addSample(0); // To surface
        yield;
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
    #stops   = [];
    #mixes   = [];
    #i       = 0;
    #depth   = 0;
    #no      = true;
    #lastUpd = 0;

    /**
     * 
     * @param {Dive} dive Dive
     */
    constructor(dive)
    {
        var me = this;
        // Update in each dive sample
        dive.addEventListener('sample', (e) => {
            me.#setDepth(e.target);
            const durSec = e.target.durSec;
            if ((durSec - me.#lastUpd) >= 10) { // Update stops each 10 seconds
                me.#updateStack(e.target);
            }
        });
        // Update next mixes on change tank
        dive.addEventListener('tankbegin', (e) => {
            me.#updateMixes(e.target); // Update next mixes
            me.#updateStack(e.target); // Update stops
        });
        // Stop interval on end dive
        dive.addEventListener('end', async (e) => {
            this.#manageCounter(e.target);
        });
    }

    /**
     * Start/stop deco time decreaser
     * 
     * @param {Dive} dive
     */
    #manageCounter(dive)
    {
        const cur   = this.#current;
        const start = !!cur.active && dive.depth.max > cur.depth && !this._sid;
        const stop  = (dive.ended || !cur.active) && !!this._sid;

        if (start) {
            // Current stop time decreaser
            var me = this;
            this._sid = setInterval(() => {
                const cur = me.#current;
                if (!cur.active) { // No active? Break
                    return;
                }
                cur.init = true;
                if (cur.sec > 0) { // Decrease time
                    cur.sec--;
                }
                else { // Finished
                    me.#i++; // To next stop
                }
            }, 1000); // Decreases by second
        }
        else if (stop) {
            clearInterval(this._sid);
            delete this._sid;
        }
    }

    /**
     * 
     * @param {Dive} dive 
     */
    #setDepth(dive)
    {
        this.#depth = dive.depth.cur.round().intVal();
        this.#manageCounter(dive);
    }

    /**
     * Update next mixes
     * 
     * @param {Dive} dive 
     */
    #updateMixes(dive)
    {
        const tanks = Array.from(Tank.each(dive.tanksUsed));
        this.#mixes = GasMix.tankMixes(...tanks);
    }

    /**
     * 
     * @param {Dive} dive 
     */
    #updateStack(dive)
    {
        const deco = dive.bodyState.decoModel;
        const cur  = this.#current;
        const dd   = deco.phaseM - 1;

        switch (true) {
            case !cur.init: // Current stop isnt initialized
            case Math.abs(this.#depth - cur.depth) >= dd: // Current stop missed (up or down)
                break; // Recalc stops
            default: // In deco zone
                this.#no = this.#no && !!cur.optional; // Is a deco dive?
                return; // Nothing more...
        }

        const stops = deco.stops(...this.#mixes); // Deco stops
        if (!stops.length) { // No required deco
            if (!cur.depth && dive.depth.cur > 10 && deco.timeLeft() <= 20) { // Is there a safety stop?
                const bar   = SEAWATER_ENV.pressureAt(5);
                const depth = dive.site.env.depthAt(bar).round();
                stops.push({
                    bar, depth, sec: 180, mix: dive.curTank.mix, optional: true
                });
            }
            else { // Theres a stop... return
                return;
            }
        }
        this.#stops   = stops; // We can redo stops
        this.#i       = 0;
        this.#lastUpd = dive.durSec;
        this.#manageCounter(dive);
    }

    /**
     * Forces state update
     * 
     * @param {Dive} dive 
     */
    update(dive)
    {
        this.#setDepth(dive);
        this.#updateMixes(dive);
        this.#updateStack(dive);
    }

    /**
     * Stop object by index
     * 
     * @param {int} i Stop index
     * @returns {stop}
     */
    #stop(i)
    {
        const stop = this.#stops.at(i);
        if (stop) {
            stop.current = i == this.#i;
            stop.active  = this.#depth == stop.depth;
            stop.missed  = !stop.optional && this.#depth < stop.depth && stop.sec > 0;
            return stop;
        }
        return {}
    }

    /**
     * Current stop or empty object
     * 
     * @type {stop}
     */
    get #current()
    {
        return this.#stop(this.#i);
    }

    /**
     * Stops iterator
     * 
     * @yields {stop}
     */
    *[Symbol.iterator]()
    {
        for (let i = this.#i; i < this.#stops.length; i++) {
            yield Object.clone(this.#stop(i));
        }
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

export function diveTest()
{
    const dive = new Dive(dc.curSite);
    dive.start(Tank.first(), new SurfaceInterval());
    console.log(dc.plan());
    return dive;
}