import { AppConfig as conf, saveConfig } from '../bin/config.js';
import { diveLogger } from './logger.js';
import './proto.js';

/**
 * Max ascent speed in m/min
 * 
 */
const ASC_SPEED = 18;
/**
 * Storage key
 */
const STORAGE_KEY = '__lastDive__';
/**
 * Minutes in a day
 */
const DAYMIN = 1440;

/**
 * Configure dive settings
 * 
 */
export function configDive()
{
    try {
        let o2 = parseFloat(prompt('Informs mix\'s O2, in percent:', conf.dc.o2 * 100));
        if (o2 < 0 || o2 > 100) {
            throw 'Invalid O2 percent';
        }
        conf.dc.o2 = o2 / 100;
        let mod = parseFloat(prompt('Informs max ppO2, in decimal:', conf.dc.maxPpo2));
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
 * Auxiliar class to manage last dive
 */
class DecoState
{
    /**
     * Last dive data
     */
    #dive

    /**
     * Loads last dive from storage
     */
    constructor()
    {
        try {
            // Try to load last dive from Storage
            let json   = localStorage[STORAGE_KEY];
            this.#dive = JSON.parse(json);
            this.si;
        } catch (e) {
            this.#dive = null;
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
        this.#dive = {
            end:      dive.ended ? dive.endDate.getTime() : Date.now(),
            group:    dive.decoGroup,
            missStop: dive.decoStops.hasMissed(),
            ndt:      dive.noDecoTime
        }
        // Saves data to next dive retrieves as residual
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#dive));
        return this;
    }

    /**
     * Is there a last dive?
     * 
     * @returns boolean
     */
    has()
    {
        return !!this.#dive;
    }

    /**
     * Returns current last dive deco group using SI
     * 
     * If there isnt a dive, returns null (no group)
     * 
     */
    get resGroup()
    {
        if (this.#dive) {
            return DecoCalc.regroup(this.si, this.#dive.group);
        }
        return null;
    }

    /**
     * Current SI, in minutes
     * 
     * Max is minutes in a day
     */
    get si()
    {
        if (this.#dive) {
            let dt = parseInt((Date.now() - this.#dive.end) / 60000);
            dt     = Math.min(dt, DAYMIN);
            if (dt == DAYMIN) {
                this.#remove();
            }
            else {
                return dt;
            }
        }
        return DAYMIN;
    }

    /**
     * Checks no fly state
     */
    get noFly()
    {
        if (this.#dive) {
            let min = this.#dive.missStop ? DAYMIN : DAYMIN * .75;
            return this.si < min;
        }
        return false;
    }

    /**
     * Checks No-Dive state
     */
    get noDive()
    {
        let si = this.si;
        if (!this.#dive) {
            return false;
        }
        if (this.#dive.ndt < -5 || this.#dive.missStop) {
            return si < DAYMIN;
        }
        else if (this.#dive.ndt < 0) {
            return si < (DAYMIN * .25);
        }
        return false;
    }

    /**
     * Take a snapshot of current object state
     * 
     * @returns {DecoState}
     */
    state()
    {
        return {
            si:       this.si,
            resGroup: this.resGroup,
            noDive:   this.noDive,
            noFly:    this.noFly
        }
    }

    /**
     * Remove from storage
     */
    #remove()
    {
        localStorage.removeItem(STORAGE_KEY);
        this.#dive = null;
    }
}
export const decoState = new DecoState();

/**
 * Represents a Dive
 * 
 */
export class Dive extends EventTarget
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
     * Deco state before dive
     */
    #decoBefore;
    /**
     * Deco state on dive end
     */
    #decoAfter;
    /**
     * Depth state
     */
    #depth = {
        cur: 0, max: 0, sum: 0, count: 0, active: 0
    }
    /**
     * Tanks used
     */
    #tanks = [];
    /**
     * Salt water?
     */
    #salt = true;

    /**
     * 
     * @param {boolean} salt Salt water?
     */
    constructor(salt = conf.dc.salt)
    {
        super();
        this.#salt = !!salt;
        decoStops.clear();
    }

    /**
     * Starts dive
     * 
     * @param {number} o2 First tank's O2
     * @returns self
     */
    start(o2 = conf.dc.o2)
    {
        if (!this.#start) {
            this.#start      = parseInt(Date.now() / 1000);
            this.#decoBefore = decoState.state();
            diveLogger.dive  = this; // Added to logger when start and after events
            this.dispatchEvent(new Event('start'));
            this.changeMix(o2);
            this.dispatchEvent(new CustomEvent('alert', {
                detail: {
                    type:   'nodive',
                    active: this.#decoBefore.noDive
                }
            }));
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
            this.#closeMix();
            this.#end = this.durSec;
            this.#decoAfter = decoState.save(this).state();
            this.dispatchEvent(new Event('end'));
        }
        return this;
    }

    /**
     * Changes current gas mix
     * 
     * @param {number} o2 O2 percent
     * @returns self
     */
    changeMix(o2)
    {
        if (this.active) {
            let mix    = {
                o2: o2, n: (1.0 - o2),
                mod: parseInt(DiveCalc.mod(o2, conf.dc.maxPpo2, this.#salt))
            };
            let curMix = this.curMix;
            if (curMix) {
                if (Math.rounds(curMix.n - mix.n, 2) != 0) { // If nitrogen percent changes...
                    // Lets to consider this change like a repetitive dive without SI
                    // So, we save current dive as last to retrieve a new last state
                    this.#decoBefore = decoState.save(this).state();
                }
                // Close current tank
                this.#closeMix();
            }
            // Add mix
            this.#tanks.push(mix);
            // Send event...
            this.dispatchEvent(new CustomEvent('event', {
                detail: 'gaschange'
            }));
        }
        return this;
    }

    /**
     * Sets current depth using altitude diff
     * 
     * @param {number} z1 
     * @param {number} z0 
     */
    setDepthFromAlt(z1, z0)
    {
        this.depth = -(z1 - z0);
    }

    /**
     * Dive's ID
     * 
     */
    get id()
    {
        return this.#start;
    }

    /**
     * Sets dive depth
     * 
     * If dive is not started and depth > 1, dive will be started
     * 
     * After started, if depth < 1 more than 3 min, dive will be ended
     * 
     * @param {number} d
     */
    set depth(d)
    {
        if (!this.#start && d > 1) {
            this.start();
        }
        else if (!this.active) {
            return;
        }

        let durSec   = this.durSec;
        let curDepth = this.#depth.cur;

        this.#depth.cur  = Math.max(d, 0);
        this.#depth.sum += this.#depth.cur;
        this.#depth.max  = Math.max(this.#depth.cur, this.#depth.max);
        this.#depth.count++;
        this.#depth.avg  = (this.#depth.sum / this.#depth.count);

        if (this.#depth.last) {
            let dt = (durSec - this.#depth.last) / 60;
            let dd = this.#depth.cur - curDepth;
            this.#depth.speed = Math.round(dd / dt);
        }
        this.#depth.last = durSec;

        if (this.#depth.cur >= 1) { // Update depth active if 1 meter at least
            this.#depth.active = durSec;
        }
        // If depth < 1 more than 3 minutes, ends dive
        else if (this.#depth.active && (durSec - this.#depth.active) >= 180) {
            this.end();
            return;
        }

        decoStops.update(this);

        this.dispatchEvent(new Event('sample'));
        let inDeco = decoStops.inDeco;

        if (inDeco) {
            this.dispatchEvent(new CustomEvent('event', {
                detail: 'indeco'
            }));
        }
        this.dispatchEvent(new CustomEvent('alert', {
            detail: {
                type:   'stop',
                active: decoStops.hasMissed()
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: {
                type:   'mod',
                active: (this.#depth.cur > this.curMix.mod)
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: {
                type:  'ascent',
                active: this.speed < -ASC_SPEED
            }
        }));
        this.dispatchEvent(new CustomEvent('alert', {
            detail: {
                type:   'ndt',
                active: !inDeco && !this.ascent && this.noDecoTime < 0
            }
        }));
    }

    /**
     * Is dive started?
     */
    get started()
    {
        return !!this.#start;
    }

    /**
     * Is dive ended?
     */
    get ended()
    {
        return !!this.#end;
    }

    /**
     * Is dive active?
     */
    get active()
    {
        return this.#start && !this.#end;
    }

    /**
     * Dive's start date or null
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
     */
    get durMin()
    {
        return parseInt(this.durSec / 60);
    }

    /**
     * Current gas mix or null
     * 
     */
    get curMix()
    {
        if (this.#tanks.length) {
            return Object.clone(this.#tanks[this.#tanks.length - 1]);
        }
        return null;
    }

    /**
     * Current depth, in meters
     */
    get curDepth()
    {
        return this.#depth.cur;
    }

    /**
     * Current average depth, in meters
     */
    get avgDepth()
    {
        if (this.#depth.avg) {
            return this.#depth.avg;
        }
        return 0;
    }

    /**
     * Max depth reach, in meters
     */
    get maxDepth()
    {
        return this.#depth.max;
    }

    /**
     * Current No Deco Time, in minutes
     * 
     * if negative, NDL exceeded
     * 
     */
    get noDecoTime()
    {
        let ndl = this.#ndl();
        let dur = this.durMin;
        return (ndl - dur);
    }

    /**
     * Current deco group, A-Z or ? (deco dive)
     * 
     */
    get decoGroup()
    {
        let ead = this.#ead();
        let dur = this.durMin;
        return DecoCalc.decoGroup(ead, dur, this.#decoBefore.resGroup);
    }

    /**
     * Return initial deco state
     * 
     * NOTE: Could be changed by breath gas
     * 
     */
    get decoBefore()
    {
        return this.#decoBefore;
    }

    /**
     * Return deco state after this dive
     * 
     */
    get decoAfter()
    {
        return this.#decoAfter;
    }

    /**
     * Total ascent time, in minutes
     * 
     * Considers current depth and eventual deco stops
     * 
     * Considers a ascent speed of 18 m/min
     */
    get ascTime()
    {
        let d = this.#depth.cur;
        let t = Math.ceil(d / ASC_SPEED);
        t    += Math.ceil(decoStops.ascTime / 60);
        return t;
    }

    /**
     * Is ascent?
     */
    get ascent()
    {
        return this.speed < 0;
    }

    /**
     * Current speed
     * 
     * If negative, is ascenting
     */
    get speed()
    {
        if (this.#depth.speed) {
            return this.#depth.speed;
        }
        return 0;
    }

    /**
     * Get deco stops manager
     * 
     * @return {DecoStops}
     */
    get decoStops()
    {
        return decoStops;
    }

    /**
     * Closes current gas mix
     */
    #closeMix()
    {
        let tank   = this.#tanks[this.#tanks.length - 1];
        tank.until = this.durSec;
        tank.depth = this.avgDepth;
    }

    /**
     * Calcs current EAD
     * 
     * @param {boolean} avg Use avg depth?
     * @returns number
     */
    #ead(avg = true)
    {
        let d = avg ? this.avgDepth : this.curDepth;
        return DiveCalc.ead(d, this.curMix.n, this.#salt);
    }

    /**
     * Current NDL
     * 
     * @returns int
     */
    #ndl()
    {
        return DecoCalc.ndl(this.#ead(), this.#decoBefore.resGroup);
    }
}

/**
 * Group of Dive calculations
 * 
 */
const DiveCalc = {
    /**
     * Calculates Equivalent Air Depth
     * 
     * @param {number} d Depth, in meters
     * @param {number} n Nitrogen tax, in decimal
     * @param {boolean} salt Salt water?
     * @returns number
     */
    ead: (d, n, salt = true) =>
    {
        let f = salt ? 10 : 10.36;
        return (d + f) * (n / .79) - f;
    },

    /**
     * Calculates Max Operational Depth
     * 
     * @param {float} ppO2 O2 content
     * @param {float} mppO2 Max ppO2 (1.4 - 1.6)
     * @param {boolean} salt Salt water?
     * @returns float
     */
    mod: (ppO2, mppO2 = 1.4, salt = true) =>
    {
        let mod = ((mppO2 / ppO2) - 1) * 10 * (salt ? 1 : 1.03);
        return mod;
    }
}

/**
 * Deco Stops manager
 * 
 */
class DecoStops
{
    #stops;
    #depth;
    #current;

    /**
     * 
     */
    constructor()
    {
        var me = this;
        this.clear();
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
    }

    /**
     * Clear stops to a new dive
     * 
     */
    clear()
    {
        this.#stops   = [];
        this.#current = -1;
    }

    /**
     * Updates manager with dive given
     * 
     * @param {Dive} dive 
     */
    update(dive)
    {
        let d    = dive.avgDepth;
        let safe = DecoCalc.safetyStop(d, dive.durMin, dive.decoBefore.resGroup);
        let ndt  = dive.noDecoTime;

        if (safe) { // Safety stop
            this.#addStop(dive, {depth: 5, sec: 3 * 60, required: false});
        }
        if (ndt < -5) { // NDL exceeded more than 5 min
            this.#addStop(dive, {depth: 5, sec: 15 * 60, required: true});
        }
        else if (ndt < 0) { // NDL exceeded no more than 5 min
            this.#addStop(dive, {depth: 5, sec: 8 * 60, required: true});
        }

        this.#depth   = parseInt(Math.round(dive.curDepth));
        this.#current = this.#findCurrent();
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
     * @returns object
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
     * Total time, in seconds, to complete all stops
     * 
     */
    get ascTime()
    {
        let t = 0;
        for (let s of this.#stops) {
            if (this.#depth >= s.depth) {
                t += s.sec;
            }
        }
        return t;
    }

    /**
     * In deco?
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

        if (stop && !stop.init && s.sec > stop.sec) {
            stop = Object.assign(stop, s);
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
const decoStops = new DecoStops();

/**
 * Group of deco calculations
 * 
 */
const DecoCalc = {
    /**
     * Returns depth index, or -1
     * 
     * @param {number} d Depth
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
     * If a residual group given, RNT will be subtracted from NDL
     * 
     * @param {number} d Depth
     * @param {string} rg Previous deco group
     * @returns int
     */
    ndl: (d, rg = null) =>
    {
        let i = DecoCalc.getDepthIndex(d);
        if (i < 0) {
            return 0;
        }
        let ndl = DIVE_TIMES[i][DIVE_TIMES[i].length - 1];
        ndl    -= DecoCalc.rnt(rg, d);
        return Math.max(ndl, 0);
    },

    /**
     * Returns the deco group by depth and bottom time given
     * 
     * If RNT group was given, its RNT will be add to BT
     * 
     * @param {number} d Depth
     * @param {number} bt Bottom time, in minutes
     * @param {string} rg RNT group
     * @returns string
     */
    decoGroup: (d, bt, rg = null) =>
    {
        let di = DecoCalc.getDepthIndex(d);
        if (di >= 0) {
            bt += DecoCalc.rnt(rg, d);
            const TIMES = DIVE_TIMES[di];
            for (let i = 0; i < TIMES.length; i++) {
                if (bt <= TIMES[i]) {
                    return DECO_GROUP.charAt(i);
                }
            }
        }
        return 'Z';
    },

    /**
     * Checks if a dive need a safety stop
     * 
     * If RNT group was given, its RNT will added to BT
     * 
     * @param {number} d Depth
     * @param {number} bt Bottom time, in minutes
     * @param {string} rg RNT group
     * @returns boolean
     */
    safetyStop: (d, bt, rg = null) =>
    {
        let di = DecoCalc.getDepthIndex(d);
        if (di >= 0) {
            bt += DecoCalc.rnt(rg, d);
            return bt >= SAFE_TIME[di];
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
     * Returns the RNT using group and depth given
     * 
     * @param {string} g Deco group
     * @param {number} d Depth
     * @returns int
     */
    rnt(g, d)
    {
        let gi = DECO_GROUP.indexOf(g);
        if (gi < 0) {
            return 0;
        }

        let di  = DecoCalc.getDepthIndex(d);
        let max = DAYMIN * .5;
        if (DIVE_TIMES[di] && DIVE_TIMES[di][gi]) {
            return DIVE_TIMES[di][gi];
        }
        return max;
    }
};

// *************** PADI AIR DIVE TABLE *****************
const DIVE_METERS = [ 10,  12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 42];
const SAFE_TIME   = [160, 116, 82, 63, 51, 40, 32, 25,  0,  0,  0,  0];
const DECO_GROUP  = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIVE_TIMES  = [
    [10, 20, 26, 30, 34, 37, 41, 45, 50, 54, 59, 64, 70, 75, 82, 88, 95, 104, 112, 122, 133, 145, 160, 178, 199, 219], //10
    [9, 17, 23, 26, 29, 32, 35, 38, 42, 45, 49, 53, 57, 62, 66, 71, 76, 82, 88, 94, 101, 108, 116, 125, 134, 147], //12
    [8, 15, 19, 22, 24, 27, 29, 32, 35, 37, 40, 43, 47, 50, 53, 57, 61, 64, 68, 73, 77, 82, 87, 92, 98], //14
    [7, 13, 19, 21, 23, 25, 27, 29, 32, 34, 37, 39, 42, 45, 48, 50, 53, 56, 60, 63, 67, 70, 72], //16
    [6, 11, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 39, 41, 43, 46, 48, 51, 53, 55, 56], //18
    [6, 10, 13, 15, 16, 18, 20, 21, 23, 25, 26, 28, 30, 32, 33, 36, 38, 40, 42, 44, 45], //20
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
    [2, 5, 8, 11, 14, 17, 20, 24, 28, 31, 35, 40, 44, 49, 54, 59, 65, 71, 77, 84, 91, 100, 109, 131, 179, 360] // Z
];
