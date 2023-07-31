import './proto.js';
import { GeoPoint } from './geo.js';
import { Coords, Angle } from './trigo.js';

/**
 * Represents a DiveMap
 * 
 */
export class DiveMap extends EventTarget
{
    #size; #mid; #radius;
    #bearing; #scale; #accur;
    #ref; #pos; #target;
    #matrix = [1, 0, 0, 1, 0, 0];
    #text   = {};
    #shapes = {};
    
    /**
     * 
     * @param {DOMElement} svg SVG Element
     */
    constructor(svg)
    {
        super();

        var me       = this;
        let size     = Math.round(Math.min(window.innerHeight, window.innerWidth) * 0.95);
        this.#size   = size;
        this.#radius = size;
        this.#mid    = Math.round(size/2);
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('style', 'background-color: #000055');

        let el;
        // White circle
        el = this.#createEl('circle', {
            cx: this.#mid,
            cy: this.#mid,
            r: Math.round(this.#mid * .9),
            'stroke-width': Math.round(size * .01),
            style: 'stroke:#aaa',
            fill: 'transparent',
        });
        el.addEventListener('dblclick', () => {
            me.savePos();
        });
        svg.appendChild(el);
        
        // Vertical line
        el = this.#createEl('line', {
            x1: this.#mid,
            y1: Math.round(size * .2),
            x2: this.#mid,
            y2: Math.round(size * .8),
            'stroke-width': Math.round(size * .01),
            style: 'stroke:rgb(255,0,0)'
        });
        svg.appendChild(el);
        
        // Horizontal line
        el = this.#createEl('line', {
            x1: Math.round(size * .2),
            y1: this.#mid,
            x2: Math.round(size * .8),
            y2: this.#mid,
            'stroke-width': Math.round(size * .01),
            style: 'stroke:rgb(255,0,0)',
        });
        svg.appendChild(el);
        
        // Central circle (current position)
        el = this.#createEl('circle', {
            cx: this.#mid,
            cy: this.#mid,
            r: Math.round(size * .02),
            fill: '#ff0000',
        });
        svg.appendChild(el);
        
        // Direction arrow
        el = this.#createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                this.#mid, Math.round(this.#mid * .1),
                Math.round(this.#mid * .95), Math.round(size * .1),
                Math.round(this.#mid * 1.05), Math.round(size * .1)
            ),
            style: 'stroke:rgb(255,0,0)',
            'stroke-width': 5,
            fill: '#ff0000',
        });
        svg.appendChild(el);
        
        // Scale text
        el = this.#createEl('text', {
            x: size - 10,
            y: 10,
            fill: '#fff',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "end",
            'dominant-baseline': "hanging",
        }, 'Scale');
        el.addEventListener('click', () => {
            me.switchScale();
        });
        this.#text.scale = el;
        svg.appendChild(el);
        
        // Current target distance text
        el = this.#createEl('text', {
            x: 10,
            y: 10,
            fill: '#fff',
            style: `font-size:${Math.round(size * .05)}`,
            'dominant-baseline': "hanging",
        }, 'Target');
        el.addEventListener('click', () => {
            me.switchTarget();
        });
        this.#text.target = el;
        svg.appendChild(el);
        
        // Precision circle indicator
        el = this.#createEl('circle', {
            cx: this.#mid,
            cy: this.#mid,
            r: 50,
            fill: 'transparent',
            stroke: '#00ffff',
            'transform-origin': `${this.#mid} ${this.#mid}`
        });
        this.#shapes.accur = el;
        svg.appendChild(el);
        
        // Bearing angle text
        el = this.#createEl('text', {
            x: this.#mid,
            y: Math.round(size * .1) + 10,
            fill: '#ffff00',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "middle",
            'dominant-baseline': "hanging",
        });
        this.#text.bearing = el;
        svg.appendChild(el);
        
        //------------------ Bezel ----------------------
        el = this.#createEl('g', {
            'transform-origin': `${this.#mid} ${this.#mid}`
        });
        this.#shapes.bezel = el;
        svg.appendChild(el);
        // Current target direction indicator
        el = this.#createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                this.#mid, Math.round(this.#mid * .1),
                Math.round(this.#mid *  .95), Math.round(size * .1),
                Math.round(this.#mid * 1.05), Math.round(size * .1)
            ),
            fill: 'transparent',
            'transform-origin': `${this.#mid} ${this.#mid}`
        });
        this.#shapes.target = el;
        this.#shapes.bezel.appendChild(el);
        // North indicator
        el = this.#createEl('text', {
            x: this.#mid,
            y: Math.round(size * .06),
            fill: '#ffff00',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "middle",
            'dominant-baseline': "hanging",
        }, 'N');
        this.#shapes.bezel.appendChild(el);
        // East indicator
        el = this.#createEl('text', {
            x: Math.round(size * .94),
            y: this.#mid,
            fill: '#ffff00',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "middle",
            'dominant-baseline': "hanging",
        }, 'E', 90);
        this.#shapes.bezel.appendChild(el);
        // South indicator
        el = this.#createEl('text', {
            x: this.#mid,
            y: Math.round(size * .94),
            fill: '#ffff00',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "middle",
            'dominant-baseline': "hanging",
        }, 'S', 180);
        this.#shapes.bezel.appendChild(el);
        // West indicator
        el = this.#createEl('text', {
            x: Math.round(size * .06),
            y: this.#mid,
            fill: '#ffff00',
            style: `font-size:${Math.round(size * .05)}`,
            'text-anchor': "middle",
            'dominant-baseline': "hanging",
        }, 'W', -90);
        this.#shapes.bezel.appendChild(el);
        
        // ------------------ Canvas -------------------------
        this.#shapes.canvas = this.#createEl('g',{
            'style': 'background-color: #000055'
        });
        svg.appendChild(this.#shapes.canvas);
        // Path
        this.#shapes.path = this.#createEl('polyline', {
            'transform-origin': `${this.#mid} ${this.#mid}`,
            'points': '',
            style: `fill:none;stroke:#0055ff;stroke-width:${Math.round(size * .005)}`,
        });
        this.#shapes.canvas.appendChild(this.#shapes.path);
        // Added points' group
        this.#shapes.points = this.#createEl('g');
        this.#shapes.canvas.appendChild(this.#shapes.points);

        this.scale = 1;
        this.bearing = 0;
        this.clean();
    }
    
    /**
     * Defines Map's position
     * 
     * If was first position added, it will setted as Map's reference
     * 
     * @var {GeoPoint}
     */
    set pos(p)
    {
        if (!p) {
            this.#matrix[4] = 0;
            this.#matrix[5] = 0;
            this.#shapes.canvas.setAttribute('transform-origin', `${this.#mid} ${this.#mid}`);
            this.#pos  = null;
            this.#ref  = null;
            this.accur = 0;
            this.#updateMatrix();
        }
        else {
            let first = !this.#ref;
            if (first) {
                this.#ref = p;
            }
            else if (this.#pos.distanceTo(p) < 1) {
                return;
            }
            this.#pos = p;
            let c = this.#gpsToSvg(p);
            this.#matrix[4] = -c.x;
            this.#matrix[5] = c.y;
            this.#shapes.canvas.setAttribute('transform-origin', `${c.ax} ${c.ay}`);
            //this.#shapes.path.getAttributeNode('points').value += `${c.ax},${c.ay} `;
            this.#updateMatrix();
            if (first) {
                this.savePos();
            }
        }
        this.#updateTarget();
    }
    
    /**
     * Defines Map's bearing and rotate it
     * 
     * @var int
     */
    set bearing(n)
    {
        if (Math.abs(n - this.#bearing) < 1) {
            return;
        }
        this.#bearing = parseInt(Math.round(n));
        // Update label
        this.#text.bearing.innerHTML = "{0}º T".format(this.#bearing);
        // Update position matrix
        let t = Angle.use(-this.#bearing).trigo();
        this.#matrix[0] = t.cos;
        this.#matrix[1] = t.sin;
        this.#matrix[2] = -t.sin;
        this.#matrix[3] = t.cos;
        this.#updateMatrix();
        // Invert rotate from point to correct labels
        for (let i = 0; i < this.#shapes.points.childNodes.length; i++) {
            let poi = this.#shapes.points.childNodes[i];
            poi.setAttribute('transform', 'rotate({0})'.format(-t.deg));
        }
    }
    
    /**
     * Defines position accurary indicator
     * 
     * @var number
     */
    set accur(n)
    {
        if (Math.abs(n - this.#accur) < 1) {
            return;
        }
        this.#accur = parseFloat(n);
        this.#shapes.accur.setAttribute('r', this.#accur);
    }
    
    /**
     * Defines map's scale
     * 
     * @var number
     */
    set scale(n)
    {
        this.#scale  = parseFloat(n);
        this.#radius = this.#mid / this.#scale;
        let desc;
        if (this.#scale == 1) {
            desc = '{0} m'.format(this.#radius);
        }
        else {
            desc = '{0} m ({1}%)'.format(Math.round(this.#radius), this.#scale * 100);
        }
        this.#text.scale.innerHTML = desc;
        
        this.#updateMatrix();
        this.#updateTarget();
        this.#shapes.accur.setAttribute('transform', `scale(${this.#scale})`);
    }
    
    /**
     * Defines a target by its index
     * 
     * @var int
     */
    set target(i)
    {
        if (this.#shapes.points.childNodes[i]) {
            let poi = this.#shapes.points.childNodes[i];
            this.#target = new GeoPoint(Number(poi.getAttribute('data-lat')), Number(poi.getAttribute('data-lon')));
            this.#target.idx = i;
            this.#updateTarget();
        }
        else {
            this.#target = null;
            this.#updateTarget();
        }
    }
    
    /**
     * Async for set bearing
     * 
     * @param {number} n 
     */
    async setBearing(n)
    {
        this.bearing = n;
    }
    
    /**
     * Updates map usign Position provider last data
     * 
     * @param {GeoPoint} pos 
     * @param {number} accur Accuracy
     */
    fromProvider(pos, accur)
    {
        this.pos   = pos;
        this.accur = accur;
    }
    
    /**
     * Clean the Map, removing all added points and resetting center.
     * 
     */
    clean()
    {
        while (this.#shapes.points.hasChildNodes()) {
            this.#shapes.points.removeChild(this.#shapes.points.lastChild);
        }
        this.#shapes.path.setAttribute('points', '');
        this.#target = null;
        this.pos = null;
    }
    
    /**
     * Switchs the current target to the previous POI
     * 
     */
    switchTarget()
    {
        let i = 0;
        if (this.#target) {
            i = this.#target.idx - 1;
            if (i < 0) {
                i += this.#shapes.points.childNodes.length;
            }
        }
        this.target = i;
    }
    
    /**
     * Changes Map's scale on each call.
     * 
     */
    switchScale()
    {
        let f = .25;
        let s = (this.#scale + f) % 2;
        if (s == 0) {
            s += f;
        }
        this.scale = s;
    }
    
    /**
     * Saves current position on Map, putting a new indicator
     * 
     */
    savePos()
    {
        if (this.#pos && !this.#pos._mapped) {
            this.#addPoint(this.#pos);
            this.#pos._mapped = true;
        }
    }
    
    /**
     * Adds a point to Map.
     * 
     * If was first point added, it will setted as Map's center position.
     * 
     * @param {GeoPoint} p 
     * @returns {SVGElement}
     */
    #addPoint(p)
    {
        let i     = this.#shapes.points.childNodes.length;
        let first = i == 0;
        let color = first ? '#00ff00' : '#fff';
        let el    = this.#createEl('text', {
            stroke: color,
            fill: color,
            style: `font-size:${Math.round(this.#size * .04)}`,
            'text-anchor': "middle",
            'dominant-baseline': "central",
            'data-lat': p.lat,
            'data-lon': p.lon
        }, String(i));
        var me = this;
        // Changes target to own point
        el.addEventListener('click', () => {
            me.target = i;
        });
        this.#shapes.points.appendChild(el);
        if (first) {
            this.target = 0;
        }
        else {
            this.dispatchEvent(new CustomEvent('poi', {
                detail: p
            }));
        }
        let c = this.#gpsToSvg(p);
        el.setAttribute('x', c.ax);
        el.setAttribute('y', c.ay);
        el.setAttribute('transform-origin', `${c.ax} ${c.ay}`);

        //this.#shapes.path.getAttributeNode('points').value += `${c.ax},${c.ay} `;
        return el;
    }
    
    /**
     * Converts a GPS position to SVG coordinates, using first added point by reference.
     * 
     * @param {GeoPoint} pos 
     * @returns object
     */
    #gpsToSvg(pos)
    {
        let seg = this.#ref.routeTo(pos);
        let c   = Coords.position(seg.dir, seg.dist);
        c.ax    = c.x + this.#mid;
        c.ay    = this.#mid - c.y;
        c.dist  = seg.dist;
        c.dir   = seg.dir;
        for (let p in c) {
            c[p] = Math.round(c[p]);
        }
        return c;
    }

    /**
     * Updated Map transform matrix.
     * 
     */
    #updateMatrix()
    {
        let t = 'matrix({0}) scale({1})'.format(this.#matrix.join(','), this.#scale);
        this.#shapes.canvas.setAttribute('transform', t);

        t = 'matrix({0},0,0)'.format(this.#matrix.slice(0, 4).join(','));
        this.#shapes.bezel.setAttribute('transform', t);
    }
    
    /**
     * Updates target indicators
     * 
     */
    #updateTarget()
    {
        let elRoute = this.#shapes.target;
        if (this.#target && this.#pos) {
            let seg   = this.#pos.routeTo(this.#target);
            let idx   = this.#target.idx;
            let color = this.#shapes.points.childNodes[idx].getAttribute('fill');
            elRoute.setAttribute('fill', color);
            this.#text.target.innerHTML = '#{0}: {1} m'.format(idx, Math.round(seg.dist));
            elRoute.setAttribute('transform', 'rotate({0})'.format(Math.round(seg.dir)));
            elRoute.setAttribute('style', `opacity:${seg.dist > this.#radius ? '1' : '0.7'}`);
        }
        else {
            elRoute.setAttribute('fill', 'transparent');
            this.#text.target.innerHTML = '';
        }
    }
    
    /**
     * Util method to create SVG elements
     * 
     * @param {String} tag Tagname
     * @param {object} attribs Attributes
     * @param {String} txt Label
     * @param {number} rot Rotation
     * @returns {SVGElement}
     */
    #createEl(tag, attribs={}, txt='', rot = 0)
    {
        let el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (let attr in attribs) {
            el.setAttribute(attr, attribs[attr]);
        }
        el.innerHTML = txt;
        if (rot) {
            let x = attribs.x ?? 0;
            let y = attribs.y ?? 0;
            el.setAttribute('transform', `rotate(${rot}, ${x}, ${y})`);
        }
        return el;
    }
}
