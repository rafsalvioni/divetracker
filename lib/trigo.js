/**
 * Util functions to manipulate coordinates
 *
 */
export const Coords = {

    /**
     * Rotate coordinates with angle and axe given.
     *
     * Rotation is not "to" and is clockwise.
     *
     * @param {number} theta Angle in Degree, clockwise
     * @param {object} coords Coords {x, y, z}
     * @param {string} axe Rotation Axe (x, y, z)
     */
    rotate: (theta, coords, axe) => {
        let d = Angle.use(-theta).trigo(); // theta is clockwise, but, functions expected the inverse
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
     * @see Coords.rotate
     * @param {object} ori Euler angles {alpha, beta, gamma}, in degree
     * @param {object} coords Coords {x, y, z}
     * @param {string} order Rotation order, by axe. Lowercase
     */
    rotateByEuler: (ori, coords, order = 'zyx') => {
        for (let axe of order) {
            if (axe == 'z' && ori.alpha) {
                Coords.rotate(-ori.alpha, coords, axe); // Coords.rotate expected a clockwise angle...
            }
            if (axe == 'y' && ori.gamma) {
                Coords.rotate(-ori.gamma, coords, axe);
            }
            if (axe == 'x' && ori.beta) {
                Coords.rotate(-ori.beta, coords, axe);
            }
        }
    },

    /**
     * Returns the X,Y coordinates using angle and distance given.
     *
     * @param {number} a Bearing (0 top, clockwise) Angle in degrees
     * @param {number} d Distance
     * @param {number} x Start x
     * @param {number} y Start y
     * @returns object
     */
    position: (a, d, x = 0, y = 0) => {
        let trigo = Angle.use(a).switch().trigo();
        return {
            x: x + trigo.cos * d,
            y: y + trigo.sin * d
        };
    },

    /**
     * Returns the bearing (north top, clockwise) angle (in degrees) from P1 to P2.
     * 
     * @param {number} x1 P1 x
     * @param {number} y1 P1 y
     * @param {number} x2 P2 x
     * @param {number} y2 P2 y
     * @returns number
     */
    bearing: (x1, y1, x2, y2) => {
        let dx = x2 - x1;
        let dy = y2 - y1;
        let b  = Math.atan2(dx, dy);
        return Angle.use(b, true).pos().deg;
    },

    /**
     * Returns the distance between P1 and P2.
     * 
     * @param {number} x1 P1 x
     * @param {number} y1 P1 y
     * @param {number} x2 P2 x
     * @param {number} y2 P2 y
     * @returns number
     */
    distance: (x1, y1, x2, y2) => {
        let dx = x2 - x1;
        let dy = y2 - y1;
        return Math.hypot(dx, dy);
    },
};

/**
 * Util class to operations with angles.
 * 
 */
export class Angle
{
    #deg; #rad;
    
    /**
     * Static constructor
     *
     * @param {number|Angle} val
     * @param {boolean} rad
     * @returns Angle
     */
    static use(val, rad = false)
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
    constructor(val, rad = false)
    {
        if (rad) {
            this.#deg = Math.toDegree(val);
            this.#rad = val % (2 * Math.PI);
        }
        else {
            this.#deg = val % 360;
            this.#rad = Math.toRadians(this.#deg);
        }
    }

    /**
     * Angle in degrees
     */
    get deg()
    {
        return this.#deg;
    }

    /**
     * Angle in radians
     */
    get rad()
    {
        return this.#rad;
    }

    /**
     * Sums a angle
     * 
     * @param {Angle} a 
     * @returns Angle
     */
    sum(a)
    {
        let deg = this.#deg + a.deg;
        return new Angle(deg);
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
        let deg = this.#deg * -1;
        return new Angle(deg);
    }

    /**
     * Converts the degree value to its positive form (0-359).
     *
     * @returns Angle
     */
    pos()
    {
        let deg = (this.#deg + 360) % 360;
        return new Angle(deg);

    }

    /**
     * Converts the degree value to half form (0 to -180).
     *
     * @returns Angle
     */
    wrap180()
    {
        let deg = this.pos().deg;
        if (deg >= 180) {
            deg -= 360;
            return new Angle(deg);
        }
        return this;
    }

    /**
     * Converts the degree value to quarter form (0 to -90).
     *
     * @returns Angle
     */
    wrap90()
    {
        let deg = this.pos().deg;
        let q   = parseInt(deg / 90); // quadrant
        switch (q) {
            case 1:
            case 2:
                deg -= 180;
                break;
            case 3:
                deg -= 360;
                break;
        }
        if (q > 0) {
            return new Angle(deg);
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
        let deg = -this.#deg + 90;
        return new Angle(deg);
    }
    
    /**
     * Returns a object with trigometry values.
     *
     * {d (degree), r (rad), sin, cos, tan}
     *
     * @returns object
     */
    trigo()
    {
        return {
            deg: this.deg,
            rad: this.rad,
            cos: Math.cos(this.rad),
            sin: Math.sin(this.rad),
            tan: Math.tan(this.rad),
        };
    }
}

/**
 * Represents a 2D point
 * 
 */
export class Point2D
{
    _x = 0; _y = 0;
    
    /**
     * Create a point from a structure
     * 
     * @param {object} p 
     * @returns {Point2D}
     */
    static create(p)
    {
        return new Point2D(p.x ?? 0, p.y ?? 0);
    }
    
    /**
     * 
     * @param {number} x 
     * @param {number} y 
     */
    constructor(x=0, y=0)
    {
        this._x = parseFloat(x);
        this._y = parseFloat(y);
    }
    
    /**
     * Returns X
     */
    get x()
    {
        return this._x;
    }
    
    /**
     * Returns Y
     */
    get y()
    {
        return this._y;
    }
    
    /**
     * Returns {x,y}
     */
    get coords()
    {
        return {x: this.x, y: this.y};
    }
    
    /**
     * Returns distance between this point and point given.
     * 
     * Angle returned is north clockwise.
     * 
     * @param {Point2D} p 
     * @returns number
     */
    distanceTo(p)
    {
        return Coords.distance(this.x, this.y, p.x, p.y);
    }
    
    /**
     * Returns the angle between this point and point given
     * 
     * @param {*} p 
     * @returns 
     */
    bearingTo(p)
    {
        return new Angle(Coords.bearing(this.x, this.y, p.x, p.y));
    }
    
    /**
     * Returned a copy from this point translated using angle and distance given
     * 
     * @param {number} a Angle, in degrees. top clockwise
     * @param {number} d Distance
     * @returns {Point2D}
     */
    translatedTo(a, d)
    {
        let c = Coords.position(a, d, this.x, this.y);
        return new Point2D(c.x, c.y);
    }
    
    /**
     * Returns a line between this point and point given
     * 
     * @param {Point2D} p 
     * @returns {Line}
     */
    lineTo(p)
    {
        return new Line(this, p);
    }
}

/**
 * Represents a Line
 * 
 */
export class Line
{
    #start; #stop; #dir; #dist;
    
    /**
     * 
     * @param {Point2D} start 
     * @param {Point2D} stop 
     */
    constructor(start, stop)
    {
        this.#start = start;
        this.#stop  = stop;
    }
    
    /**
     * Start point
     */
    get start()
    {
        return this.#start;
    }
    
    /**
     * Stop point
     */
    get stop()
    {
        return this.#stop;
    }
    
    /**
     * Line inclination angle
     * 
     * @var {Angle}
     */
    get dir()
    {
        if (this.#dir == null) {
            this.#dir = this.#start.bearingTo(this.#stop);
        }
        return this.#dir;
    }
    
    /**
     * Line size (distance bewtween points)
     */
    get dist()
    {
        if (this.#dist == null) {
            this.#dist = this.#start.distanceTo(this.#stop);
        }
        return this.#dist;
    }
    
    /**
     * Returns this Line inverted
     * 
     * @returns {Line}
     */
    inverted()
    {
        return this.stop.lineTo(this.start);
    }
}

/**
 * Represents a 2D/3D Vector
 * 
 */
export class Vector
{
    #x; #y; #z; #size;
    
    /**
     * Create from a object
     * 
     * @param {object} v 
     * @returns {Vector}
     */
    static create(v)
    {
        return new Vector(v.x ?? 0, v.y ?? 0, v.z ?? 0);
    }
    
    /**
     * 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    constructor(x, y, z=0)
    {
        this.#x = parseFloat(x);
        this.#y = parseFloat(y);
        this.#z = parseFloat(z);
    }
    
    /**
     * X component
     */
    get x()
    {
        return this.#x;
    }
    
    /**
     * Y component
     */
    get y()
    {
        return this.#y;
    }
    
    /**
     * Z component
     */
    get z()
    {
        return this.#z;
    }
    
    /**
     * Vector's size
     */
    get size()
    {
        if (this.#size == null) {
            this.#size = Math.hypot(this.x, this.y, this.z);
        }
        return this.#size;
    }
    
    /**
     * Vector's components
     */
    get coords()
    {
        return {x: this.x, y: this.y, z: this.z};
    }

    /**
     * Sums this vector to another and returns the result
     * 
     * @param {Vector} v 
     * @returns {Vector}
     */
    sum(v)
    {
        return new Vector(this.x + v.x, this.y + v.y, this.z + v.z);
    }
    
    /**
     * Returns this vector resized
     * 
     * @param {number} size 
     * @returns {Vector}
     */
    resized(size)
    {
        if (this.size == 0) {
            throw 'Vector is empty';
        }
        let scale = size / this.size;
        return this.scaled(scale);
    }
    
    /**
     * Returns this vector to the same position and direction from vector given
     * 
     * @param {Vector} v 
     * @returns {Vector}
     */
    translatedTo(v)
    {
        return v.resized(this.size);
    }

    /**
     * Returns this vector normalized
     * 
     * @returns {Vector}
     */
    unitized()
    {
        return this.resized(1);
    }

    /**
     * Returns this vector scaled
     * 
     * @param {number} scale 
     * @returns {Vector}
     */
    scaled(scale)
    {
        return new Vector(this.x * scale, this.y * scale, this.z * scale);
    }
}
