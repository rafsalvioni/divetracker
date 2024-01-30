import { Line, Point2D } from './trigo.js';
import './proto.js';

/**
 * Utility class to convert GPS degrees to meters.
 * 
 */
class GeoDistConversor
{
    /**
     * @type Map
     */
    #repo;

    /**
     * 
     */
    constructor()
    {
        this.#repo = new Map();
    }

    /**
     * Returns convert factor using latitude given.
     * 
     * @param {number} lat 
     * @returns int
     */
    #f(lat)
    {
        const D2M = 111317; // Meters in 1 lat degree at Equador line
        let key = lat.toFixed(1);
        if (!this.#repo.has(key)) {
            let val = parseInt(D2M * Math.cos(Math.toRadians(lat))); // Uses latitude to make a specific perimeter
            this.#repo.set(key, val);
            return val;
        }
        return this.#repo.get(key);
    }

    /**
     * Converts meters to degrees.
     * 
     * @param {number} mtr Meters
     * @param {number} lat Latitude
     * @returns number
     */
    toDeg(mtr, lat=0)
    {
        return mtr / this.#f(lat);
    }

    /**
     * Converts degrees to meters.
     * 
     * @param {number} deg Degrees
     * @param {number} lat Latitude
     * @returns number
     */
    toMtr(deg, lat=0)
    {
        return deg * this.#f(lat);
    }
}
const distConv = new GeoDistConversor();

/**
 * Represents a Geo point
 * 
 */
class GeoPoint extends Point2D
{
    /**
     * @type number
     */
    #alt;

    /**
     * 
     * @param {number} lat 
     * @param {number} lon 
     */
    constructor(lat, lon, alt=0)
    {
        lat = Math.rounds(lat, 7);
        lon = Math.rounds(lon, 7);
        alt = Math.rounds(alt ?? 0, 2);
        super(lon, lat);
        this.#alt = alt;
        this.timestamp = Date.now();
    }

    /**
     * Latitude, in degrees
     */
    get lat()
    {
        return this.y;
    }
 
    /**
     * Longitude, in degrees
     */
    get lon()
    {
        return this.x;
    }

    /**
     * Altitude, in meters
     */
    get alt()
    {
        return this.#alt;
    }

    /**
     * 
     * @param {GeoPoint} p 
     * @returns number
     */
    distanceTo(p)
    {
        let d   = super.distanceTo(p); // Distance in degrees
        let lat = Math.avg(this.lat, p.lat);
        return distConv.toMtr(d, lat);
    }

    /**
     * Returns the average speed, in m/s, between this point and given point.
     * 
     * @param {GeoPoint} point 
     * @returns number
     */
    speedTo(point)
    {
        let dt   = (point.timestamp - this.timestamp) / 1000;
        let dist = this.distanceTo(point);
        return dt != 0 ? dist / dt : 0;
    }

    /**
     * Returns a segment to go from this point to given point.
     * 
     * @param {GeoPoint} point 
     * @returns {Segment}
     */
    routeTo(point)
    {
        return new Segment(this, point);
    }

    /**
     * Create new point, adding X, Y and Z in Lon, Lat and Alt. Arguments in meters.
     * 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {GeoPoint}
     */
    fromMeters(x, y, z=0)
    {
        let lat = this.lat + distConv.toDeg(y, this.lat);
        let lon = this.lon + distConv.toDeg(x, this.lat);
        let alt = this.alt + z;
        return new GeoPoint(lat, lon, alt);
    }
}
 
/**
 * Represents a segment bewtween two geo points
 * 
 */
class Segment extends Line
{
    /**
     * @type number
     */
    #speed;

    /**
     * 
     * @param {GeoPoint} start 
     * @param {GeoPoint} stop 
     */
    constructor(start, stop)
    {
        super(start, stop);
        this.#speed = start.speedTo(stop);
    }

    /**
     * Speed, in m/s
     * 
     * @type number
     */
    get speed()
    {
        return this.#speed;
    }
}

/**
 * Represents a Track event
 * 
 */
class TrackEvent extends Event
{
    /**
     * 
     * @param {string} type 
     * @param {GeoPoint} point 
     */
    constructor(type, point)
    {
        super(type);
        this.point = point;
    }
}

/**
 * Represents a postion tracker
 * 
 */
class Track extends EventTarget
{
    /**
     * Current segment
     * 
     * @type Segment
     */
    #seg;
    /**
     * Initial point
     * 
     * @type {GeoPoint}
     */
    #first;
    /**
     * Starts timestamp, in millis
     * 
     * @type int
     */
    #start;
    /**
     * Total distance did, in meters
     * 
     * @type number
     */
    #dist = 0;
    /**
     * Current position provider
     * 
     * @type {PositionProvider}
     */
    _provider;
    /**
     * Update interval ID
     * 
     * @type int
     */
    #updatePosId;
    
    /**
     * 
     */
    constructor()
    {
        super();
        this.#start = Date.now();
        this.#updatePosId;
    }
 
    /**
     * Defines the current position.
     * 
     * @param {GeoPoint} point 
     */
    set pos(point)
    {
        if (!this.#seg) {
            this.#first = point;
            this.#seg   = new Segment(point, point);
        }
        else {
            this.#seg   = new Segment(this.pos, point);
            this.#dist += this.#seg.dist;
        }
        this.dispatchEvent(new TrackEvent('change', this.pos));
    }
 
    /**
     * Returns the current position, or null.
     * 
     * @type {GeoPoint}
     */
    get pos()
    {
        if (this.#seg) {
            return this.#seg.stop;
        }
        return null;
    }
 
    /**
     * Returns the track ID.
     * 
     * @type int
     */
    get id()
    {
        return parseInt(this.#start / 1000);
    }

    /**
     * Returns total Track's distance did.
     * 
     * @type number
     */
    get dist()
    {
        return this.#dist;
    }

    /**
     * Is track active?
     * 
     * @type boolean
     */
    get active()
    {
        return this._provider && this._provider.active;
    }

    /**
     * Defines the Track's position provider.
     * 
     * @param {PositionProvider} provider 
     * @param {int} freq 
     */
    updateFrom(provider, freq = 1000)
    {
        function _update()
        {
            if (this._provider.active) {
                this.pos = this._provider.last.pos;
            }
        }
        _update = _update.bind(this);
        
        if (this.#updatePosId) {
            clearInterval(this.#updatePosId);
            this.#updatePosId = null;
            _update(); // Forces to get last position before end track
        }

        this._provider = provider;
        if (provider) {
            this.#updatePosId = setInterval(_update, freq);
            _update(); // Gets position on start
        }
    }

    /**
     * Position Provider attached.
     * 
     * @type {PositionProvider}
     */
    get provider()
    {
        return this._provider;
    }

    /**
     * Return the initial point of Track, or null.
     * 
     * @type {GeoPoint}
     */
    get first()
    {
        return this.#first;
    }

    /**
     * Returns previous position, or null.
     * 
     * @type {GeoPoint}
     */
    get prev()
    {
        if (this.#seg) {
            return this.#seg.start;
        }
        return null;
    }
 
    /**
     * Returns the duration of track, in seconds.
     * 
     * @type number
     */
    get duration()
    {
        return (Date.now() - this.#start) / 1000;
    }
 
    /**
     * Returns the average speed of whole Track, in m/s.
     * 
     * @type number
     */
    get avgSpeed()
    {
        return this.dist / this.duration;
    }
 
    /**
     * Returns the speed of last segment done, in m/s.
     * 
     * @type number
     */
    get curSpeed()
    {
        if (this.#seg) {
            return this.#seg.speed;
        }
        return 0;
    }
 
    /**
     * Returns a segment to go from current position to given point.
     * 
     * Using a segment, we have direction and distance.
     * 
     * @param {GeoPoint} point 
     * @returns {Segment}
     */
    toPoint(point)
    {
        if (this.#seg) {
            return this.pos.routeTo(point);
        }
        return null;
    }
 
    /**
     * Returns a segment between current and start position.
     * 
     * @returns {Segment}
     */
    toStart()
    {
        return this.toPoint(this.#first);
    }
}
 
export {GeoPoint, Segment, TrackEvent, Track};