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

            const threshold = 1.2;
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
        ori.alpha = -ori.compG; // Using compass' true north to set direction, but we need to invert to correct rotation...
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
