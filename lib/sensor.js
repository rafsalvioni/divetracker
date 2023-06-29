import { AppConfig as conf } from '../bin/config.js';
import { Angle, Coords } from './geo.js';
import { GpsProvider as gps } from './position.js';
import './proto.js';

/**
 * Service to get Orientation sensor.
 * 
 */
class OrientationService extends EventTarget
{
    constructor()
    {
        super();

        this.active = null;
        this.last   = null;

        window.addEventListener('deviceorientationabsolute', this.#updateOrient.bind(this));
    }

    #updateOrient(e)
    {
        if (!this.#active(e.alpha != null)) {
            return;
        }

        let f  = {
            alpha:  e.alpha,
            beta:   e.beta,
            gamma:  e.gamma
        };

        let rotate = screen.orientation.angle;

        switch (rotate) {
            case 90:
                f = {
                    alpha: f.alpha - 90,
                    beta: -f.gamma,
                    gamma: f.beta
                }
                break;
            case 180:
                f = {
                    alpha: f.alpha - 180,
                    beta:  -f.beta,
                    gamma: -f.gamma
                }
                break;
            case 270:
                f = {
                    alpha: f.alpha + 90,
                    beta:  f.gamma,
                    gamma: -f.beta
                }
                break;
        }

        // Create a alpha to geografic north
        f.alphaG   = Angle.use(f.alpha - gps.decli).pos().deg; 
        // Offset to bearing when screen face down
        let offset = Math.abs(f.beta) >= 90 ? 180 : 0;
        // Create a compass bearing from alpha
        f.compM    = Angle.use(-f.alpha + offset).pos().deg;
        // Creates a compass bearing to true north
        f.compG    = Angle.use(-f.alphaG + offset).pos().deg;

        this.last = f;
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }
   
    #active(set)
    {
        if (this.active == null || this.active != set) {
            if (!set) {
                this.dispatchEvent(new CustomEvent('error', {
                    detail: {
                        code: 1,
                        message: 'Unable to access orientation sensor'
                    }
                }));
            }
            this.active = set;
            this.dispatchEvent(new Event('active'));
        }
        return this.active;
    }

    roundAngle(a)
    {
        return (Math.round(a / conf.imu.compassScale) * conf.imu.compassScale) % 360;
    }
	
    scaleDiff(radius = 1)
    {
        return Math.toRadians(conf.imu.compassScale) * radius;
    }
}

/**
 * Service to get Motion sensor.
 * 
 */
class MotionService extends EventTarget
{
    constructor()
    {
        super();

        this.active = null;
        this.last   = null;

        window.addEventListener('devicemotion', this.#update.bind(this));
    }
    
    #update(e)
    {
       if (!this.#active(e.acceleration.y != null)) {
            return;
        }
        let f = {
            acceleration: {
                x: e.acceleration.x,
                y: e.acceleration.y,
                z: e.acceleration.z,
            },
            interval: e.interval
        };

        let rotate = screen.orientation.angle;
        if (rotate) {
            Coords.rotate(rotate, f.acceleration, 'z');
        }
        this.last = f;
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }

    #active(set)
    {
        if (this.active == null || this.active != set) {
            if (!set) {
                this.dispatchEvent(new CustomEvent('error', {
                    detail: {
                        code: 1,
                        message: 'Unable to access motion sensor'
                    }
                }));
            }
            this.active = set;
            this.dispatchEvent(new Event('active'));
        }
        return this.active;
    }
}

const orient = new OrientationService();
const motion = new MotionService();

export {orient as OrientationService, motion as MotionService};
