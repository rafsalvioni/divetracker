import { Coords } from './trigo.js';
import './proto.js';
import { MotionService as motion, OrientationService as orient } from './sensor.js';
import { ChainFilter, DistinctWindow, SMAFilter } from './sfilter.js';

/**
 * Auxiliar class to detect stops using accelerometer samples
 * 
 */
class StopDetector
{
    /**
     * Stop count
     */
    #stopCount = 0;
    /**
     * Max "stops" to consider a total stop
     * 
     */
    #stopLimit

    /**
     * 
     * @param {int} stopLimit 
     */
    constructor(stopLimit)
    {
        this.#stopLimit = stopLimit;
    }

    /**
     * 
     * @param {object} a Motion sample
     * @returns boolean
     */
    check(a)
    {
        let m = Math.hypot(a.x, a.y, a.z);
        if (m == 0.0) {
            if (this.#stopCount < this.#stopLimit) {
                this.#stopCount++;
            }
        }
        else if (this.#stopCount > 0) {
            this.#stopCount--;
        }
        return this.#stopCount == this.#stopLimit
    }
}

/**
 * Base class for Distance Counters
 * 
 */
class DistanceCounter extends EventTarget
{
    /**
     * Started flag
     * 
     * @var bool
     */
    _started = false;
    /**
     * Displacement counter
     * 
     * @var object
     */
    _s;

    /**
     * 
     */
    constructor()
    {
        super();
        this.clean();
    }

    /**
     * Adds a dsplacement to counter.
     * 
     * It uses orientation to rotate.
     * 
     * @param {object} s {x,y,z}
     * @param {object} ori Orientation
     */
    _addDist(s, ori)
    {
        // Rotate displacement using orientation angles
        ori.alpha = ori.alphaG; // Using alpha true north to set direction
        Coords.rotateByEuler(ori, s);

        // Do it this way to sum all values together
        this._s = {
            x: this._s.x + s.x,
            y: this._s.y + s.y,
            z: this._s.z + s.z,
        };

        let f = Object.clone(this._s);
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }

    /**
     * Counter is active?
     * 
     * @return bool
     */
    get active()
    {
        return this._started && motion.active && orient.active;
    }

    /**
     * Last displacement counted
     * 
     * @return {x,y,z}
     */
    get last()
    {
        return Object.clone(this._s);
    }

    /**
     * Starts counter
     * 
     */
    start()
    {
        this._started = true;
        this.clean();
    }

    /**
     * Stops counter
     * 
     */
    stop()
    {
        this._started = false;
    }

    /**
     * Flushs current displacement and reset it
     * 
     * @returns {x,y,z}
     */
    flush()
    {
        let last = this.last;
        this.clean();
        return last;
    }
    
    /**
     * Clean the distance computed
     * 
     */
    clean()
    {
        this._s = {x: 0, y: 0, z: 0};
    }

    /**
     * Destructor routine
     */
    destructor()
    {
        this.stop();
    }
}

/**
 * Distance service using "steps" to estimate distance
 * 
 */
export class PeakDistanceCounter extends DistanceCounter
{
    /**
     * Step meters
     * 
     * @var number
     */
    #mtr  = 0;
    #last = 0;
    #filter;

    /**
     * 
     * @param {number} stepDist Avg distance on each peak, in meters
     */
    constructor(stepDist=0.7)
    {
        super();
        this.#mtr = parseFloat(stepDist);
	    motion.addEventListener('change', this.#count.bind(this));
    }

    /**
     * Step counter
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    #count(e)
    {
        if (!this._started) {
            return;
        }
        if (!this.#filter) {
            this.#filter = new SMAFilter(motion.freq / 5);
        }

        const THRESHOLD    = 2; // 1.5^(num axes in result)
        const MIN_INTERVAL = 750;

        let a = e.detail.acceleration;
        let m = Math.hypot(a.x, a.y, a.z); // Sample magnitude
        m     = this.#filter.filter(m);
 
        let now = Date.now();
        let dt  = now - this.#last;
        if (m >= THRESHOLD && dt >= MIN_INTERVAL) {
            this.#last = now;
        }
        else {
            return;
        }

        let ori = Object.clone(orient.last); // Device's Earth orientation
        let s   = {x: 0, y: this.#mtr, z: 0}; // Default movement
        Coords.moveTo(s, a); // Move step to same direction of accel vector
        //console.log(Math.hypot(s.x, s.y, s.z));
        //console.log(s);
        this._addDist(s, ori); // Rotate movement to Earth's frame
    }

    /**
     * 
     */
    stop()
    {
        super.stop();
        this.#filter = null;
    }

    /**
     * 
     */
    destructor()
    {
        super.destructor();
        motion.removeEventListener('change', this.#count.bind(this));
    }
}

/**
 * Distance usign acceleration sensor and double integral
 * to estimate distance
 * 
 */
export class AccelDistanceCounter extends DistanceCounter
{
    /**
     * 
     */
    constructor()
    {
        super();
        this._a = {x: 0, y: 0, z: 0};
        this._v = {x: 0, y: 0, z: 0};

        function cf(freq) {
            return (new ChainFilter())
                .add(new SMAFilter(freq / 5))
                .add(new DistinctWindow(.2));
        }

        var stop;
        var f;

        this._update = (e) => {
            let dt = e.detail.interval / 1000;
            let a  = Object.clone(e.detail.acceleration);

            if (!stop) {
                let freq = motion.freq;
                f = {
                    x: cf(freq), y: cf(freq), z: cf(freq)
                };
                stop = new StopDetector(freq);
            }
            
            a.x = f.x.filter(a.x);
            a.y = f.y.filter(a.y);
            a.z = f.z.filter(a.z);

            let v = {x: 0, y: 0, z: 0};
            let s = {x: 0, y: 0, z: 0};

            if (!stop.check(a)) {
                v.x = this._v.x + ((a.x + this._a.x) * dt * .5);
                v.y = this._v.y + ((a.y + this._a.y) * dt * .5);
                v.z = this._v.z + ((a.z + this._a.z) * dt * .5);

                s.x = (v.x + this._v.x) * dt * .5;
                s.y = (v.y + this._v.y) * dt * .5;
                s.z = (v.z + this._v.z) * dt * .5;
            }

            this._a = a;
            this._v = v;

            if (!this._started) {
                return;
            }

            let ori = Object.clone(orient.last);
            this._addDist(s, ori);
        };

        motion.addEventListener('change', this._update.bind(this));
    }

    /**
     * 
     */
    destructor()
    {
        super.destructor();
        motion.removeEventListener('change', this._update.bind(this));
    }
}
