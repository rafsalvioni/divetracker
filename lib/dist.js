import { Coords } from './geo.js';
import './proto.js';
import {MotionService as motion, OrientationService as orient} from './sensor.js';

export class DistanceCounter extends EventTarget
{
    start(){}

    stop(){}

    clean(){}

    flush(){}
}

/**
 * Distance service using acceleration peaks.
 * 
 */
export class PeakDistanceCounter extends DistanceCounter
{
    /**
     * 
     * @param {number} stepDist Avg distance on each peak, in meters
     */
    constructor(stepDist=0.7)
    {
        super();
        this._mtr     = stepDist;
        this._step    = false;
        this._s       = {x: 0, y: 0, z: 0};
        this._started = false;
        //this._counter = 0;
		
		this._count = (e) => {
            if (!this._started) {
                return;
            }

            const threshold = 1.5;
            let a = e.detail.acceleration.y;

            if (!this._step && a >= threshold) { //
                //console.log(`Step ahead begin: ${a}`);
                this._step = true;
                let ori = Object.clone(orient.last);
				this._addDist(ori);
                //console.log(`Step ${++this._counter}`);
            }
            else if (this._step && a < 0) {
                //console.log(`Step ahead end: ${a}`);
                this._step = false;
            }
		};

        motion.addEventListener('change', this._count.bind(this));
    }

    _addDist(ori)
    {
        let s = {
            x: 0, y: this._mtr, z: 0,
        };

        // Rotate displacement using orientation angles
        ori.alpha = ori.alphaG; // Using compass' true north to set direction, but we need to invert to correct rotation...
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

    get active()
    {
        return this._started && motion.active && orient.active;
    }

    get last()
    {
        return Object.clone(this._s);
    }

    start()
    {
        this._started = true;
        this._step = false;
        this.clean();
    }

    stop()
    {
        this._started = false;
        this._step = false;
    }

    flush()
    {
        let last = this.last;
        this.clean();
        return last;
    }
    
    /**
     * Clean the distance computed.
     */
    clean()
    {
        this._s = {x: 0, y: 0, z: 0};
    }

    destructor()
    {
        if (this._updateId) {
            clearInterval(this._updateId);
        }
        motion.removeEventListener('change', this._count.bind(this));
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
        this._s = {x: 0, y: 0, z: 0};
        this._v = {x: 0, y: 0, z: 0};
        this._started = false;
        let i   = 0;
        
        this._update = (e) => {
            let dt  = e.detail.interval / 1000;
            let a   = e.detail.acceleration;
            let ori = Object.clone(orient.last);
            
            a.x = Math.rounds(a.x, 3);
            a.y = Math.rounds(a.y, 3);
            a.z = Math.rounds(a.z, 3);

            this._v.x += a.x * dt; // V(t) = V0 + at
            this._v.y += a.y * dt;
            this._v.z += a.z * dt;
            
            if (Math.abs(a.x + a.y + a.z) < 0.01 && i++ == 10) { // Stop detection
                this._v = {x:0, y:0, z:0};
                i  = 0;
            }
            if (!this._started) {
                return;
            }
            
            let s = {
                x: this._v.x * dt, // S(t) = S0 + vt
                y: this._v.y * dt,
                z: this._v.z * dt
            };
            // Rotate instant distance using device orientation
            // But we are going to use true north as alpha. True north is clockwise, but expected alpha is anticlockwise. So, we inverted it
            ori.alpha = ori.alphaG;
            Coords.rotateByEuler(ori, s);
            
            this._s.x += s.x;
            this._s.y += s.y;
            this._s.z += s.z;
        };

        motion.addEventListener('change', this._update.bind(this));
    }

    get active()
    {
        return this._started && motion.active && orient.active;
    }

    get last()
    {
        return Object.clone(this._s);
    }

    start()
    {
        this._started = true;
        this._step = false;
        this.clean();
    }

    stop()
    {
        this._started = false;
        this._step = false;
    }

    flush()
    {
        let last = this.last;
        this.clean();
        return last;
    }
    
    /**
     * Clean the distance computed.
     */
    clean()
    {
        this._s = {x: 0, y: 0, z: 0};
    }

    destructor()
    {
        if (this._updateId) {
            clearInterval(this._updateId);
        }
        motion.removeEventListener('change', this._update.bind(this));
    }
}
