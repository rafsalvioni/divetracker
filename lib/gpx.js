import { Point } from './geo.js';
import './proto.js';

/**
 * Utility class to generate GPX files.
 * 
 */
export class GpxWriter
{
    #curGroup;
    #lastPoint;
    #points;
    #xml;
    #stoppedUntil;

    constructor()
    {
    }

    /**
     * Creates a new GPX
     */
    create()
    {
        this.#curGroup     = null;
        this.#lastPoint    = null;
        this.#stoppedUntil = null;
        this.#points       = [];
        this.#xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n\
<gpx\
 xmlns=\"http://www.topografix.com/GPX/1/1\"\
 creator=\"Salvioni\'s GPX Creator\" \
 version=\"1.1\"\
 xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \
 xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\">\n";
    }

    /**
     * Sets a point as way point.
     * 
     * @param {Point} point 
     */
    addWayPoint(point)
    {
        this.#points.push(point);
    }
    
    /**
     * Adds a position to GPX.
     * 
     * @param {Point} point 
     * @param {String} group Point's group
     */
    addPos(point, group = null, newseg = false)
    {
        if (!group) {
            group = point.timestamp;
        }
        if (group != this.#curGroup) { // When group was change (track)
            if (this.#curGroup) {
                this.#endTrack();
            }
            this.#startTrack(group, point);
        }
        else if (newseg) {
            this.#xml += "\t\t</trkseg>\n\t\t<trkseg>\n";    
        }
        else if (this.#lastPoint && this.#lastPoint.distanceTo(point) < 1) { // Is stopped? Don't add...
            this.#stoppedUntil = point.timestamp;
            return;
        }
        this.#stoppedPoint(); // When move again, add last point with new time
        
        this.#lastPoint = point;
        this.#addTrkPoint(point);
    }
    
    /**
     * Ends current GPX e flushs their contents.
     * 
     * @return {String}
     */
    end()
    {
        if (this.#lastPoint) {
            this.#endTrack();
        }
        var i = 1;
        var me = this;
        this.#points.map(p => {
            let clone = Object.clone(p);
            if (!clone.name) {
                clone.name = "POI #{0}".format(i++);
            }
            me.#xml += "\t" + me.#makePoint(clone, true);
        })
        let xml = this.#xml + '</gpx>';
        this.create();
        return xml;
    }

    /**
     * Current GPX has contents?
     * 
     * @returns boolean
     */
    hasContents()
    {
        return this.#curGroup != null;
    }

    #addTrkPoint(point)
    {
        this.#xml += "\t\t\t" + this.#makePoint(point);
    }

    #makePoint(point, wpt = false)
    {
        let name = '';
        let tag  = '';
        if (!wpt) { // Track point
            tag = 'trk';
        }
        else if (point.name) { // Way point if has a name
            tag  = 'w';
            name = `<name>${point.name.entitiesEncode()}</name>`;
        }
        else { // None.. Return empty
            return '';
        }
        let dt  = new Date(point.timestamp);
        let xml = `<${tag}pt lat="${point.lat}" lon="${point.lon}"><ele>${point.alt ?? 0}</ele><time>${dt.toISOString()}</time>${name}</${tag}pt>\n`;
        return xml;
    }
    
    /**
     * 
     * @param {String} group 
     * @param {Point} point 
     */
    #startTrack(group, point)
    {
        this.#curGroup = group;
        let name = "{0}: Start Point".format(group);
        this.addWayPoint(Object.assign({}, point, {name: name}));
        this.#xml += "\t<trk>\n\t\t<name>{0}</name>\n\t\t<trkseg>\n".format(group);
    }
    
    #endTrack()
    {
        this.#stoppedPoint();
        let name = "{0}: End Point".format(this.#curGroup);
        this.addWayPoint(Object.assign({}, this.#lastPoint, {name: name}));
        this.#xml += "\t\t</trkseg>\n\t</trk>\n";
    }

    #stoppedPoint()
    {
        if (this.#stoppedUntil) {
            let last = this.#lastPoint.fromMeters(0, 0, 0);
            last.timestamp = this.#stoppedUntil;
            this.#stoppedUntil = null;
            this.#addTrkPoint(last);
        }
    }
}
