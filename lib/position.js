import { Point } from './geo.js';
import { OrientationService as orient } from './sensor.js';
import { PeakDistanceCounter } from './dist.js';
import './proto.js';
import { MagVar } from './magvar.js';
import { AppConfig as conf } from '../bin/config.js';

/**
* Position Provider using GPS signal.
* 
*/
class GpsProvider extends EventTarget
{
    constructor()
    {
        super();

        this._ts    = Date.now();
        this.active = null;
        this.last   = null;
        this.decli  = 0;
        
        this._geo = navigator.geolocation.watchPosition(_update.bind(this), _error.bind(this), {
            maximumAge: conf.track.calcPos * .75,
            enableHighAccuracy: true
        });

        function _update(e)
        {
            let f = {
                pos: new Point(e.coords.latitude, e.coords.longitude, e.coords.altitude ?? 0),
                accur: e.coords.accuracy
            }
            if (!this.active) {
                // When reactived, updates declination. Its avoid the amount of calcs
                this.decli = MagVar.get(f.pos.lat, f.pos.lon);
                this._active(true);
            }
            this._ts  = Date.now();
            this.last = f;
            this.dispatchEvent(new CustomEvent('change', {
                detail: f
            }));
        }
    
        function _error(e)
        {
            this._active(false);
            this.dispatchEvent(new CustomEvent('error', {
                detail: e
            }));
        }

        function _checkActive()
        {
            if (this.active) {
                this._active((Date.now() - this._ts) <= conf.gps.activeFreq);
            }
        }
        this._activeId = setInterval(_checkActive.bind(this), conf.gps.activeFreq);
    }

    _active(set)
    {
        if (this.active != set) {
            this.active = set;
            this.dispatchEvent(new Event('active'));
        }
    }

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

    destructor()
    {
        /*if (this._geo) {
            navigator.geolocation.clearWatch(this._geo);
        }
        clearInterval(this._activeId);*/
    }
}

/**
 * Position Provider using inertial navigation.
 * 
 */
export class ImuProvider extends EventTarget
{
    /**
     * 
     * @param {Point} ref Reference point. If given, will be started
     * @param {number} accur Initial accuracy
     */
    constructor(ref=null, accur=0)
    {
        super();
        
        this.active = false;
        this.last;
        this._dist = new PeakDistanceCounter();

        if (ref) {
            this.start(ref, accur);
        }
        else {
            this.stop();
        }
        
        // Update position periodically
        this._updateId = setInterval(this._updatePos.bind(this), conf.track.calcPos * .75);
    }
    
    _updatePos()
    {
        if (!this._active()) {
            return;
        }

        let dist = Object.clone(this._dist.flush());
        let pos  = this._ref.fromMeters(dist.x, dist.y, dist.z);

        this._accur += pos.distanceTo(this._ref) * .02;
        this._ref   = pos;

        let f = {
            pos: pos,
            accur: this._accur
        };

        this.last = f;
        this.dispatchEvent(new CustomEvent('change', {
            detail: f
        }));
    }

    _active()
    {
        let state = !!this._ref && this._dist.active;
        if (this.active != state) {
            this.active = state;
            this.dispatchEvent(new Event('active'));
        }
        return this.active;
    }

    get mode()
    {
        return 'IMU';
    }

    /**
     * Start IMU if not started.
     * 
     * @param {Point} ref Reference point
     * @param {number} accur Initial accuracy
     */
    start(ref, accur=0)
    {
        if (!this._ref) {
            this._ref   = ref;
            this._accur = Number(accur);
            this._dist.start();
            this._updatePos();
        }
    }

    /**
     * Stop IMU if started.
     * 
     */
    stop()
    {
        if (this._ref) {
            this._updatePos();
            this._dist.stop();
            this._ref   = null;
            this._accur = 0;
            this._active();
        }
    }
    
    /**
     * Reset the provider, using a new reference point.
     * 
     * @param {Point} ref New reference
     * @param {number} accur New accuracy
     */
    reset(ref, accur=0)
    {
        if (this._ref) {
            this._updatePos();
            this._ref   = ref;
            this._updatePos();
            this._accur = Number(accur);
        }
    }

    destructor()
    {
        clearInterval(this._updateId);
        if (this._dist) {
            this._dist.destructor();
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
class FusionProvider extends EventTarget
{
    constructor()
    {
        super();
        this.last;
        this.active = null;
        this._mode  = 'NONE';
        this._imu   = new ImuProvider();

        var me = this;

        gps.addEventListener('change', (e) => {
            if (e.target.isAccurate()) {
                me._imu.stop();
                me._gps = e.detail;
                me._update(e.detail, e.target.mode);
            }
            else if (me._gps) {
                me._imu.start(me._gps.pos, me._gps.accur);
            }
            else {
                me._update(e.detail, e.target.mode);
            }
        });
        gps.addEventListener('active', (e) => {
            if (!e.target.active && me.last) {
                me._imu.start(me.last.pos, me.last.accur);
            }
            me._active();
        });

        this._imu.addEventListener('change', (e) => {
            me._update(e.detail, e.target.mode);
        });
        this._imu.addEventListener('active', (e) => {
            me._active();
        });
    }

    _update(last, mode)
    {
        this.last  = last;
        this._mode = mode;
        this.dispatchEvent(new CustomEvent('change', {
            detail: last
        }));
    }

    _active()
    {
        let state = gps.active || this._imu.active;
        if (state != this.active) {
            this.active = state;
            this.dispatchEvent(new Event('active'));
        }
    }

    /**
     * Return the provider mode "FUSION(GPS/IMU/NONE)".
     * 
     * @returns String
     */
    get mode()
    {
        return `FUSION(${this._mode})`;
    }

    destructor()
    {
        //this._imu.destructor();
    }
}

const gps = new GpsProvider();
const fus = new FusionProvider();
export {gps as GpsProvider, fus as FusionProvider};
