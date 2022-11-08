import { Point } from './geo.js';
import './proto.js';

/**
 * Utility class to generate GPX files.
 * 
 */
export class GpxWriter
{
    constructor()
    {
        this._curGroup;
        this._lastPoint;
        this._points;
        this._xml;
    }

    /**
     * Creates a new GPX
     */
    create()
    {
        this._curGroup     = null;
        this._lastPoint    = null;
        this._stoppedUntil = null;
        this._points       = [];
        this._xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n\
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
        this._points.push(point);
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
        if (group != this._curGroup) { // When group was change (track)
            if (this._curGroup) {
                this._endTrack();
            }
            this._startTrack(group, point);
        }
        else if (newseg) {
            this._xml += "\t\t</trkseg>\n\t\t<trkseg>\n";    
        }
        else if (this._lastPoint && this._lastPoint.distanceTo(point) < 1) { // Is stopped? Don't add...
            this._stoppedUntil = point.timestamp;
            return;
        }
        this._stoppedPoint(); // When move again, add last point with new time
        
        this._lastPoint = point;
        this._addTrkPoint(point);
    }
    
    /**
     * Ends current GPX e flushs their contents.
     * 
     * @return {String}
     */
    end()
    {
        if (this._lastPoint) {
            this._endTrack();
        }
        var i = 1;
        var me = this;
        this._points.map(p => {
            let clone = Object.clone(p);
            if (!clone.name) {
                clone.name = "POI #{0}".format(i++);
            }
            me._xml += "\t" + me._makePoint(clone, true);
        })
        let xml = this._xml + '</gpx>';
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
        return this._curGroup != null;
    }

    _addTrkPoint(point)
    {
        this._xml += "\t\t\t" + this._makePoint(point);
    }

    _makePoint(point, wpt = false)
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
    _startTrack(group, point)
    {
        this._curGroup = group;
        let name = "{0}: Start Point".format(group);
        this.addWayPoint(Object.assign({}, point, {name: name}));
        this._xml += "\t<trk>\n\t\t<name>{0}</name>\n\t\t<trkseg>\n".format(group);
    }
    
    _endTrack()
    {
        this._stoppedPoint();
        let name = "{0}: End Point".format(this._curGroup);
        this.addWayPoint(Object.assign({}, this._lastPoint, {name: name}));
        this._xml += "\t\t</trkseg>\n\t</trk>\n";
    }

    _stoppedPoint()
    {
        if (this._stoppedUntil) {
            let last = this._lastPoint.fromMeters(0, 0, 0);
            last.timestamp = this._stoppedUntil;
            this._stoppedUntil = null;
            this._addTrkPoint(last);
        }
    }
}
