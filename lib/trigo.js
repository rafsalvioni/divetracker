/**
 * Util functions to manipulate coordinates
 *
 */
export const Coords = {

    /**
     * Rotate coordinates with angle and axe given.
     *
     * Rotation is not "to" and is it anti clockwise.
     *
     * @param {number} theta Angle in Degree
     * @param {object} coords Coords {x, y, z}
     * @param {string} axe Rotation Axe (x, y, z)
     */
    rotate: (theta, coords, axe) => {
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
     * @see Coords.rotate
     * @param {object} ori Orientation {alpha, beta, gamma}, in degree
     * @param {object} coords Coords {x, y, z}
     */
    rotateByEuler: (ori, coords) => {
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

    /**
     * Move a vector to same direction from "to" vector.
     * 
     * @param {object} f Source vector 
     * @param {object} t To vector
     */
    moveTo: (f, t) => {
        let fLen = Math.hypot(f.x, f.y, f.z);
        let tLen = Math.hypot(t.x, t.y, t.z);

        Object.assign(f, {
            x: (t.x / tLen) * fLen,
            y: (t.y / tLen) * fLen,
            z: (t.z / tLen) * fLen
        });
    }
};

/**
 * Util class to operations with angles.
 * 
 */
export class Angle
{
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
            this.deg = Math.toDegree(val);
            this.rad = val % (2 * Math.PI);
        }
        else {
            this.deg = val % 360;
            this.#updateRad();
        }
    }

    /**
     * Sums a angle
     * 
     * @param {Angle} a 
     * @returns Angle
     */
    sum(a)
    {
        this.deg += a.deg;
        this.#updateRad();
        return this;
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
        this.#updateRad();
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
     * Converts the degree value to half form (0 to -180).
     *
     * @returns Angle
     */
    wrap180()
    {
        let deg = this.pos().deg;
        if (deg >= 180) {
            deg -= 360;
            this.deg = deg;
            this.#updateRad();
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
            this.#updateRad();
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
        this.#updateRad();
        return this;
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

    #updateRad()
    {
        this.rad = Math.toRadians(this.deg);
    }
}
