import { MagVar } from './magvar.js';
import './proto.js';

const Coords = {

    /**
     * Rotate coordinates with angle and axe given.
     * 
     * Rotation is not "to" and is it anti clockwise.
     * 
     * Returns the coords object modified.
     * 
     * @param {number} theta Angle in Degree
     * @param {object} coords Coords {x, y, z}
     * @param {string} axe Rotation Axe (x, y, z)
     * @returns object
     */
    rotate: (theta, coords, axe) =>
    {
        let d = Angle.use(theta).trigo();
        let c = Object.clone(coords);
        switch (axe) {
            case 'x':
                coords.y = c.y * d.cos - c.z * d.sin;
                coords.z = c.z * d.cos + c.y * d.sin;
                break;
            case 'y':
                coords.x = c.x * d.cos + c.z * d.sin;
                coords.z = c.z * d.cos - c.x * d.sin;
                break;
            case 'z':
                coords.x = c.x * d.cos - c.y * d.sin;
                coords.y = c.y * d.cos + c.x * d.sin;
                break;
        }
    },

    /**
     * Rotate coordinates with orientation given.
     * 
     * Returns the coords object modified.
     * 
     * @see Coords.rotate
     * @param {object} ori Orientation {alpha, beta, gamma}, in degree
     * @param {object} coords Coords {x, y, z}
     * @returns object
     */
    rotateByEuler: (ori, coords) =>
    {
        if (ori.alpha) {
            Coords.rotate(ori.alpha, coords, 'z');
        }
        if (ori.gamma) {
            Coords.rotate(ori.gamma, coords, 'y');
        }
        if (ori.beta) {
            Coords.rotate(ori.beta, coords, 'x');
        }
    },

    /**
     * Returns the X,Y coordinates using angle and distance given.
     * 
     * @param {number} a Trigonometry (0 left) Angle in degrees
     * @param {number} d Distance
     * @returns object
     */
    position: (a, d) =>
    {
        let trigo = Angle.use(a).trigo();
        return {
            x: trigo.cos * d,
            y: trigo.sin * d
        }
    }
}

/**
 * Util class to operations with angles.
 */
class Angle
{
    /**
     * Static constructor
     * 
     * @param {number|Angle} val 
     * @param {boolean} rad
     * @returns Angle
     */
    static use(val, rad=false)
    {
        if (val instanceof Angle) {
            return val;
        }
        return new Angle(val, rad);
    }

    /**
     * 
     * @param {number} val 
     * @param {boolean} rad
     */
    constructor(val, rad=false)
    {
        if (rad) {
            this.deg = Math.toDegree(val);
            this.rad = val % (2 * Math.PI);
        }
        else {
            this.deg = val % 360;
            this._updateRad();
        }
    }

    /**
     * Inverts the angle value.
     * 
     * Util to convert angles clockwise.
     * 
     * @returns Angle
     */
    invert()
    {
        this.deg = this.deg * -1;
        this._updateRad();
        return this;
    }

    /**
     * Converts the degree value to its positive form (0-359).
     * 
     * @returns Angle
     */
    pos()
    {
        this.deg = (this.deg + 360) % 360;
        return this;
    }

    /**
     * Converts the degree value to half form (0 to +-180).
     * 
     * @returns Angle
     */
    wrap180()
    {
        let quad = parseInt(this.deg / 180) % 2;
        this.deg = this.deg % 180;
        if (quad != 0) {
            this.deg *= -1;
            this._updateRad();
        }
        return this;
    }

    /**
     * Converts the degree value to quarter form (0 to +-90).
     * 
     * @returns Angle
     */
     wrap90()
     {
        let quad = Math.abs(parseInt(this.deg / 90) % 4);
        this.deg = this.deg % 90;
        if (quad == 1 || quad == 3) {
            this.deg *= -1;
        }
        if (quad > 0) {
            this._updateRad();
        }
        return this;
     }

     /**
     * Converts the angle from Trigonometry (0 left, anticlockwise) to Compass (0 top, clockwise) and vice-versa.
     * 
     * @returns Angle
     */
    switch()
    {
        this.deg = -this.deg + 90;
        this._updateRad();
        return this;
    }

    /**
     * Returns a object with trigometry values.
     * 
     * {sin, cos, tan}
     * 
     * @returns object
     */
    trigo()
    {
        return {
            cos: Math.cos(this.rad),
            sin: Math.sin(this.rad),
            tan: Math.tan(this.rad),
        };
    }

    _updateRad()
    {
        this.rad = Math.toRadians(this.deg);
    }
}

/**
 * Utility class to convert GPS degrees to meters.
 * 
 */
class GeoDistConversor
{
    constructor()
    {
        this.repo = new Map();
    }

    /**
     * Returns convert factor using latitude given.
     * 
     * @param {float} lat 
     * @returns int
     */
    _f(lat)
    {
        const D2M = 111317; // Meters in 1 lat degree at Equador line
        let key = lat.toFixed(1);
        if (!this.repo.has(key)) {
            let val = parseInt(D2M * Math.cos(Math.toRadians(lat))); // Uses latitude to make a specific perimeter
            this.repo.set(key, val);
            return val;
        }
        return this.repo.get(key);
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
        return mtr / this._f(lat);
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
        return deg * this._f(lat);
    }
}
const distConv = new GeoDistConversor();

/**
* Represents a Geo point
* 
*/
class Point
{
    /**
     * 
     * @param {float} lat 
     * @param {float} lon 
     */
    constructor(lat, lon, alt=0)
    {
        this.lat = Math.rounds(lat, 7);
        this.lon = Math.rounds(lon, 7);
        this.alt = Math.rounds(alt ?? 0, 2);
        this.timestamp = Date.now();
    }
 
    /**
     * Returns the 2D distance between this point and given point, in meters.
     * 
     * Note: It uses Pythagoras' theorem for performance but can be wrong for longer distances. However, longer
     * distances isn't goal from this project.
     * 
     * @param {Point} point 
     * @returns float
     */
    distanceTo(point)
    {
        let dx = point.lon - this.lon;
        let dy = point.lat - this.lat;
        let dh = Math.hypot(dx, dy);
        return distConv.toMtr(dh, this.lat);
    }
 
    /**
     * Returns the direction to go from this point to given point, referenced by true north clockwise.
     * 
     * @param {Point} point 
     * @returns float
     */
    bearingTo(point)
    {
        let ca  = point.lon - this.lon;
        let co  = point.lat - this.lat;
        let dir = Math.atan2(co, ca);
        return Angle.use(dir, true).switch().pos().deg;
    }

    /**
     * Returns the direction to go from this point to given point, referenced by magnetic north.
     * 
     * @param {Point} point 
     * @returns float
     */
    getDirectionMag(point)
    {
        let dir = this.bearingTo(point) - this.getDeclination();
        return Angle.use(dir).pos().deg;
    }

    /**
     * Returns the angle of difference between magnetic north and true north.
     * 
     * @returns number
     */
    getDeclination()
    {
        if (!this._decli) {
            this._decli = MagVar.get(this.lat, this.lon);
        }
        return this._decli;
    }
 
    /**
     * Returns the average speed, in m/s, between this point and given point.
     * 
     * @param {Point} point 
     * @returns float
     */
    speedTo(point)
    {
        let dt   = Math.abs(point.timestamp - this.timestamp) / 1000;
        let dist = this.distanceTo(point);
        return dt > 0 ? dist / dt : dist;
    }

    /**
     * Returns a segment to go from this point to given point.
     * 
     * @param {Point} point 
     * @returns Segment
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
     * @returns Point
     */
    fromMeters(x, y, z=0)
    {
        let lat = this.lat + distConv.toDeg(y, this.lat);
        let lon = this.lon + distConv.toDeg(x, this.lat);
        let alt = this.alt + z;
        return new Point(lat, lon, alt);
    }

    /**
     * Return the current point rotationed.
     * 
     * In Geo, Lon = X, Lat = Y, Alt = Z
     * 
     * @see Coords.rotateByEuler
     * @param {object} ori 
     * @returns Point
     */
    rotate(ori)
    {
        let coords = {x: this.lon, y: this.lat, z: this.alt};
        Coords.rotateByEuler(ori, coords);
        return new Point(coords.y, coords.x, coords.z);
    }
}
 
/**
* Represents a segment bewtween two points
* 
*/
class Segment
{
    /**
     * 
     * @param {Point} start 
     * @param {Point} stop 
     */
    constructor(start, stop)
    {
        this.start = start;
        this.stop  = stop;
        this.dist  = stop.distanceTo(start);
        /**
         * Direction, geo north reference
         */
        this.dir   = start.bearingTo(stop);
        this.speed = start.speedTo(stop);
    }

    /**
     * Returns a segment with start / stop inverted.
     * 
     * It is a return Segment.
     * 
     * @returns Segment.
     */
    inverse()
    {
        return new Segment(this.stop, this.start);
    }
}
 
class TrackEvent extends Event
{
    constructor(type, point)
    {
        super(type);
        this.point = point;
    }
}
 
class Track extends EventTarget
{
    /**
     * 
     * @param {Point} start 
     */
    constructor(start)
    {
        super();
        this._seg   = new Segment(start, start);
        this._first = start;
        this._start = Date.now();
        this.dist   = 0;
        this._provider;
        this._updatePosId;
    }
 
    /**
     * Defines the current position.
     * 
     * @param {Point} point 
     */
    set pos(point)
    {
        this._seg = new Segment(this.pos, point);
        this.dist += this._seg.dist;
        this.dispatchEvent(new TrackEvent('change', this.pos));
    }
 
    /**
     * Returns the current position.
     * 
     * @returns Point
     */
    get pos()
    {
        return this._seg.stop;
    }
 
    /**
     * Returns the track ID.
     * 
     * @returns int
     */
    get id()
    {
        return this._start;
    }

    /**
     * Defines the Track's position provider.
     * 
     * @param {PositionProvider} provider 
     * @param {int} freq 
     */
    updateFrom(provider, freq = 1000)
    {
        if (this._updatePosId) {
            clearInterval(this._updatePosId);
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
            this._updatePosId = setInterval(_update.bind(this), freq);
        }
    }

    /**
     * Position Provider attached.
     */
    get provider()
    {
        return this._provider;
    }

    /**
     * Return the initial point of Track.
     * 
     * @return {Point}
     */
    get first()
    {
        return this._first;
    }
 
    /**
     * Returns the duration of track, in seconds.
     * 
     * @returns float
     */
    getDuration()
    {
        return (Date.now() - this._start) / 1000;
    }
 
    /**
     * Returns the average speed of whole Track, in m/s.
     * 
     * @returns float
     */
    getAvgSpeed()
    {
        return this.dist / this.getDuration();
    }
 
    /**
     * Returns the speed of last segment done, in m/s.
     * 
     * @returns number
     */
    getCurrentSpeed()
    {
        return this._seg.speed;
    }
 
    /**
     * Returns a segment to go from current position to given point.
     * 
     * Using a segment, we have direction and distance.
     * 
     * @param {Point} point 
     * @returns Segment
     */
    toPoint(point)
    {
        return this.pos.routeTo(point);
    }
 
    /**
     * Returns a segment between current and start position.
     * 
     * @returns Segment
     */
    toStart()
    {
        return this.toPoint(this._first);
    }
}
 
export {Coords, Angle, Point, Segment, TrackEvent, Track};