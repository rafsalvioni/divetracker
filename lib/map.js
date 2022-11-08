import './proto.js';
import { Angle, Coords, Point } from './geo.js';

export class DiveMap
{
    /**
     * 
     * @param {DOMElement} svg SVG Element
     */
    constructor(svg)
    {
        this.svg    = svg;
        this._north = 0;

        let size    = Math.min(screen.availHeight, screen.availWidth) * 0.95;
        this.size   = size;
        this.radius = size/2 * 0.9;
        this.svg.setAttribute('width', size);
        this.svg.setAttribute('height', size);
        this.svg.setAttribute('style', 'background-color: #000055');

        // Circulo branco
        let el = this._createEl('circle', {
            cx: size/2,
            cy: size/2,
            r: this.radius,
            'stroke-width': size*0.01,
            style: 'stroke:#fff',
            fill: 'transparent',
        });
        this.svg.appendChild(el);
        // Linha vertical
        el = this._createEl('line', {
            x1: size/2,
            y1: size*0.2,
            x2: size/2,
            y2: size*0.8,
            'stroke-width': size*0.01,
            style: 'stroke:rgb(255,0,0)'
        });
        this.svg.appendChild(el);
        // Seta
        el = this._createEl('polygon', {
            points: "{0},{1} {2},{3} {4},{5}".format(
                size / 2, size*0.05,
                size / 2 * 0.95, size * 0.1,
                size / 2 * 1.05, size * 0.1
            ),
            style: 'stroke:rgb(255,0,0)',
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Linha horizontal
        el = this._createEl('line', {
            x1: size*0.2,
            y1: size/2,
            x2: size*0.8,
            y2: size/2,
            'stroke-width': size*0.01,
            style: 'stroke:rgb(255,0,0)',
        });
        this.svg.appendChild(el);
        // Circulo central
        el = this._createEl('circle', {
            cx: size/2,
            cy: size/2,
            r: size*0.02,
            fill: '#ff0000',
        });
        this.svg.appendChild(el);
        // Precisao
        this.accur = this._createEl('circle', {
            cx: size/2,
            cy: size/2,
            r: 0,
            fill: 'transparent',
            stroke: '#00ffff'
        });
        this.svg.appendChild(this.accur);
        // Norte
        this.nor = this._createEl('text', {
            x: size/2,
            y: size * 0.1 + 5,
            id: 'direction',
            fill: '#ffff00',
            style: 'font-size:110%',
            'text-anchor': "middle",
            'alignment-baseline': "hanging",
        });
        this.svg.appendChild(this.nor);
        // Escala
        el = this._createEl('text', {
            x: size-10,
            y: 10,
            fill: '#fff',
            style: 'font-size:' + size*0.05,
            'text-anchor': "end",
            'alignment-baseline': "hanging",
        }, "R: {0}m".format(parseInt(this.radius)));
        this.svg.appendChild(el);

        this.points = this._createEl('g');
        this.svg.appendChild(this.points);
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
        let lbl   = String(this.points.childNodes.length);
        let el    = this._createEl('text', {
            stroke: color,
            fill: color,
            style: 'font-size:90%',
            'text-anchor': "middle",
            'alignment-baseline': "middle",
            'data-lat': p.lat,
            'data-lon': p.lon
        }, lbl);
        this.points.appendChild(el);
        if (first) {
            this.setPosition(p);
        }
        else {
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
        this.pos = null;
        this.accur.setAttribute('r', 0);
    }

    /**
     * Sets Map's bearing.
     * 
     * @param {number} n Angle
     */
    setBearing(n)
    {
        if (this._north != n) {
            this._north = n;
            this.nor.innerHTML = "{0}º GN".format(n);
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
        this.pos = pos;
        this.accur.setAttribute('r', Math.round(accur));
        this._update();
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
        let mid = this.size / 2;
        for (let i = 0; i < this.points.childNodes.length; i++) {
            let poi  = this.points.childNodes[i];
            let dest = new Point(Number(poi.getAttribute('data-lat')), Number(poi.getAttribute('data-lon')));
            let seg  = this.pos.routeTo(dest);
            let dist = Math.min(seg.dist, this.radius);
			poi.setAttribute('opacity', dist == this.radius ? '0.7' : '1');
            let dir = Angle.use(seg.dir - this._north).switch().deg;
            let c   = Coords.position(dir, dist);
            c.x += mid;
            c.y  = mid - c.y;
            poi.setAttribute('x', Math.round(c.x));
            poi.setAttribute('y', Math.round(c.y));
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
