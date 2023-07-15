
/**
 * Implements a chain of signal filters
 *
 */
export class ChainFilter 
{
    /**
     * Attached filters
     *
     */
    #filters = [];

    /**
     *
     * @param {Filter} filter
     * @returns this
     */
    add(filter) 
    {
        this.#filters.push(filter);
        return this;
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        for (let f of this.#filters) {
            s = f.filter(s);
        }
        return s;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        for (let f of this.#filters) {
            f.reset();
        }
        return this;
    }
}

/**
 * Implements a filter that applies a offset
 *
 */
export class OffsetFilter 
{
    /**
     * Offset
     *
     * @var number
     */
    #offset;

    /**
     *
     * @param {number} offset
     */
    constructor(offset) 
    {
        this.#offset = offset;
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        return s - this.#offset;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        return this;
    }
}

/**
 * Implements a simple moving average filter
 *
 */
export class SMAFilter 
{
    /**
     * Buffer
     */
    #buffer = [];
    /**
     * Buffer size
     */
    #size;

    /**
     *
     * @param {int} size Buffer size
     */
    constructor(size = 10) 
    {
        this.#size = Math.abs(parseInt(size)) ?? 1;
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        this.#buffer.push(s);
        if (this.#buffer.length > this.#size) {
            this.#buffer.shift();
        }

        let sum = 0;
        for (let v of this.#buffer) {
            sum += v;
        }

        sum /= this.#buffer.length;
        return sum;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        this.#buffer = [];
        return this;
    }
}

/**
 * Implements a weight moving average filter
 *
 */
export class WMAFilter 
{
    /**
     * Buffer
     */
    #buffer = [];
    /**
     * Buffer size
     */
    #size;

    /**
     *
     * @param {int} size Buffer size
     */
    constructor(size = 10) 
    {
        this.#size = Math.abs(parseInt(size)) ?? 1;
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        this.#buffer.push(s);
        if (this.#buffer.length > this.#size) {
            this.#buffer.shift();
        }

        let sum = 0;
        let wsum = 0;
        for (let i = 0; i < this.#buffer.length; i++) {
            let w = (i + 1) / this.#buffer.length;
            sum  += this.#buffer[i] * w;
            wsum += w;
        }

        sum /= wsum;
        return sum;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        this.#buffer = [];
        return this;
    }
}

/**
 * Implements a exponecial moving average filter
 *
 */
export class EMAFilter 
{
    /**
     * Window size
     */
    #size;
    /**
     * Last value
     */
    #last;

    /**
     *
     * @param {int} size
     */
    constructor(size = 10) 
    {
        this.#size = Math.abs(parseInt(size)) ?? 1;
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        if (this.#last != null) {
            let m = 2 / (this.#size + 1);
            this.#last = (s - this.#last) * m + this.#last;
        }
        else {
            this.#last = s;
        }
        return this.#last;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        this.#last = null;
        return this;
    }
}

/**
 * Implements a distnct window
 *
 */
export class DistinctWindow 
{
    /**
     * Window bound
     */
    #bound;

    /**
     *
     * @param {number} bound
     */
    constructor(bound) 
    {
        this.#bound = Math.abs(bound);
    }

    /**
     *
     * @param {number} s
     * @returns number
     */
    filter(s) 
    {
        if (Math.abs(s) < this.#bound) {
            return 0;
        }
        return s;
    }
    
    /**
     *
     * @returns self
     */
    reset() 
    {
        return this;
    }
}
