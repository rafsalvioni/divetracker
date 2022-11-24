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
        let size    = Math.min(window.innerHeight, window.innerWidth) * 0.9;
        this.size   = size;
        this.mid    = size/2;
        this.radius = this.mid * 0.9;
        this.svg.setAttribute('width', size);
        this.svg.setAttribute('height', size);
        this.svg.setAttribute('style', 'background-color: #000055');

        svg.addEventListener('dblclick', () => {
            if (me.pos) {
                me.addPoint(me.pos);
                me.dispatchEvent(new CustomEvent('poi', {
                    detail: me.pos
                }));
            }
        });

        let el;
        // Circulo branco
        el = this._createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: this.radius,
            'stroke-width': size*0.01,
            style: 'stroke:#fff',
            fill: 'transparent',
        });
        this.svg.appendChild(el);
        // Linha vertical
        el = this._createEl('line', {
            x1: this.mid,
            y1: size*0.2,
            x2: this.mid,
            y2: size*0.8,
            'stroke-width': size*0.01,
            style: 'stroke:rgb(255,0,0)'
        });
        this.svg.appendChild(el);
        // Linha horizontal
        el = this._createEl('line', {
            x1: size*0.2,
            y1: this.mid,
            x2: size*0.8,
            y2: this.mid,
            'stroke-width': size*0.01,
            style: 'stroke:rgb(255,0,0)',
        });
        this.svg.appendChild(el);
        // Circulo central
        el = this._createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: size*0.02,
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Seta linha de fé
        el = this._createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                size / 2, this.mid - this.radius,
                size / 2 * 0.95, size * 0.1,
                size / 2 * 1.05, size * 0.1
            ),
            style: 'stroke:rgb(255,0,0)',
            'stroke-width': 5,
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Escala
        el = this._createEl('text', {
            x: size-10,
            y: 10,
            fill: '#fff',
            style: `font-size:${size*.05}`,
            'text-anchor': "end",
            'alignment-baseline': "hanging",
        }, "{0} m".format(parseInt(this.mid)));
        this.svg.appendChild(el);
        // Indicador alvo ativo
        this.elTarget = this._createEl('text', {
            x: 10,
            y: 10,
            fill: '#fff',
            style: `font-size:${size*.05}`,
            'alignment-baseline': "hanging",
        });
        this.elTarget.addEventListener('click', () => {
            me.switchTarget();
        });
        this.svg.appendChild(this.elTarget);
        // Indicador rota
        this.elRoute = this._createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                size / 2, this.mid - this.radius,
                size / 2 * 0.95, size * 0.1,
                size / 2 * 1.05, size * 0.1
            ),
            fill: 'transparent'
        });
        this.svg.appendChild(this.elRoute);
        // Precisao
        this.elAccur = this._createEl('circle', {
            cx: this.mid,
            cy: this.mid,
            r: 0,
            fill: 'transparent',
            stroke: '#00ffff'
        });
        this.svg.appendChild(this.elAccur);
        // Angulo bussola
        this.elBearing = this._createEl('text', {
            x: this.mid,
            y: size * 0.1 + 10,
            fill: '#ffff00',
            style: `font-size:${size*.05}`,
            'text-anchor': "middle",
            'alignment-baseline': "hanging",
        });
        this.svg.appendChild(this.elBearing);
        // Indicador norte. Tem que ficar por ultimo para sobrepor
        this.elNorth = this._createEl('text', {
            x: this.mid,
            y: size * 0.1,
            fill: 'cyan',
            style: `font-size:${size*.05}`,
            'text-anchor': "middle",
            'alignment-baseline': "top",
        }, 'N');
        this.svg.appendChild(this.elNorth);
        // Grupo de pontos
        this.points = this._createEl('g');
        this.svg.appendChild(this.points);

        this.setBearing(0);
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
        let el    = this._createEl('text', {
            stroke: color,
            fill: color,
            style: `font-size:${this.size*.04}`,
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
            el.setAttribute('x', this.mid);
            el.setAttribute('y', this.mid);
            this.setTarget(0);
            this.setPosition(p);
        }
        else {
            let c = this._posToCoord(p);
            el.setAttribute('x', c.ax);
            el.setAttribute('y', c.ay);
            this._update();
        }
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
        this.pos    = null;
        this.first  = null;
        this.setTarget(-1);
        this.elAccur.setAttribute('r', 0);
    }

    /**
     * Sets Map's bearing.
     * 
     * @param {number} n Angle
     */
    setBearing(n)
    {
        if (this.bearing != n) {
            this.bearing = n;
            this.elBearing.innerHTML = "{0}º TN".format(n);
            this.elNorth.setAttribute('transform', 'rotate({0} {1} {2})'.format(-n, this.mid, this.mid));
            this._update();
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
        if (!this.pos) {
            this.first = pos;
        }
        this.pos = pos;
        this._cachePos = null;
        this.elAccur.setAttribute('r', Math.round(accur));
        this._update();
    }

    setTarget(i)
    {
        if (this.target && this.target.idx == i) {
            return true;
        }
        if (this.points.childNodes[i]) {
            let p    = this.points.childNodes[i];
            let poi  = new Point(Number(p.getAttribute('data-lat')), Number(p.getAttribute('data-lon')));
            poi.name = String(i);
            poi.idx  = i;
            this.target = poi;
            this._update();
            return true;
        }
        else {
            this.target = null;
            this.elRoute.setAttribute('fill', 'transparent');
            this.elTarget.innerHTML = '';
            return false;
        }
    }

    switchTarget()
    {
        let i = 0;
        if (this.target) {
            i = (this.target.idx + 1) % this.points.childNodes.length;
        }
        return this.setTarget(i);
    }

    /**
     * Update Map using added points, current bearing and current position.
     * 
     * @returns 
     */
    async _update()
    {
        if (!this.pos) {
            return;
        }
        let c;
        if (this._cachePos) {
            c = this._cachePos;
        }
        else {
            c = this._posToCoord(this.pos);
            this._cachePos = c;
        }
        let rot = (360 - this.bearing) % 360;
        // Rotate and move points canvas using current bearing and position
		let trans = "translate({0} {1}) rotate({2} {3} {4})".format(-c.x, c.y, rot, c.ax, c.ay);
		this.points.setAttribute('transform', trans);
        // Invert rotate from point to correct labels
        for (let i = 0; i < this.points.childNodes.length; i++) {
            let poi = this.points.childNodes[i];
			let cx = poi.getAttribute('x');
			let cy = poi.getAttribute('y');
			poi.setAttribute('transform', 'rotate({0} {1} {2})'.format(-rot, cx, cy));
        }
        // Rotate target indicator
        if (this.target) {
            let seg = this.pos.routeTo(this.target);
            this.elTarget.innerHTML = '#{0}: {1} m'.format(this.target.idx, Math.round(seg.dist));
            if (seg.dist > this.mid) {
                this.elRoute.setAttribute('fill', this.target.idx == 0 ? '#00ff00' : '#fff');
                this.elRoute.setAttribute('transform', 'rotate({0} {1} {2})'.format(seg.dir + rot, this.mid, this.mid));
            }
            else {
                this.elRoute.setAttribute('fill', 'transparent');
            }
        }
    }

    /**
     * Converts a GPS position to Map coordinates, using first added point by reference.
     * 
     * @param {Point} pos 
     * @returns object
     */
    _posToCoord(pos)
    {
        let seg = this.first.routeTo(pos);
        let dir = Angle.use(seg.dir).switch().deg;
        let c   = Coords.position(dir, seg.dist);
        c.ax    = c.x + this.mid;
        c.ay    = this.mid - c.y;
        c.dist  = seg.dist;
        c.dir   = seg.dir;
        return c;
    }

    /**
     * Util method to create SVG elements
     * 
     * @param {String} tag Tagname
     * @param {object} attribs Attributes
     * @param {String} txt Label
     * @returns SVGElement
     */
    _createEl(tag, attribs={}, txt='')
    {
        let el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (let attr in attribs) {
            el.setAttribute(attr, attribs[attr]);
        }
        el.innerHTML = txt;
        return el;
    }
}
