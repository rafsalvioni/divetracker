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

        window.addEventListener('deviceorientationabsolute', _updateOrient.bind(this));

        function _updateOrient(e)
        {
            if (!this._active(e.alpha != null)) {
                return;
            }

            let f  = {
                alpha: e.alpha,
                beta:  e.beta,
                gamma: e.gamma,
            };

            f.rotate = {
                alpha: screen.orientation.angle,
                beta:  0,
                gamma: 0,
                used:  screen.orientation.angle > 0
            };

            if (f.rotate.alpha) { // Rotate using screen orientation
                let trans = {x: f.beta, y: f.gamma};
                Coords.rotate(f.rotate.alpha, trans, 'z');
                f.alpha = Angle.use(f.alpha - f.rotate.alpha).pos().deg;
                f.beta  = trans.x;
                f.gamma = Angle.use(trans.y).wrap90().deg;
            }
            // Else, when screen face down, alpha not is changed... but we want to...
            else if (Math.abs(f.beta) >= 90) {
                f.alpha = Angle.use(f.alpha - 180).pos().deg; // So, lets correct it...
                f.beta  = -(f.beta < 0 ? f.beta + 180 : f.beta - 180); // And adjust beta for this
                f.gamma = -f.gamma;
                f.rotate.gamma = 180;
                f.rotate.used  = true;
            }
            // Alpha is anticlockwise, but compass not... So, we create a compass bearing
            f.compM = Angle.use(-f.alpha).pos().deg;
            // Creates a compass bearing to true north, using local declination
            f.compG = Angle.use(f.compM + gps.decli).pos().deg;

            this.last = f;
            this.dispatchEvent(new CustomEvent('change', {
                detail: f
            }));
        }
    }
    
    _active(set)
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

        window.addEventListener('devicemotion', _update.bind(this));

        function _update(e)
        {
           if (!this._active(e.acceleration.y != null)) {
                return;
            }
            let f = {
                acceleration: {
                    x: e.acceleration.x,
                    y: e.acceleration.y,
                    z: e.acceleration.z,
                },
                accelerationIncludingGravity: {
                    x: e.accelerationIncludingGravity.x,
                    y: e.accelerationIncludingGravity.y,
                    z: e.accelerationIncludingGravity.z,
                }
            }
            if (orient.last && orient.last.rotate.used) {
                let last = Object.clone(orient.last);
                Coords.rotateByEuler(last.rotate, f.acceleration);
                Coords.rotateByEuler(last.rotate, f.accelerationIncludingGravity);
            }
            this.last = f;
            this.dispatchEvent(new CustomEvent('change', {
                detail: f
            }));
        }
    }
    
    _active(set)
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
