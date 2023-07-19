import { Coords, Vector } from './trigo.js';
import './proto.js';
import { MotionService as motion, OrientationService as orient } from './sensor.js';
import { DistinctWindow, SMAFilter } from './sfilter.js';
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
     * To return true, the count of "no accel" should be equal
     * stopLimit given in constructor
     * 
     * @param {boolean} noAccel Count a "no accel" occur?
     * @returns boolean
     */
    check(noAccel)
    {
        if (noAccel) {
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

class Collector
{
    #source;
    #data;

    constructor()
    {
        this.__listener = this.__listener.bind(this);
    }

    __listener(e)
    {
        if (e.type == 'step') {
            this.#data.steps++;
            this.#data.vd = this.#data.vd.sum(e.detail);
            this.#data.dist += Vector.create(e.detail).size;
            return;
        }
        this.#data.min = Math.min(this.#data.min, e.detail);
        this.#data.max = Math.max(this.#data.max, e.detail);
    }

    start(counter)
    {
        if (this.#source) {
            this.stop();
            this.#source = null;
        }
        this.#data = {
            min: 0, max: 0, steps: 0, vd: new Vector(0,0,0), dist: 0, start: Date.now()
        };
        counter.addEventListener('sample', this.__listener);
        counter.addEventListener('step', this.__listener);
        this.#source = counter;
        counter.start();
        return this;
    }

    stop()
    {
        if (this.#source) {
            this.#source.removeEventListener('sample', this.__listener);
            this.#source.removeEventListener('step', this.__listener);
            this.#data.stop = Date.now();
            this.#data.dt   = this.#data.stop - this.#data.start;
            this.#data.vd   = this.#data.vd.coords;
            this.#data.avg  = (this.#data.min + this.#data.max) / 2;
        }
        return this;
    }

    get active()
    {
        return this.#source && this.#source.active;
    }

    get data()
    {
        return this.active ? null : this.#data;
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
     * @var {Collector}
     */
    _collector;

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
        let s2 = Object.clone(s); // Copy to dont change original "S"
        // Rotate displacement using orientation angles
        ori.alpha = ori.alphaG; // Using alpha true north to set direction
        Coords.rotateByEuler(ori, s2);

        // Do it this way to sum all values together
        this._s = {
            x: this._s.x + s2.x,
            y: this._s.y + s2.y,
            z: this._s.z + s2.z,
        };

        /*let f = Object.clone(this._s);
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));*/
    }

    /**
     * Returns collected data
     * 
     * @returns {object}
     */
    collectorData()
    {
        return this._collector ? this._collector.data : null;
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
     * @var {boolean} analyze Use analizer?
     */
    start(analyze = false)
    {
        if (analyze) {
            if (!this._collector) {
                this._collector = new Collector();
            }
            this._collector.start(this);
        }
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
        if (this._collector) {
            this._collector.stop();
        }
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
     * Uses collected data to calc counter accuracy
     * 
     * @returns float
     */
    calcAccuracy()
    {
        let data = this.collectorData();
        if (!data) {
            throw 'No collected data!';
        }

        let dist;
        try {
            dist  = Math.abs(parseFloat(prompt('How much distance (in meters)?')));
            return Math.rounds(data.dist / dist, 2);
        } catch (e) {
            alert(e);
        }
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
class PeakYDistanceCounter extends DistanceCounter
{
    #mtr  = 0;
    #step = false;

    /**
     * 
     * @param {float} stepDist
     */
    constructor(stepDist = conf.imu.counters.peakY.stepDist)
    {
        super();
        this.#mtr = parseFloat(stepDist);
        this.__counter = this.__counter.bind(this);
    }

    /**
     * Step counter
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    __counter(e)
    {
        const THRESHOLD_IN  = conf.imu.counters.peakY.threshold;
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
     * @param {boolean} analyze 
     */
    start(analyze = false)
    {
        this.#step = false;
        if (analyze) {
            alert('You will need count your steps and total distance did. Ready?');
        }
        super.start(analyze);
        motion.addEventListener('change', this.__counter);
    }

    /**
     * 
     */
    stop()
    {
        motion.removeEventListener('change', this.__counter);
        super.stop();
    }

    /**
     * 
     * @returns {object}
     */
    calcConf()
    {
        let data = this.collectorData();
        if (!data) {
            return;
        }

        let steps, dist;
        try {
            steps = Math.abs(parseInt(prompt('How much \'steps\'?')));
            dist  = Math.abs(parseFloat(prompt('How much distance (in meters)?')));
        } catch (e) {
            alert(e);
        }
        return {
            threshold: Math.rounds(data.max * .6, 2),
            stepDist: Math.rounds(dist / steps, 2)
        };
    }
}

/**
 * Distance service using acceleration 3D peaks to estimate distance
 * 
 */
class Peak3DistanceCounter extends DistanceCounter
{
    #mtr = 0;
    #ts  = 0;
    #filter;

    /**
     * 
     * @param {float} stepDist
     */
    constructor(stepDist = conf.imu.counters.peak3d.stepDist)
    {
        super();
        this.#mtr = parseFloat(stepDist);
        this.__counter = this.__counter.bind(this);
    }

    /**
     * Step counter
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    __counter(e)
    {
        const THRESHOLD    = conf.imu.counters.peak3d.threshold;
        const MIN_INTERVAL = conf.imu.counters.peak3d.minInterval;

        let av = Vector.create(e.detail.acceleration).filtered(this.#filter); // Accel vector filtered
        let am = av.size;
 
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
     * @param {boolean} analyze 
     */
    start(analyze = false)
    {
        if (!this.#filter) {
            this.#filter = new SMAFilter(motion.freq / 5);
        }
        else {
            this.#filter.reset();
        }
        if (analyze) {
            alert('You will need count your steps and total distance did. Ready?');
        }
        super.start(analyze);
        motion.addEventListener('change', this.__counter);
    }

    /**
     * 
     */
    stop()
    {
        motion.removeEventListener('change', this.__counter);
        super.stop();
    }

    /**
     * 
     * @returns {object}
     */
    calcConf()
    {
        let data = this.collectorData();
        if (!data) {
            return;
        }

        let steps, dist;
        try {
            steps = Math.abs(parseInt(prompt('How much \'steps\'?')));
            dist  = Math.abs(parseFloat(prompt('How much distance (in meters)?')));
        } catch (e) {
            alert(e);
        }
        return {
            threshold: Math.rounds(data.avg * 1.1, 2),
            stepDist: Math.rounds(dist / steps, 2),
            minInterval: parseInt((data.dt / steps) * .75)
        };
    }
}

/**
 * Distance usign acceleration sensor and double integral
 * to estimate distance
 * 
 */
class AccelDistanceCounter extends DistanceCounter
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
            return new SMAFilter(freq / 5);
        }

        var stop;
        var f;
        var dw = new DistinctWindow(conf.imu.counters.accel.threshold);

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

            // Apply low pass filters in each component
            let av = Vector.create(a).filtered(f.x, f.y, f.z);

            this.dispatchEvent(new CustomEvent('sample', {
                detail: av.size
            }));
    
            av  = av.filtered(dw); // Apply distinct window in whole vector
            a   = av.coords;

            let v = {x: 0, y: 0, z: 0};
            let s = {x: 0, y: 0, z: 0};
            let add = false;

            if (!stop.check(av.size == 0)) {
                add = true;

                v.x = this._v.x + ((a.x + this._a.x) * dt * .5);
                v.y = this._v.y + ((a.y + this._a.y) * dt * .5);
                v.z = this._v.z + ((a.z + this._a.z) * dt * .5);

                s.x = (v.x + this._v.x) * dt * .5;
                s.y = (v.y + this._v.y) * dt * .5;
                s.z = (v.z + this._v.z) * dt * .5;
            }

            this._a = a;
            this._v = v;

            if (!this._started || !add) {
                return;
            }

            let ori = Object.clone(orient.last);
            this._addDist(s, ori);

            this.dispatchEvent(new CustomEvent('step', {
                detail: s
            }));
        };

        this._update = this._update.bind(this);
        motion.addEventListener('change', this._update);
    }

    start(analyze = false)
    {
        if (analyze) {
            alert('You should do movements in a circle to measure a stop radius. Ready?');
        }
        super.start(analyze);
    }

    /**
     * 
     * @returns {object}
     */
    calcConf()
    {
        let data = this.collectorData();
        if (!data) {
            return;
        }
        return {
            threshold: Math.rounds(data.max * .1, 2)
        };
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

export function loadCounter()
{
    switch (conf.imu.counter) {
        case 'peakY':
            return new PeakYDistanceCounter();
        case 'peak3d':
            return new Peak3DistanceCounter();
        case 'accel':
            return new AccelDistanceCounter();
        default:
            throw 'Unknown default IMU distance counter';
    }
}
