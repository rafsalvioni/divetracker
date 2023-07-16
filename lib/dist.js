import { Coords, Vector } from './trigo.js';
import './proto.js';
import { MotionService as motion, OrientationService as orient } from './sensor.js';
import { ChainFilter, DistinctWindow, SMAFilter } from './sfilter.js';
import { AppConfig as conf } from '../bin/config.js';

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
     * Checks for a stop.
     * 
     * To count a vector as a "stop", vector size should be zero.
     * So, a DistinctWindow to eliminate noses is essential!
     * 
     * To return true, the count of zero vectors should be equal
     * stopLimit given in constructor
     * 
     * @param {object} a Motion sample
     * @returns boolean
     */
    check(a)
    {
        let m = Vector.create(a).size;
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

        /*let f = Object.clone(this._s);
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));*/
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
 * Distance service using acceleration Y axe peaks to estimate distance
 * 
 */
export class PeakYDistanceCounter extends DistanceCounter
{
    #mtr  = 0;
    #step = false;

    /**
     * 
     * @param {float} stepDist
     */
    constructor(stepDist = conf.imu.stepDist)
    {
        super();
        this.#mtr = parseFloat(stepDist);
        this.__counter = this.__counter.bind(this);
        motion.addEventListener('change', this.__counter);
    }

    /**
     * Step counter
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    __counter(e)
    {
        if (!this._started) {
            return;
        }

        const THRESHOLD_IN  = conf.imu.peakSensibility.y;
        const THRESHOLD_OUT = -parseInt(THRESHOLD_IN / 2);

        let ay  = e.detail.acceleration.y;
        let add = false;

        this.dispatchEvent(new CustomEvent('sample', {
            detail: ay
        }));

        if (!this.#step && ay >= THRESHOLD_IN) {
            this.#step = true;
            add = true;
        }
        else if (this.#step && ay < THRESHOLD_OUT) {
            //console.log(`Step out ${ay}`);
            this.#step = false;
        }
        if (!add) { // No peak? stop
            return;
        }

        //console.log(`Step in ${ay}`);
        let ori = Object.clone(orient.last); // Device's Earth orientation
        let s   = {x: 0, y: this.#mtr, z: 0}; // Default movement in Y
        this._addDist(s, ori); // Rotate movement to Earth's frame

        this.dispatchEvent(new CustomEvent('step', {
            detail: s
        }));
    }

    /**
     * 
     */
    start()
    {
        this.#step = false;
        super.start();
    }

    /**
     * 
     */
    destructor()
    {
        super.destructor();
        motion.removeEventListener('change', this.__counter);
    }
}

/**
 * Distance service using acceleration 3D peaks to estimate distance
 * 
 */
export class Peak3DistanceCounter extends DistanceCounter
{
    #mtr = 0;
    #ts  = 0;
    #filter;

    /**
     * 
     * @param {float} stepDist
     */
    constructor(stepDist = conf.imu.stepDist)
    {
        super();
        this.#mtr = parseFloat(stepDist);
        this.__counter = this.__counter.bind(this);
        motion.addEventListener('change', this.__counter);
    }

    /**
     * Step counter
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    __counter(e)
    {
        if (!this._started) {
            return;
        }

        const THRESHOLD    = conf.imu.peakSensibility.m;
        const MIN_INTERVAL = conf.imu.minInterval;

        let av = Vector.create(e.detail.acceleration); // Accel vector
        let am = this.#filter.filter(av.size); // Filter accel total
 
        this.dispatchEvent(new CustomEvent('sample', {
            detail: am
        }));

        let now = Date.now();
        let dt  = now - this.#ts;
        if (am >= THRESHOLD && dt >= MIN_INTERVAL) { // A movement in a allowed interval...
            // Peak!
            this.#ts = now; // Save TS
        }
        else {
            return;
        }

        // If is here, a peak was found!
        let ori = Object.clone(orient.last); // Device's Earth orientation
        let s   = av.resized(this.#mtr).coords; // Resize accel vector to estimated size. So, we have a step in accel direction
        //console.log(av);
        //console.log(s);
        //console.log(Math.hypot(s.x, s.y, s.z));
        this._addDist(s, ori); // Rotate movement to Earth's frame

        this.dispatchEvent(new CustomEvent('step', {
            detail: s
        }));
    }

    /**
     * 
     */
    start()
    {
        if (!this.#filter) {
            this.#filter = new SMAFilter(motion.freq / 5);
        }
        else {
            this.#filter.reset();
        }
        super.start();
    }

    /**
     * 
     */
    destructor()
    {
        super.destructor();
        motion.removeEventListener('change', this.__counter);
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

        this._update = this._update.bind(this);
        motion.addEventListener('change', this._update);
    }

    /**
     * 
     */
    destructor()
    {
        super.destructor();
        motion.removeEventListener('change', this._update);
    }
}
