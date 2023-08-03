import './proto.js';
import { Vector } from './trigo.js';
import { GeoPoint } from './geo.js';
import { loadCounter } from './dist.js';
import { MagVar } from './magvar.js';
import { AppConfig as conf } from '../bin/config.js';

/**
 * Base class for Position Providers
 * 
 */
class PositionProvider extends EventTarget
{
    /**
     * Indicates if provider is active
     * 
     * @var boolean
     */
    active;
    /**
     * Last position given
     * 
     * @var object
     */
    last;

    /**
     * Provider identifier
     * 
     */
    get mode()
    {
        return this.constructor.name;
    }
}

/**
 * Interval to update position
 */
const POS_UPD_TIME = conf.track.calcPos * .75;
/**
 * Max idle time to GPS be considered inactive
 */
const GPS_MAX_IDLE = conf.track.calcPos * 3;

/**
 * Position Provider using GPS signal.
 * 
 */
class GpsProvider extends PositionProvider
{
    /**
     * Last Magnetic declination retrieved
     * 
     * @var number
     */
    decli = 0;

    /**
     * 
     */
    constructor()
    {
        super();
        var ts = Date.now();
        
        this._geo = navigator.geolocation.watchPosition(_update.bind(this), _error.bind(this), {
            maximumAge: POS_UPD_TIME,
            enableHighAccuracy: true
        });

        /**
         * GPS Location listener
         * 
         * @param {GeolocationPosition} e 
         */
        function _update(e)
        {
            let f = {
                pos: new GeoPoint(e.coords.latitude, e.coords.longitude, e.coords.altitude ?? 0),
                accur: e.coords.accuracy
            }
            if (!this.active) {
                // When reactived, updates declination. Its avoid the amount of calcs
                this.decli = MagVar.get(f.pos.lat, f.pos.lon);
                this._active(true);
            }
            ts = Date.now();
            this.last = f;
            this.dispatchEvent(new CustomEvent('change', {
                detail: f
            }));
        }
    
        /**
         * GPS Error listener
         * 
         * @param {GeolocationPositionError} e 
         */
        function _error(e)
        {
            this._active(false);
            this.dispatchEvent(new CustomEvent('error', {
                detail: e
            }));
        }

        /**
         * Auxiliar to check GPS activity
         * 
         */
        function _checkActive()
        {
            if (this.active) {
                this._active((Date.now() - ts) <= GPS_MAX_IDLE);
            }
        }
        this._activeId = setInterval(_checkActive.bind(this), GPS_MAX_IDLE);
    }

    /**
     * Sets and fires position activity
     * 
     * @param {boolean} set 
     */
    _active(set)
    {
        if (this.active != set) {
            this.active = set;
            this.dispatchEvent(new Event('active'));
        }
    }

    /**
     * 
     */
    get mode()
    {
        return 'GPS';
    }

    /**
     * Last point is accurate?
     * 
     * @returns boolean
     */
    isAccurate()
    {
        return this.last ? this.last.accur <= conf.gps.minAccur : false;
    }

    /**
     * 
     */
    destructor()
    {
        /*if (this._geo) {
            navigator.geolocation.clearWatch(this._geo);
        }
        clearInterval(this._activeId);*/
    }
}

/**
 * Accuracy factor
 */
const IMU_ACCUR_FACTOR = Math.abs(1 - conf.imu.counters.current.accuracy);

/**
 * Position Provider using inertial navigation.
 * 
 */
export class ImuProvider extends PositionProvider
{
    /**
     * Distance counter
     * 
     * @var DistanceCounter
     */
    #dist;
    /**
     * Reference position
     * 
     * @var Point
     */
    #ref;
    /**
     * Current accuracy
     * 
     * @var number
     */
    #accur;
    /**
     * Interval update ID
     * 
     * @var int
     */
    #updateId;
    /**
     * Distance buffer
     * 
     * @var object
     */
    _s;

    /**
     * 
     * @param {object} lastPos Last position data (point and accur). If given, will be started
     */
    constructor(lastPos = null)
    {
        super();
        this._s = new Vector(0,0,0);
        this._sumDist = this._sumDist.bind(this);

        // Update position periodically
        this.#updateId = setInterval(this.#updatePos.bind(this), POS_UPD_TIME);

        if (lastPos) {
            this.start(lastPos);
        }
        else {
            this.stop();
        }
    }
    
    /**
     * Distance listener
     *
     * It sums distances received in a buffer
     * 
     */
    _sumDist(e)
    {
        this._s = this._s.sum(e.detail);
    }
    
    /**
     * Position updater
     *
     * Flushes the distance buffer and adding it in reference GeoPoint,
     * creating a new position
     * 
     */
    #updatePos()
    {
        if (!this.#active()) {
            return;
        }
        
        let dist = this._s.coords; // Copy current S
        this._s  = this._s.resized(0); // Emptys S
        // Creates a new position with acumulated distance
        let pos  = this.#ref.fromMeters(dist.x, dist.y, dist.z);
        
        this.#accur += pos.distanceTo(this.#ref) * IMU_ACCUR_FACTOR;
        this.#ref   = pos;

        let f = {
            pos:   pos,
            accur: this.#accur
        };

        this.last = f;
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }

    /**
     * Sets active flag
     * 
     */
    #active()
    {
        let state = !!this.#ref && !!this.#dist && this.#dist.active;
        if (this.active != state) {
            this.active = state;
            this.dispatchEvent(new Event('active'));
        }
        return this.active;
    }

    /**
     * 
     */
    get mode()
    {
        return 'IMU';
    }

    /**
     * Start IMU if not started.
     * 
     * @param {object} lastPos Last position data (point and accur)
     */
    start(lastPos)
    {
        if (!this.#dist) {
            this.#dist = loadCounter();
        }
        if (!this.#ref) {
            this.#ref   = lastPos.pos;
            this.#accur = lastPos.accur;
            this.#dist.addEventListener('change', this._sumDist);
            this.#dist.start();
            this.#updatePos();
        }
    }

    /**
     * Stop IMU if started.
     * 
     */
    stop()
    {
        if (this.#ref) {
            this.#updatePos();
            this.#dist.stop();
            this.#dist.removeEventListener('change', this._sumDist);
            this.#ref   = null;
            this.#accur = 0;
            this.#active();
        }
    }
    
    /**
     * Reset the provider, using a new reference point.
     * 
     * @param {object} lastPos Last position data (point and accur)
     */
    reset(lastPos)
    {
        if (this.#ref) {
            this.#updatePos();
            this.#ref   = lastPos.pos;
            this.#updatePos();
            this.#accur = lastPos.accur;
        }
    }

    /**
     * 
     */
    destructor()
    {
        clearInterval(this.#updateId);
        if (this.#dist) {
            this.#dist.destructor();
        }
    }
}

/**
 * Position Provider that uses information from GPS and IMU positions.
 * 
 * The update prioritizes GPS position. However, if GPS signal was lost or their accuracy is low, the position
 * will be retrieved from IMU service.
 *  
 */
class FusionProvider extends PositionProvider
{
    /**
     * Current mode
     * 
     * @var string
     */
    #mode;
    /**
     * IMU Provider
     * 
     * @var ImuProvider
     */
    #imu;
    /**
     * Last GPS data
     * 
     * @var object
     */
    #gps;

    /**
     * 
     */
    constructor()
    {
        super();
        this.#mode  = 'NONE';
        this.#imu   = new ImuProvider();

        var me = this;

        gps.addEventListener('change', (e) => {
            if (e.target.isAccurate()) {
                me.#imu.stop();
                me.#gps = e.detail;
                me.#update(e.detail, e.target.mode);
            }
            else if (me.#gps) {
                me.#imu.start(me.#gps);
            }
            else {
                me.#update(e.detail, e.target.mode);
            }
        });
        gps.addEventListener('active', (e) => {
            if (!e.target.active && me.last) {
                me.#imu.start(me.last);
            }
            me.#active();
        });

        this.#imu.addEventListener('change', (e) => {
            me.#update(e.detail, e.target.mode);
        });
        this.#imu.addEventListener('active', (e) => {
            me.#active();
        });
    }

    /**
     * Position updater
     * 
     * @param {obejct} last 
     * @param {string} mode 
     */
    #update(last, mode)
    {
        this.last  = last;
        this.#mode = mode;
        this.dispatchEvent(new CustomEvent('change', {
            detail: last
        }));
    }

    /**
     * Sets active flag
     * 
     */
    #active()
    {
        let state = gps.active || this.#imu.active;
        if (state != this.active) {
            this.active = state;
            this.dispatchEvent(new Event('active'));
        }
    }

    /**
     * Return the provider mode "FUSION(GPS/IMU/NONE)".
     * 
     * @returns string
     */
    get mode()
    {
        return `FUSION(${this.#mode})`;
    }

    /**
     * 
     */
    destructor()
    {
        //this._imu.destructor();
    }
}

const gps = new GpsProvider();
const fus = new FusionProvider();
export {gps as GpsProvider, fus as FusionProvider};
