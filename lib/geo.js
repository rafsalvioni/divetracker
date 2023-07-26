import { Angle, Line, Point2D } from './trigo.js';
import { MagVar } from './magvar.js';
import './proto.js';

/**
 * Utility class to convert GPS degrees to meters.
 * 
 */
class GeoDistConversor
{
    /**
     * @var Map
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
     * @param {float} lat 
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
     * @param {float} mtr Meters
     * @param {float} lat Latitude
     * @returns float
     */
    toDeg(mtr, lat=0)
    {
        return mtr / this.#f(lat);
    }

    /**
     * Converts degrees to meters.
     * 
     * @param {float} deg Degrees
     * @param {float} lat Latitude
     * @returns float
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
    #alt;

    /**
     * 
     * @param {float} lat 
     * @param {float} lon 
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
        let lat = (this.lat + p.lat) / 2;
        return distConv.toMtr(d, lat);
    }

    /**
     * Returns the average speed, in m/s, between this point and given point.
     * 
     * @param {GeoPoint} point 
     * @returns float
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
     * @var Segment
     */
    #seg;
    /**
     * Initial point
     * 
     * @var {GeoPoint}
     */
    #first;
    /**
     * Starts timestamp, in millis
     * 
     * @var int
     */
    #start;
    /**
     * Total distance did, in meters
     * 
     * @var number
     */
    #dist = 0;
    /**
     * Current position provider
     * 
     * @var {PositionProvider}
     */
    _provider;
    /**
     * Update interval ID
     * 
     * @var int
     */
    #updatePosId;
    
    /**
     * 
     * @param {GeoPoint} start 
     */
    constructor(start)
    {
        super();
        this.#seg   = new Segment(start, start);
        this.#first = start;
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
        this.#seg   = new Segment(this.pos, point);
        this.#dist += this.#seg.dist;
        this.dispatchEvent(new TrackEvent('change', this.pos));
    }
 
    /**
     * Returns the current position.
     * 
     * @returns {GeoPoint}
     */
    get pos()
    {
        return this.#seg.stop;
    }
 
    /**
     * Returns the track ID.
     * 
     * @returns int
     */
    get id()
    {
        return this.#start;
    }

    /**
     * Returns total Track's distance did.
     * 
     * @returns number
     */
    get dist()
    {
        return this.#dist;
    }

    /**
     * Defines the Track's position provider.
     * 
     * @param {PositionProvider} provider 
     * @param {int} freq 
     */
    updateFrom(provider, freq = 1000)
    {
        if (this.#updatePosId) {
            clearInterval(this.#updatePosId);
            _update.bind(this)(); // Forces to get last postion before end track
        }

        function _update()
        {
            if (this._provider.active) {
                this.pos = this._provider.last.pos;
            }
        }
        
        this._provider = provider;
        if (provider) {
            this.#updatePosId = setInterval(_update.bind(this), freq);
        }
    }

    /**
     * Position Provider attached.
     * 
     */
    get provider()
    {
        return this._provider;
    }

    /**
     * Return the initial point of Track.
     * 
     * @return {GeoPoint}
     */
    get first()
    {
        return this.#first;
    }

    /**
     * Returns previous position
     * 
     * @returns {GeoPoint}
     */
    get prev()
    {
        return this.#seg.start;
    }
 
    /**
     * Returns the duration of track, in seconds.
     * 
     * @returns float
     */
    get duration()
    {
        return (Date.now() - this.#start) / 1000;
    }
 
    /**
     * Returns the average speed of whole Track, in m/s.
     * 
     * @returns float
     */
    get avgSpeed()
    {
        return this.dist / this.duration;
    }
 
    /**
     * Returns the speed of last segment done, in m/s.
     * 
     * @returns number
     */
    get curSpeed()
    {
        return this.#seg.speed;
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
        return this.pos.routeTo(point);
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