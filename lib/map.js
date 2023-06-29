import './proto.js';
import { Angle, Coords, Point } from './geo.js';

export class DiveMap extends EventTarget
{
    /**
     * 
     * @param {DOMElement} svg SVG Element
     */
    constructor(svg)
    {
        super();
        this.svg    = svg;

        var me      = this;
        let size    = Math.round(Math.min(window.innerHeight, window.innerWidth) * 0.95);
        this.size   = size;
        this.mid    = Math.round(size/2);
        this.radius = this.mid;
        this.matrix = [1, 0, 0, 1, 0, 0];
        this.svg.setAttribute('width', size);
        this.svg.setAttribute('height', size);
        this.svg.setAttribute('style', 'background-color: #000055');

        let el;
        // Circulo branco
        el = this.#createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: Math.round(this.mid * .9),
            'stroke-width': Math.round(size*0.01),
            style: 'stroke:#aaa',
            fill: 'transparent',
        });
        el.addEventListener('dblclick', () => {
            if (me.pos) {
                me.addPoint(me.pos);
            }
        });
        this.svg.appendChild(el);
        // Linha vertical
        el = this.#createEl('line', {
            x1: this.mid,
            y1: Math.round(size*0.2),
            x2: this.mid,
            y2: Math.round(size*0.8),
            'stroke-width': Math.round(size*0.01),
            style: 'stroke:rgb(255,0,0)'
        });
        this.svg.appendChild(el);
        // Linha horizontal
        el = this.#createEl('line', {
            x1: Math.round(size*0.2),
            y1: this.mid,
            x2: Math.round(size*0.8),
            y2: this.mid,
            'stroke-width': Math.round(size*0.01),
            style: 'stroke:rgb(255,0,0)',
        });
        this.svg.appendChild(el);
        // Circulo central
        el = this.#createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: Math.round(size*0.02),
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Seta linha de fé
        el = this.#createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                this.mid, Math.round(this.mid * .1),
                Math.round(this.mid * 0.95), Math.round(size*0.1),
                Math.round(this.mid * 1.05), Math.round(size*0.1)
            ),
            style: 'stroke:rgb(255,0,0)',
            'stroke-width': 5,
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Escala
        el = this.#createEl('text', {
            x: size-10,
            y: 10,
            fill: '#fff',
            style: `font-size:${Math.round(size*.05)}`,
            'text-anchor': "end",
            'alignment-baseline': "hanging",
        });
        el.addEventListener('click', () => {
            me.switchScale();
        });
        this.svg.appendChild(el);
        // Indicador alvo ativo
        this.elTarget = this.#createEl('text', {
            x: 10,
            y: 10,
            fill: '#fff',
            style: `font-size:${Math.round(size*.05)}`,
            'alignment-baseline': "hanging",
        });
        this.elTarget.addEventListener('click', () => {
            me.switchTarget();
        });
        this.svg.appendChild(this.elTarget);
        // Indicador rota
        this.elRoute = this.#createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                this.mid, Math.round(this.mid * .1),
                Math.round(this.mid * 0.95), Math.round(size*0.1),
                Math.round(this.mid * 1.05), Math.round(size*0.1)
            ),
            fill: 'transparent',
            'transform-origin': `${this.mid} ${this.mid}`
        });
        this.svg.appendChild(this.elRoute);
        // Precisao
        this.elAccur = this.#createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: 0,
            fill: 'transparent',
            stroke: '#00ffff',
            'transform-origin': `${this.mid} ${this.mid}`
        });
        this.svg.appendChild(this.elAccur);
        // Angulo bussola
        this.elBearing = this.#createEl('text', {
            x: this.mid,
            y: Math.round(size * 0.1) + 10,
            fill: '#ffff00',
            style: `font-size:${Math.round(size*.05)}`,
            'text-anchor': "middle",
            'alignment-baseline': "hanging",
        });
        this.svg.appendChild(this.elBearing);
        // Indicador norte. Tem que ficar por ultimo para sobrepor
        this.elNorth = this.#createEl('text', {
            x: this.mid,
            y: Math.round(size * 0.1),
            fill: '#ffff00',
            style: `font-size:${Math.round(size*.05)}`,
            'text-anchor': "middle",
            'alignment-baseline': "top",
            'transform-origin': `${this.mid} ${this.mid}`
        }, 'N');
        this.svg.appendChild(this.elNorth);
        // Grupo de pontos
        this.points = this.#createEl('g');
        this.svg.appendChild(this.points);

        this.setScale(1);
        this.setBearing(0);
        this.clean();
    }

    /**
     * Adds a point to Map.
     * 
     * If was first point added, it will setted as Map's center position.
     * 
     * @param {Point} p 
     * @returns SVGElement
     */
    addPoint(p)
    {
        let first = !this.points.hasChildNodes();
        let color = first ? '#00ff00' : '#fff';
        let i     = this.points.childNodes.length;
        let el    = this.#createEl('text', {
            stroke: color,
            fill: color,
            style: `font-size:${Math.round(this.size*.04)}`,
            'text-anchor': "middle",
            'alignment-baseline': "middle",
            'data-lat': p.lat,
            'data-lon': p.lon
        }, String(i));
        var me = this;
        // Changes target to own point
        el.addEventListener('click', () => {
            me.setTarget(i);
        });
        this.points.appendChild(el);
        if (first) {
            this.setPosition(p);
            this.setTarget(0);
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
        return el;
    }

    /**
     * Clean the Map, removing all added points and resetting center.
     * 
     */
    clean()
    {
        while (this.points.hasChildNodes()) {
            this.points.removeChild(this.points.lastChild);
        }
        this.first = null;
        this.setPosition(null);
    }

    /**
     * Sets Map's bearing.
     * 
     * @param {number} n Angle
     */
    async setBearing(n)
    {
        if (this.bearing != n) {
            this.bearing = n;
            // Update label
            this.elBearing.innerHTML = "{0}º TN".format(n);
            // Update North indicator
            this.elNorth.setAttribute('transform', 'rotate({0})'.format(-n));
            // Update position matrix
            let rot = (360 - this.bearing) % 360;
            let t   = Angle.use(rot).trigo();
            this.matrix[0] = t.cos;
            this.matrix[1] = t.sin;
            this.matrix[2] = -t.sin;
            this.matrix[3] = t.cos;
            this.#updateMatrix();
            // Invert rotate from point to correct labels
            for (let i = 0; i < this.points.childNodes.length; i++) {
                let poi = this.points.childNodes[i];
                poi.setAttribute('transform', 'rotate({0})'.format(-rot));
            }
            this.#updateTarget();
        }
    }

    /**
     * Sets the Map's center coordinates.
     * 
     * @param {Point} pos Position
     * @param {number} accur Precision, in meters
     */
    setPosition(pos, accur=0)
    {
        if (!pos) {
            this.elAccur.setAttribute('r', 0);
            this.matrix[4] = 0;
            this.matrix[5] = 0;
            this.points.setAttribute('transform-origin', `${this.mid} ${this.mid}`);
            this.pos = this.first;
            this.#updateMatrix();
        }
        else {
            if (!this.first) {
                this.first = pos;
            }
            else if (this.pos.distanceTo(pos) < 1) {
                return;
            }
            this.pos = pos;
            this.elAccur.setAttribute('r', accur * this.scale);
            let c = this.#gpsToSvg(pos);
            this.matrix[4] = -c.x;
            this.matrix[5] = c.y;
            this.points.setAttribute('transform-origin', `${c.ax} ${c.ay}`);
            this.#updateMatrix();
        }
        this.#updateTarget(true);
    }

    /**
     * Sets the route target
     * 
     * @param {int} i POI's index
     * @returns bool
     */
    setTarget(i)
    {
        if (this.points.childNodes[i]) {
            let poi = this.points.childNodes[i];
            this.target = new Point(Number(poi.getAttribute('data-lat')), Number(poi.getAttribute('data-lon')));
            this.target.idx = i;
            this.#updateTarget(true);
            return true;
        }
        else {
            this.target = null;
            this.#updateTarget(true);
            return false;
        }
    }

    /**
     * Switchs the current target to the previous POI
     * 
     * @returns bool
     */
    switchTarget()
    {
        let i = 0;
        if (this.target) {
            i = (this.target.idx - 1);
            if (i < 0) {
                i += this.points.childNodes.length;
            }
        }
        return this.setTarget(i);
    }

    /**
     * Defines Map's scale.
     * 
     * @param {float} s Scale
     */
    setScale(s)
    {
        this.scale  = s;
        this.radius = this.mid / this.scale;
        this.#updateMatrix();
        this.#updateTarget();
        let desc;
        if (s == 1) {
            desc = '{0} m'.format(this.mid);
        }
        else {
            desc = '{0} m ({1}%)'.format(Math.round(this.radius), s * 100);
        }
        this.svg.childNodes[5].innerHTML = desc;
        this.elAccur.setAttribute('transform', `scale(${this.scale})`);
    }

    /**
     * Changes Map's scale on each call.
     * 
     */
    switchScale()
    {
        let f = .25;
        let s = (this.scale + f) % 2;
        if (s == 0) {
            s += f;
        }
        this.setScale(s);
    }

    /**
     * Converts a GPS position to SVG coordinates, using first added point by reference.
     * 
     * @param {Point} pos 
     * @returns object
     */
    #gpsToSvg(pos)
    {
        let seg = this.first.routeTo(pos);
        let dir = Angle.use(seg.dir).switch().deg;
        let c   = Coords.position(dir, seg.dist);
        c.ax    = c.x + this.mid;
        c.ay    = this.mid - c.y;
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
        let t = 'matrix({0}) scale({1})'.format(this.matrix.join(','), this.scale);
        this.points.setAttribute('transform', t);
    }

    /**
     * Updates target indicators
     * 
     * @param {bool} force 
     */
    #updateTarget(force=false)
    {
        if (this.target && this.pos) {
            let seg;
            if (force || !this.target._seg) {
                seg = this.pos.routeTo(this.target);
                this.target._seg = seg;
                this.elRoute.setAttribute('fill', this.target.idx == 0 ? '#00ff00' : '#fff');
                this.elTarget.innerHTML = '#{0}: {1} m'.format(this.target.idx, Math.round(seg.dist));
            }
            else {
                seg = this.target._seg
            }
            let rot = seg.dir - this.bearing;
            this.elRoute.setAttribute('transform', 'rotate({0})'.format(Math.round(rot)));
            this.elRoute.setAttribute('style', `opacity:${seg.dist > this.radius ? '1' : '0.7'}`);
        }
        else {
            this.elRoute.setAttribute('fill', 'transparent');
            this.elTarget.innerHTML = '';
        }
    }

    /**
     * Util method to create SVG elements
     * 
     * @param {String} tag Tagname
     * @param {object} attribs Attributes
     * @param {String} txt Label
     * @returns SVGElement
     */
    #createEl(tag, attribs={}, txt='')
    {
        let el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (let attr in attribs) {
            el.setAttribute(attr, attribs[attr]);
        }
        el.innerHTML = txt;
        return el;
    }
}
