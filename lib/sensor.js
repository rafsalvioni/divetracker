import { AppConfig as conf } from '../bin/config.js';
import { Angle, Coords } from './trigo.js';
import { GpsProvider as gps } from './position.js';
import './proto.js';

/**
 * Service to get Orientation sensor.
 * 
 */
class OrientationService extends EventTarget
{
    /**
     * Indicates if service is active
     * 
     * @var boolean
     */
    active;
    /**
     * Stores last reading
     * 
     * @var object
     */
    last;
    
    /**
     * 
     */
    constructor()
    {
        super();
        window.addEventListener('deviceorientationabsolute', this.#updateOrient.bind(this));
    }

    /**
     * Receives sensor reading and does operations
     * 
     * Apply screen orientation on sensor reading
     * 
     * @param {DeviceOrientationEvent} e 
     */
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
   
    /**
     * Sets "active" flag
     * 
     * @param {boolean} set 
     * @returns boolean
     */
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

    /**
     * Rounds given angle using configuration scale.
     * 
     * @param {number} a Angle 
     * @returns int
     */
    roundAngle(a)
    {
        return (Math.round(a / conf.imu.compassScale) * conf.imu.compassScale) % 360;
    }
	
    /**
     * 
     * @param {number} radius 
     * @returns number
     */
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
    /**
     * Sensor offset bias
     * 
     * @var object
     */
    #offset = {x: 0, y: 0, z: 0};
    /**
     * Indicates if service is active
     * 
     * @var boolean
     */
    active;
    /**
     * Stores last reading
     * 
     * @var object
     */
    last;

    /**
     * 
     */
    constructor()
    {
        super();

        window.addEventListener('devicemotion', this.#update.bind(this));
    }
    
    /**
     * Receives sensor readings and does operations
     * 
     * Rotate sensor reading using screen orientation
     * 
     * @param {DeviceMotionEventAcceleration} e 
     */
    #update(e)
    {
       if (!this.#active(e.acceleration.y != null)) {
            return;
        }
        let f = {
            acceleration: {
                x: e.acceleration.x - this.#offset.x,
                y: e.acceleration.y - this.#offset.y,
                z: e.acceleration.z - this.#offset.z,
            },
            interval: e.interval
        };
        // Acceleration magnitude
        f.acceleration.m = Math.hypot(f.acceleration.x, f.acceleration.y, f.acceleration.z);

        let rotate = screen.orientation.angle;
        if (rotate) {
            Coords.rotate(rotate, f.acceleration, 'z');
        }
        this.last = f;
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }

    /**
     * Sets "active" flag
     * 
     * @param {boolean} set 
     * @returns boolean
     */
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
    
    /**
     * Does a sensor calibration.
     * 
     * It calcs sensor bias and stores their results. This bias will be subtracted
     * from sensor reading.
     * 
     * "force" argument forces a new calculation
     * 
     * @param {boolean} force Force? 
     * @returns 
     */
    calibrate(force = false)
    {
        const KEY = '_accelOffset_';
        var me    = this;
    
        if (!force) {
            try {
                me.#offset = JSON.parse(window.localStorage[KEY]);
                return;
            } catch (e) {
                // continue
            }
            alert('No calibration data found! Lets calibrate now...');
        }
        
        alert('Put your device in a plan surface and don\'t touch it!. Ready?');
        
        const TIME = 5000;
        let count  = 0;
        let offset = {x: 0, y: 0, z: 0};
        let start  = Date.now();
        
        function c(e)
        {
            offset.x += e.acceleration.x;
            offset.y += e.acceleration.y;
            offset.z += e.acceleration.z;
            count++;
            let diff  = Date.now() - start;
            if (diff >= TIME) {
                window.removeEventListener('devicemotion', c, true);
                offset.x /= count;
                offset.y /= count;
                offset.z /= count;
                let str = JSON.stringify(offset);
                if (window.localStorage) {
                    window.localStorage[KEY] = str;
                }
                me.#offset = offset;
                alert(`Calibration done!\n\n${str}`);
            }
        }
        window.addEventListener('devicemotion', c, true);
    }
}

const orient = new OrientationService();
const motion = new MotionService();

export {orient as OrientationService, motion as MotionService};
