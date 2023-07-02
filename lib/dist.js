import { Coords } from './trigo.js';
import './proto.js';
import {MotionService as motion, OrientationService as orient} from './sensor.js';

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
 * Distance service using axe Y acceleration peaks.
 * 
 */
export class PeakYDistanceCounter extends DistanceCounter
{
    /**
     * Step meters
     * 
     * @var number
     */
    #mtr;
    /**
     * Stept active flag
     * 
     * @var bool
     */
    _step = false;

    /**
     * 
     * @param {number} stepDist Avg distance on each peak, in meters
     */
    constructor(stepDist=0.7)
    {
        super();
        this.#mtr = parseFloat(stepDist);
        //this._counter = 0;
		
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

        const threshold = 1.5;
        let a = e.detail.acceleration.y;

        if (!this._step && a >= threshold) { //
            //console.log(`Step ahead begin: ${a}`);
            this._step = true;
            let ori    = Object.clone(orient.last);
            this._addDist({
                x: 0, y: this.#mtr, z: 0,
            }, ori);
            //console.log(`Step ${++this._counter}`);
        }
        else if (this._step && a < 0) {
            //console.log(`Step ahead end: ${a}`);
            this._step = false;
        }
    };
    
    /**
     * 
     */
    stop()
    {
        super.stop();
        this._step = false;
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
 * Distance service using 3D "steps" to estimate distance
 * 
 * A try to get side movements
 * 
 */
export class PeakResultDistanceCounter extends DistanceCounter
{
    /**
     * Step meters
     * 
     * @var number
     */
    #mtr  = 0;
    /**
     * Movement cycle
     * 
     * @var number[]
     */
    _move = [0, 0];

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

        const threshold = 4; // 1.5^(num axes in result)
        let a   = e.detail.acceleration;
        const r = Math.hypot(a.x, a.y, a.z); // Just interest X and Y
        let ori = Object.clone(orient.last);
        let sum = false;

        // We are using acceleration result. It is always positive
        // In a normal movement, we have 2 positive peaks: move and stop
        // However, we should to count just move peaks
        switch (this._move[0]) {
            case 0: // Move peak up
            case 2: // Stop peak up
                if (r >= threshold) {
                    this._move[0]++;
                    this._move[1] = r * .8;
                    sum = this._move[0] == 1;
                    //console.log(`Up: ${this._move}, ${r}`);
                }
                break;
            case 1: // Move peak down
            case 3: // Stop peak down
                if (r <= this._move[1]) { // Peak down
                    this._move[0] = (++this._move[0] % 4);
                    //console.log(`Down: ${this._move}, ${r}`);
                }
                break;
        }

        if (sum) {
            //console.log('Sum dist');
            let f = this.#mtr / r; // Conversion factor between "step" and result
            let s = { // Distribute "step" into axes
                x: a.x * f,
                y: a.y * f,
                z: 0
            };
            this._addDist(s, ori);
        }
    }

    /**
     * 
     */
    start()
    {
        super.start();
        this._move = [0, 0];
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
        this._v = {x: 0, y: 0, z: 0};

        let stop = 0;
        let freq;
        function checkStop(a) {
            if (a.m < 0.5) {
                if (stop < freq) {
                    stop++;
                }
            }
            else if (stop > 0) {
                stop--;
            }
            return stop == freq;
        }
        
        this._update = (e) => {
            let dt   = e.detail.interval / 1000;
            let a    = e.detail.acceleration;
            let ori  = Object.clone(orient.last);
            if (freq == null) {
                freq = parseInt(1 / dt);
            }

            if (checkStop(a)) {
                this._v = {x: 0, y: 0, z: 0};
                return;
            }
            else {
                this._v.x += a.x * dt;
                this._v.y += a.y * dt;
                this._v.z += a.z * dt;
            }

            if (!this._started) {
                return;
            }

            let s = {
                x: Math.rounds(this._v.x * dt, 3),
                y: Math.rounds(this._v.y * dt, 3),
                z: Math.rounds(this._v.z * dt, 3)
            };

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
